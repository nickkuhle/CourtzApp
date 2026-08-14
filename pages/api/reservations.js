import { readReservations, toggleReservation, bookGroup, cancelGroup } from '../../lib/reservations.js'
import { validateBooking } from '../../lib/booking-rules.js'

// The booking window and session-limit rules are enforced here so they cannot
// be bypassed by calling the API directly. CourtzAppsScript.gs re-checks the
// same rules under its write lock before touching the Sheet, so a stale
// browser can never sneak past them either.

// Vercel: give the Sheet round-trip time to finish on serverless (the Hobby
// plan allows up to 60s). Local `next dev` ignores this.
export const maxDuration = 20

// Booking payloads are tiny; cap the accepted JSON size so an oversized body
// is rejected before it is parsed.
export const config = {
  api: {
    bodyParser: { sizeLimit: '64kb' },
  },
}

// --- Write rate limiting ----------------------------------------------------
// A gentle in-memory limiter per client IP so a runaway script (or a curious
// player mashing the button) can't spam the Google Sheet. On serverless hosts
// each instance keeps its own bucket, so this is a backstop rather than a
// hard guarantee; Vercel's own DDoS/firewall protection sits in front of it.
const WRITE_RATE_WINDOW_MS = 60_000
const WRITE_RATE_MAX = 30
const writeRateBuckets = new Map()

function clientIp(req) {
  const headers = req?.headers || {}
  const forwarded = headers['x-forwarded-for']
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : ''
  if (first) return first
  return req?.socket?.remoteAddress || 'unknown'
}

function writeRateLimited(ip, now = Date.now()) {
  let bucket = writeRateBuckets.get(ip)
  if (!bucket || now - bucket.startedAt > WRITE_RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 }
    writeRateBuckets.set(ip, bucket)
  }
  bucket.count += 1
  // Keep the map from growing without bound on a long-lived server.
  if (writeRateBuckets.size > 500) {
    for (const [key, entry] of writeRateBuckets) {
      if (now - entry.startedAt > WRITE_RATE_WINDOW_MS) writeRateBuckets.delete(key)
    }
  }
  return bucket.count > WRITE_RATE_MAX
}

let warnedAboutUnprotectedStaffApproval = false

function configuredStaffApprovalCode() {
  return String(process.env.STAFF_APPROVAL_CODE || '').trim()
}

function warnAboutUnprotectedStaffApprovalOnce() {
  if (warnedAboutUnprotectedStaffApproval) return
  warnedAboutUnprotectedStaffApproval = true
  console.warn('STAFF_APPROVAL_CODE is not set; staffApproved requests are not protected by a staff code.')
}

// Returns the approval value that may be passed into the mirrored booking
// rules. A caller-provided `staffApproved: true` is ignored unless it carries
// the configured code. Leaving STAFF_APPROVAL_CODE unset preserves the
// pre-code tournament behavior, but emits one server-side warning.
function authorizeStaffApproval({ staffApproved, staffCode }, res) {
  if (!staffApproved) return false
  const configuredCode = configuredStaffApprovalCode()
  if (!configuredCode) {
    warnAboutUnprotectedStaffApprovalOnce()
    return true
  }
  if (!String(staffCode || '').trim()) {
    res.status(403).json({
      error: 'A tournament staff approval code is required.',
      code: 'STAFF_APPROVAL_CODE_REQUIRED',
      staffCodeRequired: true,
    })
    return null
  }
  if (String(staffCode).trim() !== configuredCode) {
    res.status(403).json({
      error: 'The tournament staff approval code is incorrect.',
      code: 'STAFF_APPROVAL_CODE_INVALID',
      staffCodeRequired: true,
    })
    return null
  }
  return true
}

function requireRulesOrFail(validation, res) {
  if (validation.ok) return true
  if (validation.isSessionLimitError) {
    return res.status(409).json({ error: validation.error, code: 'SESSION_LIMIT' }) && false
  }
  return res.status(400).json({ error: validation.error, code: 'BOOKING_RULES' }) && false
}

function staffApprovalRequired(res, warnings) {
  const staffCodeRequired = Boolean(configuredStaffApprovalCode())
  if (!staffCodeRequired) warnAboutUnprotectedStaffApprovalOnce()
  return res.status(409).json({
    error: 'This booking is within one hour of another practice session. Tournament staff approval is required to continue.',
    code: 'STAFF_APPROVAL_REQUIRED',
    staffCodeRequired,
    warnings,
  })
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const reservations = await readReservations()
      return res.status(200).json({ reservations })
    } catch (error) {
      console.error(error)
      return res.status(500).json({ error: 'Unable to read reservations.' })
    }
  }

  if (req.method === 'POST') {
    if (writeRateLimited(clientIp(req))) {
      res.setHeader('Retry-After', '60')
      return res.status(429).json({ error: 'Too many booking requests. Please wait a minute and try again.' })
    }
    const body = req.body || {}
    const { action, location, date, courtId, slot, slots, name, names, staffApproved, staffCode, practiceLocations } = body
    if (!location || !date || !courtId) {
      return res.status(400).json({ error: 'Missing reservation payload.' })
    }

    try {
      if (action === 'book' || action === 'cancel') {
        const slotList = Array.isArray(slots) && slots.length ? slots : [slot]
        const nameList = Array.isArray(names) && names.length ? names : [name]
        if (!slotList.length || !nameList.length) {
          return res.status(400).json({ error: 'Missing slots or players.' })
        }

        // Re-read the current reservations so a stale browser view cannot hide
        // sessions that were booked in the meantime.
        const reservations = await readReservations()
        const effectiveStaffApproval = action === 'book'
          ? authorizeStaffApproval({ staffApproved: Boolean(staffApproved), staffCode }, res)
          : false
        if (effectiveStaffApproval === null) return

        const validation = validateBooking({
          action,
          location,
          date,
          courtId,
          slots: slotList,
          names: nameList,
          staffApproved: effectiveStaffApproval,
          reservations,
          practiceLocations,
        })
        if (!requireRulesOrFail(validation, res)) return

        if (action === 'book' && validation.warnings.length && !effectiveStaffApproval) {
          // The close-timing warning: booking is only possible with explicit
          // tournament-staff approval. The hard session limit is checked above
          // and can never be bypassed.
          return staffApprovalRequired(res, validation.warnings)
        }

        if (action === 'book') {
          await bookGroup({
            location,
            date,
            courtId,
            slots: slotList,
            names: nameList,
            staffApproved: effectiveStaffApproval,
            staffCode,
            practiceLocations,
          })
        } else {
          await cancelGroup({ location, date, courtId, slots: slotList, names: nameList, practiceLocations })
        }
        return res.status(200).json({ success: true, action, warnings: validation.warnings })
      }

      // Legacy single-player toggle. Determine whether this exact player is
      // already stored before choosing the validation action: removals use the
      // cancellation rules, while additions must pass every booking rule.
      if (!slot || !name) {
        return res.status(400).json({ error: 'Missing reservation payload.' })
      }
      const reservations = await readReservations()
      const reservationKey = `${location}|${date}|${courtId}`
      const currentValue = reservations[reservationKey]?.[slot]
      const currentNames = Array.isArray(currentValue) ? currentValue : (currentValue ? [currentValue] : [])
      const toggleAction = currentNames.map((n) => String(n).trim()).includes(String(name).trim()) ? 'cancel' : 'book'
      const effectiveStaffApproval = toggleAction === 'book'
        ? authorizeStaffApproval({ staffApproved: Boolean(staffApproved), staffCode }, res)
        : false
      if (effectiveStaffApproval === null) return

      const validation = validateBooking({
        action: toggleAction,
        location,
        date,
        courtId,
        slots: [slot],
        names: [name],
        staffApproved: effectiveStaffApproval,
        reservations,
        practiceLocations,
      })
      if (!requireRulesOrFail(validation, res)) return
      if (toggleAction === 'book' && validation.warnings.length && !effectiveStaffApproval) {
        return staffApprovalRequired(res, validation.warnings)
      }

      await toggleReservation({
        location,
        date,
        courtId,
        slot,
        name,
        staffApproved: effectiveStaffApproval,
        staffCode,
        practiceLocations,
      })
      // The client updates this one slot optimistically. Returning the entire
      // schedule here used to make every booking wait on a full Sheets re-read.
      return res.status(200).json({ success: true, action: toggleAction })
    } catch (error) {
      console.error(error)
      if (error && error.code === 'STAFF_APPROVAL_REQUIRED') {
        return res.status(409).json({
          error: error.message,
          code: 'STAFF_APPROVAL_REQUIRED',
          staffCodeRequired: Boolean(configuredStaffApprovalCode()),
        })
      }
      if (error && (error.code === 'STAFF_APPROVAL_CODE_REQUIRED' || error.code === 'STAFF_APPROVAL_CODE_INVALID')) {
        return res.status(403).json({ error: error.message, code: error.code, staffCodeRequired: true })
      }
      if (error && error.code === 'SESSION_LIMIT') {
        return res.status(409).json({ error: error.message, code: 'SESSION_LIMIT' })
      }
      if (error && error.code === 'BOOKING_RULES') {
        return res.status(400).json({ error: error.message, code: 'BOOKING_RULES' })
      }
      return res.status(500).json({ error: error.message || 'Unable to save reservation.' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
