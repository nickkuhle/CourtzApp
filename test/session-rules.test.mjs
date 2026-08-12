import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PRACTICE_DEFAULT_LOCATIONS,
  slotRange,
  groupSlots,
  playerParts,
  playerSessions,
  sessionsClose,
  validateSessionBooking,
} from '../lib/session-rules.js'

const DATE = '2026-08-12'
const PENINSULA = 'Peninsula Tennis Club'
const BARNES = 'Barnes Tennis Center'
const USD = 'USD'

const S = {
  s0800: '8:00 AM–8:30 AM',
  s0830: '8:30 AM–9:00 AM',
  s0900: '9:00 AM–9:30 AM',
  s0930: '9:30 AM–10:00 AM',
  s1000: '10:00 AM–10:30 AM',
  s1030: '10:30 AM–11:00 AM',
  s1100: '11:00 AM–11:30 AM',
  s1400: '2:00 PM–2:30 PM',
}

// Builds a reservations map for one player on one court.
function courtReservations(location, date, court, name, slots) {
  const key = `${location}|${date}|${court}`
  const slotsMap = {}
  for (const slot of slots) slotsMap[slot] = [name]
  return { [key]: slotsMap }
}

// Merges several single-court reservation maps (same key would otherwise
// overwrite each other).
function mergeReservations(...maps) {
  const out = {}
  for (const map of maps) {
    for (const [key, slotsMap] of Object.entries(map)) {
      if (!out[key]) out[key] = {}
      Object.assign(out[key], slotsMap)
    }
  }
  return out
}

test('slotRange parses 30-minute slot labels into minutes', () => {
  assert.deepEqual(slotRange(S.s0800), { start: 480, end: 510 })
  assert.deepEqual(slotRange('1:00 PM–1:30 PM'), { start: 780, end: 810 })
  assert.equal(slotRange('not a slot'), null)
})

test('one 60-minute Peninsula booking counts as one session', () => {
  const reservations = courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s0800, S.s0830])
  const sessions = playerSessions({
    reservations,
    date: DATE,
    player: 'Player A',
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
  })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].start, 480) // 8:00 AM
  assert.equal(sessions[0].end, 540) // 9:00 AM
  assert.equal(sessions[0].parts.length, 2)

  const validation = validateSessionBooking({
    reservations: {},
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 1,
    slots: [S.s0800, S.s0830],
    names: ['Player A'],
  })
  assert.deepEqual(validation.overLimit, [])
  assert.deepEqual(validation.warnings, [])
})

test('two separate 60-minute non-Barnes bookings count as two sessions and are allowed', () => {
  const reservations = mergeReservations(
    courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s0800, S.s0830]),
    courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s1000, S.s1030]),
  )
  const sessions = playerSessions({
    reservations,
    date: DATE,
    player: 'Player A',
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
  })
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].start, 480)
  assert.equal(sessions[1].start, 600) // 10:00 AM

  // Booking a second 60-minute session two hours after the first: allowed,
  // no warning.
  const validation = validateSessionBooking({
    reservations: courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s0800, S.s0830]),
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 1,
    slots: [S.s1000, S.s1030],
    names: ['Player A'],
  })
  assert.deepEqual(validation.overLimit, [])
  assert.deepEqual(validation.warnings, [])
})

test('a third session is rejected (hard limit, never bypassable)', () => {
  const existing = mergeReservations(
    courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s0800, S.s0830]),
    courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s1000, S.s1030]),
  )
  const validation = validateSessionBooking({
    reservations: existing,
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 2,
    slots: [S.s1400, '2:30 PM–3:00 PM'],
    names: ['Player A'],
  })
  assert.deepEqual(validation.overLimit, ['Player A'])
})

test('a 60-minute non-Barnes booking does not warn because of its own two internal slots', () => {
  // No existing reservations at all; the booking itself spans two adjacent
  // Sheet slots. The internal halves must never warn against each other.
  const validation = validateSessionBooking({
    reservations: {},
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 1,
    slots: [S.s0800, S.s0830],
    names: ['Player A'],
  })
  assert.deepEqual(validation.warnings, [])
  assert.deepEqual(validation.overLimit, [])
})

test('two adjacent Barnes 30-minute reservations count as two sessions and require staff approval', () => {
  // Barnes: every occupied 30-minute slot is one session.
  const reservations = courtReservations(BARNES, DATE, 4, 'Player A', [S.s0800, S.s0830])
  const sessions = playerSessions({
    reservations,
    date: DATE,
    player: 'Player A',
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
  })
  assert.equal(sessions.length, 2)

  // Booking the second adjacent slot against the first must warn.
  const validation = validateSessionBooking({
    reservations: courtReservations(BARNES, DATE, 4, 'Player A', [S.s0800]),
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: BARNES,
    date: DATE,
    courtId: 4,
    slots: [S.s0830],
    names: ['Player A'],
  })
  assert.deepEqual(validation.overLimit, []) // still within the max of 2
  assert.equal(validation.warnings.length, 1)
  assert.equal(validation.warnings[0].player, 'Player A')
})

test('existing consecutive non-Barnes Sheet slots are grouped into one session', () => {
  // Same player + date + location + court, two consecutive 30-minute slots in
  // the sheet -> one 60-minute session.
  const reservations = courtReservations(PENINSULA, DATE, 3, 'Player B', [S.s0900, S.s0930])
  const sessions = playerSessions({
    reservations,
    date: DATE,
    player: 'Player B',
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
  })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].start, 540) // 9:00 AM
  assert.equal(sessions[0].end, 600) // 10:00 AM
})

test('proximity warnings compare session starts, not the internal halves of a 60-minute session', () => {
  // Existing 60-minute session 8:00–9:00 AM. A proposed 60-minute booking at
  // 9:00 AM is back-to-back with it -> warn (start-to-start distance is 60,
  // which only the back-to-back rule catches - the halves are never compared).
  const backToBack = validateSessionBooking({
    reservations: courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s0800, S.s0830]),
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 1,
    slots: [S.s0900, S.s0930],
    names: ['Player A'],
  })
  assert.equal(backToBack.warnings.length, 1)

  // Existing 60-minute session 8:00–9:00 AM; proposed session at 9:30 AM.
  // If the old internal half (8:30–9:00) were compared, |9:30 - 9:00| = 30
  // would falsely warn. Comparing session starts (9:30 vs 8:00) there is a
  // 90-minute gap -> no warning.
  const gap = validateSessionBooking({
    reservations: courtReservations(PENINSULA, DATE, 1, 'Player A', [S.s0800, S.s0830]),
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 1,
    slots: [S.s0930, S.s1000],
    names: ['Player A'],
  })
  assert.deepEqual(gap.warnings, [])
  assert.deepEqual(gap.overLimit, [])

  // "Within one hour of another session's start": existing 60-minute session
  // starts 8:00; a new session starting 8:30 (overlapping) warns.
  const overlapping = validateSessionBooking({
    reservations: courtReservations(PENINSULA, DATE, 2, 'Player A', [S.s0800, S.s0830]),
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 2,
    slots: [S.s0830, S.s0900],
    names: ['Player A'],
  })
  assert.equal(overlapping.warnings.length, 1)
})

test('a session contains at most two slots (three consecutive slots = two sessions)', () => {
  const reservations = courtReservations(PENINSULA, DATE, 5, 'Player C', [S.s0800, S.s0830, S.s0900])
  const sessions = playerSessions({
    reservations,
    date: DATE,
    player: 'Player C',
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
  })
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].start, 480) // 8:00–9:00
  assert.equal(sessions[0].end, 540)
  assert.equal(sessions[1].start, 540) // 9:00–9:30
  assert.equal(sessions[1].end, 570)
})

test('multi-player bookings validate every player', () => {
  const bFirst = courtReservations(PENINSULA, DATE, 1, 'Player B', [S.s0800, S.s0830])
  const bSecond = courtReservations(PENINSULA, DATE, 1, 'Player B', [S.s1000, S.s1030])
  const bKey = `${PENINSULA}|${DATE}|1`
  const reservations = {
    // Player A: close sessions (would warn)
    ...courtReservations(BARNES, DATE, 4, 'Player A', [S.s0800]),
    // Player B: already at the hard maximum (two 60-minute sessions, same court)
    [bKey]: { ...bFirst[bKey], ...bSecond[bKey] },
  }
  const validation = validateSessionBooking({
    reservations,
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: BARNES,
    date: DATE,
    courtId: 4,
    slots: [S.s0830],
    names: ['Player A', 'Player B', 'Player C'],
  })
  assert.deepEqual(validation.overLimit, ['Player B'])
  const warnedPlayers = validation.warnings.map((w) => w.player)
  // A's Barnes session is back-to-back with the booking -> staff approval.
  assert.ok(warnedPlayers.includes('Player A'))
  // B is close to the booking too (its 8:00 session starts within the hour),
  // so B gets the proximity warning IN ADDITION to the hard limit rejection.
  assert.ok(warnedPlayers.includes('Player B'))
  assert.ok(!warnedPlayers.includes('Player C')) // no existing sessions at all
})

test('hidden match-play site reservations do not count unless the site is active', () => {
  // Player D holds two 60-minute sessions at USD (a hidden match-play site).
  const usdReservations = mergeReservations(
    courtReservations(USD, DATE, 1, 'Player D', [S.s0800, S.s0830]),
    courtReservations(USD, DATE, 1, 'Player D', [S.s1000, S.s1030]),
  )
  // Without USD in the active list those sessions are ignored: a Peninsula
  // booking is allowed with no warning.
  const withoutUsd = validateSessionBooking({
    reservations: usdReservations,
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: PENINSULA,
    date: DATE,
    courtId: 1,
    slots: [S.s1400],
    names: ['Player D'],
  })
  assert.deepEqual(withoutUsd.overLimit, [])
  assert.deepEqual(withoutUsd.warnings, [])

  // Once the desk deliberately adds USD as an active practice location, the
  // same booking becomes the third session of the day and is rejected.
  const withUsd = validateSessionBooking({
    reservations: usdReservations,
    activeLocations: [...PRACTICE_DEFAULT_LOCATIONS, USD],
    location: PENINSULA,
    date: DATE,
    courtId: 1,
    slots: [S.s1400],
    names: ['Player D'],
  })
  assert.deepEqual(withUsd.overLimit, ['Player D'])
})

test('sessions count across locations and courts (not just one court)', () => {
  const reservations = {
    ...courtReservations(PENINSULA, DATE, 1, 'Player E', [S.s0800, S.s0830]), // session 1
    ...courtReservations(PENINSULA, DATE, 7, 'Player E', [S.s1000, S.s1030]), // session 2 (different court)
  }
  const validation = validateSessionBooking({
    reservations,
    activeLocations: PRACTICE_DEFAULT_LOCATIONS,
    location: BARNES,
    date: DATE,
    courtId: 4,
    slots: [S.s1400],
    names: ['Player E'],
  })
  assert.deepEqual(validation.overLimit, ['Player E'])
})

test('groupSlots merges only consecutive parts and sessionsClose only flags close starts', () => {
  const parts = [
    { start: 480, end: 510, location: 'X', court: '1' },
    { start: 510, end: 540, location: 'X', court: '1' },
    { start: 600, end: 630, location: 'X', court: '1' },
  ]
  const sessions = groupSlots(parts)
  assert.equal(sessions.length, 2)
  assert.deepEqual(
    sessions.map((s) => [s.start, s.end]),
    [
      [480, 540],
      [600, 630],
    ],
  )
  assert.equal(sessionsClose({ start: 540, end: 600 }, { start: 480, end: 540 }), true) // back-to-back
  assert.equal(sessionsClose({ start: 480, end: 540 }, { start: 495, end: 525 }), true) // starts within an hour
  assert.equal(sessionsClose({ start: 600, end: 630 }, { start: 480, end: 510 }), false) // 2 hours apart, gap
})
