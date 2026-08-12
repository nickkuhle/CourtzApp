import { readReservations, toggleReservation, bookGroup, cancelGroup } from '../../lib/reservations.js'
import { validateBooking } from '../../lib/booking-rules.js'

// The booking window and session-limit rules are enforced here so they cannot
// be bypassed by calling the API directly. CourtzAppsScript.gs re-checks the
// same rules under its write lock before touching the Sheet, so a stale
// browser can never sneak past them either.

function requireRulesOrFail(validation, res) {
  if (validation.ok) return true
  if (validation.isSessionLimitError) {
    return res.status(409).json({ error: validation.error, code: 'SESSION_LIMIT' }) && false
  }
  return res.status(400).json({ error: validation.error, code: 'BOOKING_RULES' }) && false
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
    const body = req.body || {}
    const { action, location, date, courtId, slot, slots, name, names, staffApproved, practiceLocations } = body
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
        const validation = validateBooking({
          action,
          location,
          date,
          courtId,
          slots: slotList,
          names: nameList,
          staffApproved: Boolean(staffApproved),
          reservations,
          practiceLocations,
        })
        if (!requireRulesOrFail(validation, res)) return

        if (action === 'book' && validation.warnings.length && !staffApproved) {
          // The close-timing warning: booking is only possible with explicit
          // tournament-staff approval. The hard session limit is checked above
          // and can never be bypassed.
          return res.status(409).json({
            error: 'This booking is within one hour of another practice session. Tournament staff approval is required to continue.',
            code: 'STAFF_APPROVAL_REQUIRED',
            warnings: validation.warnings,
          })
        }

        if (action === 'book') {
          await bookGroup({ location, date, courtId, slots: slotList, names: nameList, staffApproved: Boolean(staffApproved), practiceLocations })
        } else {
          await cancelGroup({ location, date, courtId, slots: slotList, names: nameList, staffApproved: Boolean(staffApproved), practiceLocations })
        }
        return res.status(200).json({ success: true, action, warnings: validation.warnings })
      }

      // Legacy single-player toggle
      if (!slot || !name) {
        return res.status(400).json({ error: 'Missing reservation payload.' })
      }
      // A toggle can be either a booking or a cancellation, so only the
      // booking-window rules (date + ended slots) are applied here.
      const reservations = await readReservations()
      const validation = validateBooking({
        action: 'cancel',
        location,
        date,
        courtId,
        slots: [slot],
        names: [name],
        staffApproved: Boolean(staffApproved),
        reservations,
        practiceLocations,
      })
      if (!requireRulesOrFail(validation, res)) return
      await toggleReservation({ location, date, courtId, slot, name, staffApproved: Boolean(staffApproved), practiceLocations })
      // The client updates this one slot optimistically. Returning the entire
      // schedule here used to make every booking wait on a full Sheets re-read.
      return res.status(200).json({ success: true })
    } catch (error) {
      console.error(error)
      if (error && error.code === 'STAFF_APPROVAL_REQUIRED') {
        return res.status(409).json({ error: error.message, code: 'STAFF_APPROVAL_REQUIRED' })
      }
      if (error && error.code === 'SESSION_LIMIT') {
        return res.status(409).json({ error: error.message, code: 'SESSION_LIMIT' })
      }
      return res.status(500).json({ error: error.message || 'Unable to save reservation.' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
