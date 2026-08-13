// lib/booking-rules.js - Booking window and session-limit rules shared by the
// UI and the Next.js API. CourtzAppsScript.gs mirrors these exact rules (see
// the "BOOKING RULES (mirrors lib/booking-rules.js)" section there).
//
// Session counting (what counts as ONE session):
//   - Barnes: every occupied 30-minute slot is one session.
//   - Other locations: for the same player, date, location and court, two
//     immediately consecutive 30-minute slots are grouped into one 60-minute
//     session. A session contains at most two slots, so 90+ consecutive
//     minutes become two (or more) sessions.
// Proximity checks compare session START times - never the two internal
// 30-minute parts of one 60-minute session.
//
// Rules:
//   1. Bookings/cancellations are allowed only for today and tomorrow
//      (America/Los_Angeles), and only for 30-minute slots that have not fully
//      ended yet (the current 30-minute slot stays available).
//   2. A player may hold at most TWO sessions per day across every active
//      practice location. This hard limit can never be bypassed.
//   3. A new session whose start is within one hour of another session's start
//      (including back-to-back sessions) needs tournament-staff approval. The
//      staff override bypasses only this warning.

import { timeToMinutes, slotStartLabel } from './sheets-grid-parser.js'
import { DEFAULT_PRACTICE_LOCATIONS, isBarnesLocation, normalizePracticeLocations } from './locations.js'

export { DEFAULT_PRACTICE_LOCATIONS, normalizePracticeLocations }

export const SESSION_WARNING_WINDOW_MS = 60 * 60 * 1000
export const MAX_SESSIONS_PER_DAY = 2

// --- Los Angeles (San Diego) calendar --------------------------------------

// A basic, DST-aware UTC offset for America/Los_Angeles. Rules are only ever
// enforced for "today and tomorrow", so a fixed, current-year table is exact.
const LA_WEEKDAY_RULES = [
  // startMsUtc (inclusive), endMsUtc (exclusive), offsetMinutes
  [1767225600000, 1772964000000, -480], // 2026-01-01T00:00Z..2026-03-08T10:00Z PST
  [1772964000000, 1793523600000, -420], // 2026-03-08T10:00Z..2026-11-01T09:00Z PDT
  [1793523600000, 1798761600000, -480], // 2026-11-01T09:00Z..2027-01-01T00:00Z PST
]

const JS_DATE_MIN_UTC = -2208988800000 // 1900-01-01 (Spreadsheet time origin)
const JS_DATE_MAX_UTC = 4102444800000 // 2100-01-01

export function laOffsetMinutes(msUtc) {
  if (!Number.isFinite(msUtc)) return -480
  if (msUtc < JS_DATE_MIN_UTC || msUtc >= JS_DATE_MAX_UTC) return -480
  for (const [start, end, offset] of LA_WEEKDAY_RULES) {
    if (msUtc >= start && msUtc < end) return offset
  }
  return -480
}

// "Now" in America/Los_Angeles as { dateKey: 'YYYY-MM-DD', minutes: 0..1439 }.
export function laNow(nowMs = Date.now()) {
  const totalMinutes = Math.floor((nowMs + laOffsetMinutes(nowMs) * 60000) / 60000)
  const date = new Date(totalMinutes * 60000)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return { dateKey: `${y}-${m}-${d}`, minutes: date.getUTCHours() * 60 + date.getUTCMinutes() }
}

export function dateKeyToUtcMinutes(dateKey) {
  const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 60000
}

export function addDaysToDateKey(dateKey, days) {
  const base = dateKeyToUtcMinutes(dateKey)
  if (Number.isNaN(base)) return dateKey
  return dateKeyFromUtcMinutes(base + days * 24 * 60)
}

export function dateKeyFromUtcMinutes(totalMinutes) {
  const date = new Date(totalMinutes * 60000)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 'YYYY-MM-DD' -> 0 (today), 1 (tomorrow), 2 (later), -1/-2/... (past).
export function laDayOffset(dateKey, nowMs = Date.now()) {
  const target = dateKeyToUtcMinutes(dateKey)
  const today = dateKeyToUtcMinutes(laNow(nowMs).dateKey)
  if (Number.isNaN(target) || Number.isNaN(today)) return null
  return Math.round((target - today) / (24 * 60))
}

// Whether bookings/cancellations are allowed on this date (today or tomorrow).
export function isBookableDay(dateKey, nowMs = Date.now()) {
  const offset = laDayOffset(dateKey, nowMs)
  return offset === 0 || offset === 1
}

// A 30-minute slot is finished once its END time has passed. At 1:15 PM the
// 12:30-1:00 PM slot is finished, but the 1:00-1:30 PM slot is still usable.
export function isSlotCompleted(dateKey, slotLabel, nowMs = Date.now()) {
  const endMinutes = slotEndMinutes(slotLabel)
  if (endMinutes === null) return true
  const now = laNow(nowMs)
  if (dateKey < now.dateKey) return true
  if (dateKey > now.dateKey) return false
  return endMinutes <= now.minutes
}

export function slotStartMinutes(slotLabel) {
  const start = timeToMinutes(slotStartLabel(slotLabel))
  return Number.isNaN(start) ? null : start
}

export function slotEndMinutes(slotLabel) {
  const start = slotStartMinutes(slotLabel)
  return start === null ? null : start + 30
}

// --- Session grouping -------------------------------------------------------

// Reservations are stored as 30-minute Sheet slots:
//   { 'Location|YYYY-MM-DD|Court': { '8:00 AM–8:30 AM': ['Name', ...], ... } }
//
// existingPlayerSessions groups them per player into the sessions that count
// toward the limit:
//   - Barnes: every occupied 30-minute slot is its own session.
//   - Non-Barnes: for the same player, date, location and court, two
//     immediately consecutive 30-minute slots combine into one session
//     (at most two slots per session).
// Only the `practiceLocations` count - hidden match-play sites never do unless
// the desk deliberately added them as active practice locations.
// Every session carries { player, location, court, start, slots }.
export function existingPlayerSessions(reservations, { dateKey, name = null, practiceLocations = null }) {
  const active = new Set(normalizePracticeLocations(practiceLocations))
  const groups = []
  const seen = new Set()

  for (const [key, slots] of Object.entries(reservations || {})) {
    const [location, date, court] = String(key).split('|')
    if (!location || !date || !court) continue
    if (date !== dateKey) continue
    if (!active.has(location)) continue
    if (!slots || typeof slots !== 'object') continue

    const byPlayer = new Map()
    for (const [slotLabel, val] of Object.entries(slots)) {
      const start = slotStartMinutes(slotLabel)
      if (start === null) continue
      const names = Array.isArray(val) ? val : [val]
      names.forEach((raw) => {
        const n = String(raw).trim()
        if (!n) return
        if (!byPlayer.has(n)) byPlayer.set(n, [])
        byPlayer.get(n).push({ start, slotLabel })
      })
    }

    byPlayer.forEach((owned, player) => {
      if (name && player !== name) return
      const sorted = [...owned].sort((a, b) => a.start - b.start)
      const sessions = []
      let current = null
      for (const entry of sorted) {
        if (isBarnesLocation(location)) {
          sessions.push({ location, court, start: entry.start, slots: [entry.slotLabel] })
          continue
        }
        if (current && entry.start === current.start + 30 && current.slots.length < 2) {
          current.slots.push(entry.slotLabel)
        } else {
          current = { location, court, start: entry.start, slots: [entry.slotLabel] }
          sessions.push(current)
        }
      }
      for (const session of sessions) {
        const id = `${player}|${location}|${court}|${session.start}`
        if (seen.has(id)) continue
        seen.add(id)
        groups.push({ player, location, court, start: session.start, slots: session.slots })
      }
    })
  }
  return groups
}

// A proposed NEW booking as one session. For non-Barnes bookings a 60-minute
// reservation (two consecutive 30-minute parts) counts as ONE session. (For
// Barnes the caller always passes one slot.)
export function proposedSession({ location, date, courtId, slots }) {
  const cleaned = [...new Set((slots || []).map((s) => String(s).trim()).filter(Boolean))]
  const starts = cleaned
    .map((s) => slotStartMinutes(s))
    .filter((n) => n !== null)
    .sort((a, b) => a - b)
  let start = null
  if (starts.length) start = starts[0]
  return {
    location,
    date,
    courtId: String(courtId),
    slots: cleaned,
    start,
  }
}

// The full validation used by the API (and mirrored in Apps Script v2.2).
// `nowMs` keeps the rules testable at a fixed moment.
export function validateBooking({
  action,
  location,
  date,
  courtId,
  slots,
  names,
  staffApproved = false,
  reservations = {},
  practiceLocations = null,
  nowMs = Date.now(),
}) {
  const cleanedLocation = String(location || '').trim()
  const cleanedNames = [...new Set((names || []).map((n) => String(n).trim()).filter(Boolean))]
  const cleanedSlots = [...new Set((slots || []).map((s) => String(s).trim()).filter(Boolean))]
  if (!cleanedNames.length) return { ok: false, error: 'No players given' }
  if (!cleanedSlots.length) return { ok: false, error: 'No time slots given' }
  if (!isBookableDay(date, nowMs)) {
    return { ok: false, error: 'Bookings and cancellations are only allowed for today and tomorrow (view-only for other days).' }
  }
  for (const slot of cleanedSlots) {
    if (isSlotCompleted(date, slot, nowMs)) {
      return { ok: false, error: `The time slot ${slot} has already ended and can no longer be changed.` }
    }
  }

  // One session per player (even if the write fails later, the limits are
  // evaluated as if the new session existed).
  const sessionsByPlayer = new Map()
  for (const player of cleanedNames) {
    const existing = existingPlayerSessions(reservations, { dateKey: date, name: player, practiceLocations })
    const proposed = proposedSession({ location, date, courtId, slots: cleanedSlots })
    if (proposed.start === null) {
      return { ok: false, error: `The time slot "${cleanedSlots.join('", "')}" could not be read.` }
    }
    sessionsByPlayer.set(player, { existing, proposed })
  }

  const warnings = []
  const hardLimitErrors = []
  for (const [player, { existing, proposed }] of sessionsByPlayer) {
    const all = [...existing]
    let proposedSessionObj = null
    // "Same session" means same LOCATION, same court and same start time.
    // Comparing only court + start let a player dodge the 2-session maximum by
    // booking a same-numbered court at a different venue (e.g. Barnes Court 4
    // vs Peninsula Court 4), because the new session was never counted.
    const sameCourtIndex = all.findIndex(
      (s) => s.location === cleanedLocation && String(s.court) === proposed.courtId && s.start === proposed.start
    )
    if (sameCourtIndex === -1) {
      proposedSessionObj = { location, court: proposed.courtId, start: proposed.start, slots: [...proposed.slots] }
      all.push(proposedSessionObj)
    }

    if (action === 'book') {
      if (all.length > MAX_SESSIONS_PER_DAY) {
        hardLimitErrors.push(
          `${player} would have ${all.length} practice sessions on ${date}; the maximum is ${MAX_SESSIONS_PER_DAY}.`
        )
        continue
      }
      // Back-to-back, simultaneous, or any start within one hour of another
      // session's start needs staff approval. A 60-minute booking's own second
      // 30-minute part is part of the same session and never triggers this.
      const closeSession = all.find(
        (s) => s !== proposedSessionObj && s.start !== null && proposed.start !== null && Math.abs(s.start - proposed.start) <= 60
      )
      if (closeSession && !staffApproved) {
        warnings.push(
          `${player}'s new ${location} session is within one hour of another practice session (staff approval required).`
        )
      }
    }
  }

  if (hardLimitErrors.length) {
    return { ok: false, error: hardLimitErrors.join(' '), warnings, hardLimitErrors, isSessionLimitError: true }
  }
  return { ok: true, error: null, warnings, hardLimitErrors: [] }
}
