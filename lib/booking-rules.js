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
// Proximity checks are PER PLAYER ONLY: a warning triggers only when the SAME
// player tries to book a session within 1 hour of their own existing session.
// Example: Player A at 12:30 when Player A already has one ending at 12:00 => warning.
//          Player A at 12:30 when only Player B has 12:00 booking => NO warning.
//          This fixes the reported bug where any other reservation triggered warning.
// The booking is validated against the day the player would ACTUALLY end up
// with: the player's existing 30-minute slots and the newly requested slots are
// merged per location+court and regrouped into sessions. A slot the player
// already holds therefore never counts twice, so re-confirming (or extending)
// a booking the player is already part of can never warn about itself.
//
// Rules:
//   1. Bookings/cancellations are allowed only for today and tomorrow
//      (America/Los_Angeles), and only for 30-minute slots that have not fully
//      ended yet (the current 30-minute slot stays available).
//   2. A player may hold at most TWO sessions per day across every active
//      practice location. This hard limit can never be bypassed.
//   3. A new session whose start is within one hour of another session's start
//      FOR THE SAME PLAYER (including back-to-back sessions) needs tournament-staff
//      approval. The staff override bypasses only this warning, and when a staff
//      code is configured the prompt asks for that code.

import { timeToMinutes, slotStartLabel } from './sheets-grid-parser.js'
import { DEFAULT_PRACTICE_LOCATIONS, isBarnesLocation, normalizePracticeLocations } from './locations.js'

export { DEFAULT_PRACTICE_LOCATIONS, normalizePracticeLocations }

export const SESSION_WARNING_WINDOW_MS = 60 * 60 * 1000
export const MAX_SESSIONS_PER_DAY = 2
export const MAX_PLAYERS_PER_SLOT = 4

// Describes what tapping one court-card slot should do for the player currently
// selected in "Booking Courts As". Occupancy belongs to the SLOT, while
// ownership belongs to the selected PLAYER: after switching from Player A to
// Player X, Player A's partially occupied slot must become a book action for X,
// not stay stuck in A's cancel state. Keeping this calculation pure also gives
// every render one canonical answer for badges, disabled state and click mode.
export function getSlotBookingState(reservedBy, currentPlayer, capacity = MAX_PLAYERS_PER_SLOT) {
  const players = Array.isArray(reservedBy) ? reservedBy : []
  const selectedPlayer = String(currentPlayer || '').trim()
  const safeCapacity = Number.isFinite(Number(capacity)) && Number(capacity) > 0
    ? Number(capacity)
    : MAX_PLAYERS_PER_SLOT
  const isOwnedByCurrentPlayer = Boolean(selectedPlayer) && players.includes(selectedPlayer)
  const isFull = players.length >= safeCapacity

  return {
    count: players.length,
    isOwnedByCurrentPlayer,
    isFull,
    isPartiallyBooked: players.length > 0 && !isFull && !isOwnedByCurrentPlayer,
    isReservedFullForOthers: isFull && !isOwnedByCurrentPlayer,
    action: isOwnedByCurrentPlayer ? 'cancel' : 'book',
  }
}

// Resolves the authoritative action for a SLOT TAP. The parent page calls this
// with its synchronously updated selected-player ref, rather than trusting the
// mode/player captured by a court-card render that may be one React update
// behind a just-completed switch. Explicit per-player cancel buttons do not use
// this helper and therefore keep their targeted cancellation behavior.
export function getSlotTapIntent(reservedBy, currentPlayer) {
  const players = [...new Set((Array.isArray(reservedBy) ? reservedBy : [])
    .map((name) => String(name).trim())
    .filter(Boolean))]
  const selectedPlayer = String(currentPlayer || '').trim()
  const state = getSlotBookingState(players, selectedPlayer)

  return {
    mode: state.action,
    players: state.action === 'cancel'
      ? players
      : (selectedPlayer ? [selectedPlayer] : []),
  }
}

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
// When `name` is provided, only that player's sessions are returned — this is
// what ensures proximity warnings are per SAME player only.
export function existingPlayerSessions(reservations, { dateKey, name = null, practiceLocations = null }) {
  const groups = []
  for (const held of playerSlotsByCourt(reservations, { dateKey, name, practiceLocations }).values()) {
    for (const session of groupSlotsIntoSessions(held)) {
      groups.push({
        player: held.player,
        location: session.location,
        court: session.court,
        start: session.start,
        slots: session.slots,
      })
    }
  }
  return groups
}

// Every 30-minute slot a player holds on `dateKey`, bucketed per
// location + court: Map('Player|Location|Court' -> { player, location, court,
// slots: Map(startMinutes -> slotLabel) }). Only active practice locations are
// included. This is the raw material both the existing-session grouping and the
// "what would the day look like after this booking" projection work from.
function playerSlotsByCourt(reservations, { dateKey, name = null, practiceLocations = null }) {
  const active = new Set(normalizePracticeLocations(practiceLocations))
  const byCourt = new Map()

  for (const [key, slots] of Object.entries(reservations || {})) {
    const [location, date, court] = String(key).split('|')
    if (!location || !date || !court) continue
    if (date !== dateKey) continue
    if (!active.has(location)) continue
    if (!slots || typeof slots !== 'object') continue

    for (const [slotLabel, val] of Object.entries(slots)) {
      const start = slotStartMinutes(slotLabel)
      if (start === null) continue
      const names = Array.isArray(val) ? val : [val]
      names.forEach((raw) => {
        const player = String(raw).trim()
        if (!player) return
        if (name && player !== name) return
        const bucketKey = `${player}|${location}|${court}`
        let bucket = byCourt.get(bucketKey)
        if (!bucket) {
          bucket = { player, location, court, slots: new Map() }
          byCourt.set(bucketKey, bucket)
        }
        if (!bucket.slots.has(start)) bucket.slots.set(start, slotLabel)
      })
    }
  }
  return byCourt
}

// Groups one player's 30-minute slots on a single court into sessions:
//   - Barnes: one session per slot.
//   - Elsewhere: two immediately consecutive slots form one 60-minute session.
function groupSlotsIntoSessions({ location, court, slots }) {
  const sorted = [...slots.entries()].sort((a, b) => a[0] - b[0])
  const sessions = []
  let current = null
  for (const [start, slotLabel] of sorted) {
    if (isBarnesLocation(location)) {
      sessions.push({ location, court, start, slots: [slotLabel] })
      continue
    }
    if (current && start === current.start + 30 && current.slots.length < 2) {
      current.slots.push(slotLabel)
      current.starts.push(start)
    } else {
      current = { location, court, start, slots: [slotLabel], starts: [start] }
      sessions.push(current)
    }
  }
  return sessions.map(({ location: loc, court: c, start, slots: labels, starts }) => ({
    location: loc,
    court: c,
    start,
    slots: labels,
    starts: starts || [start],
  }))
}

// The sessions a player would hold after `slots` are added on
// `location`/`courtId`, together with the subset that actually contains a NEWLY
// requested slot. Slots the player already holds are merged in place, so
// re-validating (or extending) a booking the player is already part of never
// produces a duplicate session — and never warns about itself.
export function sessionsAfterBooking(reservations, { dateKey, name, practiceLocations = null, location, courtId, slots }) {
  const cleanedLocation = String(location || '').trim()
  const court = String(courtId)
  const byCourt = playerSlotsByCourt(reservations, { dateKey, name, practiceLocations })

  const bucketKey = `${name}|${cleanedLocation}|${court}`
  let bucket = byCourt.get(bucketKey)
  if (!bucket) {
    // The proposed booking always counts, even at a location the desk keeps
    // hidden, so an unlisted site can never be used to dodge the daily limit.
    bucket = { player: name, location: cleanedLocation, court, slots: new Map() }
    byCourt.set(bucketKey, bucket)
  }

  const addedStarts = new Set()
  for (const slotLabel of slots || []) {
    const label = String(slotLabel).trim()
    if (!label) continue
    const start = slotStartMinutes(label)
    if (start === null) continue
    if (bucket.slots.has(start)) continue // already the player's own slot
    bucket.slots.set(start, label)
    addedStarts.add(start)
  }

  const sessions = []
  for (const held of byCourt.values()) {
    const isTargetCourt = held === bucket
    for (const session of groupSlotsIntoSessions(held)) {
      const isNew = isTargetCourt && session.starts.some((s) => addedStarts.has(s))
      sessions.push({ player: held.player, ...session, isNew })
    }
  }
  return { sessions, addedSlotCount: addedStarts.size }
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

// The full validation used by the API (and mirrored in Apps Script v2.4).
// `nowMs` keeps the rules testable at a fixed moment.
// IMPORTANT: proximity warnings are per SAME PLAYER ONLY. existingPlayerSessions
// is called with name=player, so only that player's own sessions are checked.
// This fixes the bug where any other player's reservation triggered a warning.
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

  const sessionsByPlayer = new Map()
  for (const player of cleanedNames) {
    // Per-player existing sessions — ensures same-player-only proximity check
    const existing = existingPlayerSessions(reservations, { dateKey: date, name: player, practiceLocations })
    const proposed = proposedSession({ location, date, courtId, slots: cleanedSlots })
    if (proposed.start === null) {
      return { ok: false, error: `The time slot "${cleanedSlots.join('", "')}" could not be read.` }
    }
    // The day as it would look AFTER this booking: the player's own slots are
    // merged with the requested ones, so slots they already hold are never
    // counted (or compared against) twice.
    const projected = sessionsAfterBooking(reservations, {
      dateKey: date,
      name: player,
      practiceLocations,
      location,
      courtId,
      slots: cleanedSlots,
    })
    sessionsByPlayer.set(player, { existing, proposed, projected })
  }

  const warnings = []
  const hardLimitErrors = []
  for (const [player, { existing, projected }] of sessionsByPlayer) {
    if (action !== 'book') continue
    const all = projected.sessions
    if (all.length > MAX_SESSIONS_PER_DAY) {
      hardLimitErrors.push(
        `${player} already has ${existing.length} of ${MAX_SESSIONS_PER_DAY} practice sessions on ${date} and would have ${all.length}; the maximum is ${MAX_SESSIONS_PER_DAY} sessions in one day.`
      )
      continue
    }
    // Nothing new for this player (they already hold every requested slot):
    // re-confirming an existing booking can never need staff approval.
    if (!projected.addedSlotCount) continue

    // Same-player-only proximity, comparing session STARTS. A session is only
    // ever compared against the player's OTHER sessions, so neither the two
    // halves of one 60-minute session nor a slot the player already held can
    // trigger a warning about itself.
    const newSessions = all.filter((s) => s.isNew)
    const conflict = newSessions.some((created) =>
      all.some(
        (other) =>
          other !== created &&
          created.start !== null &&
          other.start !== null &&
          Math.abs(other.start - created.start) <= 60
      )
    )
    if (conflict && !staffApproved) {
      warnings.push(
        `${player}'s new ${location} session is within one hour of another practice session for the same player (staff approval required).`
      )
    }
  }

  if (hardLimitErrors.length) {
    return { ok: false, error: hardLimitErrors.join(' '), warnings, hardLimitErrors, isSessionLimitError: true }
  }
  return { ok: true, error: null, warnings, hardLimitErrors: [] }
}
