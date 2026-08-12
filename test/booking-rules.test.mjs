import assert from 'node:assert/strict'
import test from 'node:test'

import {
  laNow,
  laOffsetMinutes,
  laDayOffset,
  isBookableDay,
  isSlotCompleted,
  existingPlayerSessions,
  proposedSession,
  validateBooking,
  MAX_SESSIONS_PER_DAY,
} from '../lib/booking-rules.js'
import { DEFAULT_PRACTICE_LOCATIONS } from '../lib/locations.js'

const BARNES = 'Barnes Tennis Center'
const PEN = 'Peninsula Tennis Club'
const PLNU = 'Point Loma Nazarene College'
const USD = 'USD'
const DEFAULTS = DEFAULT_PRACTICE_LOCATIONS

// Wed Aug 12, 2026, 8:05 AM in America/Los_Angeles (PDT = UTC-7). The session
// tests book morning slots, so "now" must be before those slots end.
const NOW = Date.UTC(2026, 7, 12, 15, 5)
// Wed Aug 12, 2026, 1:15 PM - used for the completed-slot window tests.
const AFTERNOON_NOW = Date.UTC(2026, 7, 12, 20, 15)
const TODAY = '2026-08-12'
const TOMORROW = '2026-08-13'

function formatTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}

// '8:00 AM–8:30 AM' style label for a 30-minute slot starting at startMinutes.
function slot(startMinutes) {
  return `${formatTime(startMinutes)}–${formatTime(startMinutes + 30)}`
}

// Builds a reservations object from compact entries:
//   { loc, date, court, slots: [[startMinutes, 'Name'], ...] }
function mkReservations(entries) {
  const out = {}
  for (const e of entries) {
    const key = `${e.loc}|${e.date}|${e.court}`
    if (!out[key]) out[key] = {}
    for (const [start, name] of e.slots) {
      const label = slot(start)
      if (!out[key][label]) out[key][label] = []
      out[key][label].push(name)
    }
  }
  return out
}

function book({ action = 'book', location = PEN, date = TODAY, courtId = 1, slots, names = ['A'], staffApproved = false, reservations = {}, practiceLocations = DEFAULTS, nowMs = NOW }) {
  return validateBooking({ action, location, date, courtId, slots, names, staffApproved, reservations, practiceLocations, nowMs })
}

// --- Booking window (America/Los_Angeles) -----------------------------------

test('booking window: only today and tomorrow are bookable', () => {
  assert.equal(isBookableDay(TODAY, NOW), true)
  assert.equal(isBookableDay(TOMORROW, NOW), true)
  assert.equal(isBookableDay('2026-08-11', NOW), false) // yesterday
  assert.equal(isBookableDay('2026-08-14', NOW), false) // day after tomorrow

  const past = book({ date: '2026-08-11', slots: [slot(480)] })
  assert.equal(past.ok, false)
  assert.match(past.error, /today and tomorrow/)

  const later = book({ date: '2026-08-14', slots: [slot(480)] })
  assert.equal(later.ok, false)
  assert.match(later.error, /today and tomorrow/)

  // Today and tomorrow work (slots in the future relative to 1:15 PM).
  assert.equal(book({ date: TODAY, slots: [slot(810)] }).ok, true) // 1:30 PM
  assert.equal(book({ date: TOMORROW, slots: [slot(480)] }).ok, true)
})

test('the LA timezone decides "today", not UTC or the device timezone', () => {
  assert.equal(laNow(Date.UTC(2026, 7, 12, 23, 30)).dateKey, '2026-08-12') // 4:30 PM PDT
  assert.equal(laNow(Date.UTC(2026, 7, 13, 6, 59)).dateKey, '2026-08-12') // 11:59 PM PDT
  assert.equal(laNow(Date.UTC(2026, 7, 13, 7, 0)).dateKey, '2026-08-13') // midnight PDT
  assert.equal(laNow(Date.UTC(2026, 10, 5, 7, 30)).dateKey, '2026-11-04') // PST: 11:30 PM Nov 4

  // DST-aware offsets
  assert.equal(laOffsetMinutes(Date.UTC(2026, 2, 8, 9, 59)), -480) // last minute of PST
  assert.equal(laOffsetMinutes(Date.UTC(2026, 2, 8, 10, 0)), -420) // first minute of PDT
  assert.equal(laOffsetMinutes(Date.UTC(2026, 6, 1, 12, 0)), -420)
  assert.equal(laOffsetMinutes(Date.UTC(2026, 10, 2, 12, 0)), -480)

  // Late evening in UTC (23:30Z Aug 12 = 4:30 PM PDT Aug 12): Aug 14 is two
  // days away in LA even though UTC already reads the next calendar day.
  const lateUtc = Date.UTC(2026, 7, 12, 23, 30)
  assert.equal(laDayOffset('2026-08-13', lateUtc), 1)
  assert.equal(isBookableDay('2026-08-14', lateUtc), false)
  assert.equal(isBookableDay('2026-08-13', lateUtc), true)
})

test('completed time slots cannot be booked or canceled; the current slot stays available', () => {
  // At 1:15 PM (LA): 12:30-1:00 PM ended; 1:00-1:30 PM still available.
  const N = AFTERNOON_NOW
  assert.equal(isSlotCompleted(TODAY, slot(750), N), true) // 12:30 PM
  assert.equal(isSlotCompleted(TODAY, slot(780), N), false) // 1:00 PM
  assert.equal(isSlotCompleted(TOMORROW, slot(750), N), false) // tomorrow: nothing ended yet
  assert.equal(isSlotCompleted('2026-08-11', slot(480), N), true) // any slot on a past day

  const ended = book({ date: TODAY, slots: [slot(750)], nowMs: N })
  assert.equal(ended.ok, false)
  assert.match(ended.error, /already ended/)

  const current = book({ date: TODAY, slots: [slot(780)], nowMs: N })
  assert.equal(current.ok, true)

  // Cancelling a slot that has ended is rejected too.
  const cancelEnded = book({ action: 'cancel', date: TODAY, slots: [slot(750)], nowMs: N })
  assert.equal(cancelEnded.ok, false)
  assert.match(cancelEnded.error, /already ended/)

  const cancelTomorrow = book({ action: 'cancel', date: TOMORROW, slots: [slot(750)], nowMs: N })
  assert.equal(cancelTomorrow.ok, true)

  // A 60-minute booking whose second half has ended is rejected as a whole.
  const hour = book({ date: TODAY, slots: [slot(720), slot(750)], nowMs: N }) // 12:00-1:00 PM
  assert.equal(hour.ok, false)

  // The current 30-minute slot stays bookable: at 8:05 AM the 8:00-8:30 slot
  // is still available while 7:30-8:00 has ended.
  assert.equal(isSlotCompleted(TODAY, slot(450), NOW), true)
  assert.equal(isSlotCompleted(TODAY, slot(480), NOW), false)
  const early = book({ date: TODAY, slots: [slot(480)] })
  assert.equal(early.ok, true)
})

// --- Session grouping -------------------------------------------------------

test('one 60-minute Peninsula/PLNU booking counts as ONE session', () => {
  const reservations = mkReservations([
    { loc: PEN, date: TODAY, court: 3, slots: [[480, 'A'], [510, 'A']] },
  ])
  const sessions = existingPlayerSessions(reservations, { dateKey: TODAY, name: 'A', practiceLocations: DEFAULTS })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].start, 480)
  assert.deepEqual(sessions[0].slots, [slot(480), slot(510)])

  const plnu = mkReservations([
    { loc: PLNU, date: TODAY, court: 1, slots: [[600, 'A'], [630, 'A']] },
  ])
  assert.equal(existingPlayerSessions(plnu, { dateKey: TODAY, name: 'A', practiceLocations: DEFAULTS }).length, 1)
})

test('two separate 60-minute non-Barnes bookings count as two sessions and are allowed', () => {
  const reservations = mkReservations([
    { loc: PEN, date: TODAY, court: 1, slots: [[480, 'A'], [510, 'A'], [600, 'A'], [630, 'A']] },
  ])
  // 8:00-9:00 and 10:00-11:00 on the same court: two distinct sessions.
  const sessions = existingPlayerSessions(reservations, { dateKey: TODAY, name: 'A', practiceLocations: DEFAULTS })
  assert.equal(sessions.length, 2)
  assert.deepEqual(sessions.map(s => s.start), [480, 600])

  // Booking the second 60-minute session is allowed with no warning needed
  // (10:00 starts 120 minutes after the 8:00 session, outside the 1-hour
  // proximity window).
  const afterFirst = mkReservations([
    { loc: PEN, date: TODAY, court: 1, slots: [[480, 'A'], [510, 'A']] },
  ])
  const result = book({
    courtId: 2,
    slots: [slot(600), slot(630)],
    reservations: afterFirst,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings, [])
})

test('a third session is rejected (hard limit - staff approval cannot bypass it)', () => {
  const reservations = mkReservations([
    { loc: PEN, date: TODAY, court: 1, slots: [[480, 'A'], [510, 'A']] },
    { loc: PEN, date: TODAY, court: 2, slots: [[600, 'A'], [630, 'A']] },
  ])
  const withoutApproval = book({
    courtId: 3,
    slots: [slot(720), slot(750)],
    staffApproved: false,
    reservations,
  })
  assert.equal(withoutApproval.ok, false)
  assert.equal(withoutApproval.isSessionLimitError, true)
  assert.match(withoutApproval.error, /maximum is 2/)

  // Even with staff approval the third session is rejected.
  const withApproval = book({
    courtId: 3,
    slots: [slot(720), slot(750)],
    staffApproved: true,
    reservations,
  })
  assert.equal(withApproval.ok, false)
  assert.equal(withApproval.isSessionLimitError, true)
})

test('a 60-minute non-Barnes booking does NOT warn because of its own two internal slots', () => {
  const result = book({ courtId: 1, slots: [slot(480), slot(510)] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings, [])
})

test('two adjacent Barnes 30-minute reservations count as two sessions and require staff approval', () => {
  const reservations = mkReservations([
    { loc: BARNES, date: TODAY, court: 4, slots: [[480, 'A']] },
  ])
  // Barnes: each 30-minute slot is its own session.
  const sessions = existingPlayerSessions(reservations, { dateKey: TODAY, name: 'A', practiceLocations: DEFAULTS })
  assert.equal(sessions.length, 1)

  // Booking the adjacent 8:30 slot is back-to-back -> warning, and ok (2 sessions).
  const withoutApproval = book({
    location: BARNES,
    courtId: 4,
    slots: [slot(510)],
    reservations,
  })
  assert.equal(withoutApproval.ok, true)
  assert.equal(withoutApproval.warnings.length, 1)
  assert.match(withoutApproval.warnings[0], /staff approval required/)

  const withApproval = book({
    location: BARNES,
    courtId: 4,
    slots: [slot(510)],
    staffApproved: true,
    reservations,
  })
  assert.equal(withApproval.ok, true)
  assert.deepEqual(withApproval.warnings, [])

  // After both are booked, they count as TWO sessions (no grouping at Barnes).
  const both = mkReservations([
    { loc: BARNES, date: TODAY, court: 4, slots: [[480, 'A'], [510, 'A']] },
  ])
  assert.equal(existingPlayerSessions(both, { dateKey: TODAY, name: 'A', practiceLocations: DEFAULTS }).length, 2)

  // A third Barnes slot the same day is over the hard limit.
  const third = book({
    location: BARNES,
    courtId: 4,
    slots: [slot(540)],
    staffApproved: true,
    reservations: both,
  })
  assert.equal(third.ok, false)
  assert.equal(third.isSessionLimitError, true)
})

test('existing consecutive non-Barnes Sheet slots are grouped into one session', () => {
  const reservations = mkReservations([
    { loc: PLNU, date: TOMORROW, court: 2, slots: [[540, 'B'], [570, 'B']] },
  ])
  const sessions = existingPlayerSessions(reservations, { dateKey: TOMORROW, name: 'B', practiceLocations: DEFAULTS })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].start, 540)
  assert.deepEqual(sessions[0].slots, [slot(540), slot(570)])

  // Non-consecutive 30-minute slots stay separate sessions.
  const separate = mkReservations([
    { loc: PLNU, date: TOMORROW, court: 2, slots: [[480, 'B'], [540, 'B']] },
  ])
  assert.equal(existingPlayerSessions(separate, { dateKey: TOMORROW, name: 'B', practiceLocations: DEFAULTS }).length, 2)

  // A session contains at most TWO slots: 90 consecutive minutes = 2 sessions.
  const ninety = mkReservations([
    { loc: PLNU, date: TOMORROW, court: 2, slots: [[480, 'B'], [510, 'B'], [540, 'B']] },
  ])
  assert.equal(existingPlayerSessions(ninety, { dateKey: TOMORROW, name: 'B', practiceLocations: DEFAULTS }).length, 2)
})

test('proximity warnings compare session STARTS, not the two halves of a 60-minute session', () => {
  // Existing: one 60-minute session 10:00-11:00 (start 600).
  const reservations = mkReservations([
    { loc: PEN, date: TODAY, court: 1, slots: [[600, 'A'], [630, 'A']] },
  ])

  // New 60-minute session at 8:00 (start 480): 120 minutes apart -> NO warning.
  const far = book({ courtId: 2, slots: [slot(480), slot(510)], reservations })
  assert.equal(far.ok, true)
  assert.deepEqual(far.warnings, [])

  // New 30-minute session at 9:30 (start 570): within one hour of 10:00 -> warning.
  const close = book({ courtId: 2, slots: [slot(570)], reservations })
  assert.equal(close.ok, true)
  assert.equal(close.warnings.length, 1)

  // New 60-minute session at 11:00 (start 660): back-to-back with the 10:00
  // session -> warning. Its own 11:30 half is part of the same session and
  // does NOT trigger anything extra.
  const backToBack = book({ courtId: 2, slots: [slot(660), slot(690)], reservations })
  assert.equal(backToBack.ok, true)
  assert.equal(backToBack.warnings.length, 1)
  assert.match(backToBack.warnings[0], /staff approval required/)
})

test('multi-player bookings validate every player', () => {
  // A has two 60-minute sessions; B has none.
  const reservations = mkReservations([
    { loc: PEN, date: TODAY, court: 1, slots: [[480, 'A'], [510, 'A']] },
    { loc: PEN, date: TODAY, court: 2, slots: [[600, 'A'], [630, 'A']] },
  ])

  // A rides along on a third session -> the whole booking is rejected.
  const group = book({
    courtId: 3,
    slots: [slot(720), slot(750)],
    names: ['A', 'B'],
    staffApproved: true,
    reservations,
  })
  assert.equal(group.ok, false)
  assert.equal(group.isSessionLimitError, true)
  assert.match(group.error, /A would have 3 practice sessions/)

  // B alone is fine (0 + 1 session).
  const solo = book({
    courtId: 3,
    slots: [slot(720), slot(750)],
    names: ['B'],
    reservations,
  })
  assert.equal(solo.ok, true)
  assert.deepEqual(solo.warnings, [])

  // Proximity warnings are evaluated per player: B has an 8:00 session and C a
  // 9:00 session; a group booking at 9:30 warns for C (30 min) but not B (90 min).
  const mixed = mkReservations([
    { loc: PEN, date: TODAY, court: 1, slots: [[480, 'B']] },
    { loc: PEN, date: TODAY, court: 2, slots: [[540, 'C']] },
  ])
  const groupWarning = book({
    courtId: 3,
    slots: [slot(570)],
    names: ['B', 'C'],
    reservations: mixed,
  })
  assert.equal(groupWarning.ok, true)
  assert.equal(groupWarning.warnings.length, 1)
  assert.match(groupWarning.warnings[0], /C's new/)
  assert.doesNotMatch(groupWarning.warnings[0], /B's new/)
})

test('hidden match-play reservations do not count unless the site is deliberately added', () => {
  // A has two USD slots on the day.
  const reservations = mkReservations([
    { loc: USD, date: TODAY, court: 1, slots: [[480, 'A'], [510, 'A']] },
  ])

  // USD is hidden by default -> zero sessions counted.
  assert.equal(existingPlayerSessions(reservations, { dateKey: TODAY, name: 'A', practiceLocations: DEFAULTS }).length, 0)
  assert.equal(book({ reservations, slots: [slot(480)] }).ok, true)

  // The desk adds USD as an active practice location -> its two adjacent
  // 30-minute slots group into ONE session, and now a third session fails.
  const added = [...DEFAULTS, USD]
  const sessions = existingPlayerSessions(reservations, { dateKey: TODAY, name: 'A', practiceLocations: added })
  assert.equal(sessions.length, 1)

  const second = book({ reservations, practiceLocations: added, slots: [slot(600), slot(630)] })
  assert.equal(second.ok, true)
  assert.deepEqual(second.warnings, []) // 600 - 480 = 120 min -> outside the proximity window

  // A third booking is over the limit once USD is counted.
  const afterSecond = mkReservations([
    { loc: USD, date: TODAY, court: 1, slots: [[480, 'A'], [510, 'A']] },
    { loc: PEN, date: TODAY, court: 1, slots: [[600, 'A'], [630, 'A']] },
  ])
  const third = book({ reservations: afterSecond, practiceLocations: added, courtId: 2, slots: [slot(720), slot(750)], staffApproved: true })
  assert.equal(third.ok, false)
  assert.equal(third.isSessionLimitError, true)
})

test('proposedSession treats a 60-minute booking as one session', () => {
  const p = proposedSession({ location: PEN, date: TODAY, courtId: 1, slots: [slot(480), slot(510)] })
  assert.equal(p.start, 480)
  assert.equal(p.slots.length, 2)

  const single = proposedSession({ location: BARNES, date: TODAY, courtId: 4, slots: [slot(480)] })
  assert.equal(single.start, 480)
  assert.equal(single.slots.length, 1)
})
