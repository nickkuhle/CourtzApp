import assert from 'node:assert/strict'
import test from 'node:test'

import {
  courtSessionBlocks,
  currentReservationPlayers,
  describeFocusedSession,
  formatPlayerFirstName,
  formatPlayerName,
  playerColorIndex,
  playerInitials,
  playerReservationSections,
} from '../lib/schedule-display.js'

const BARNES = 'Barnes Tennis Center'
const PEN = 'Peninsula Tennis Club'
const PLAYER = 'Abbey, Stephanie'
const SECOND_PLAYER = 'Chen, Alice'
const NOW = Date.UTC(2026, 7, 12, 20, 15) // Aug 12, 2026 at 1:15 PM PDT

function formatTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}

function slot(start) {
  return `${formatTime(start)}–${formatTime(start + 30)}`
}

function add(reservations, location, date, court, start, players) {
  const key = `${location}|${date}|${court}`
  reservations[key] ||= {}
  reservations[key][slot(start)] = players
  return reservations
}

test('player display helpers reformat canonical names without changing their value', () => {
  assert.equal(formatPlayerName(PLAYER), 'Stephanie Abbey')
  assert.equal(formatPlayerName('  Alice Chen  '), 'Alice Chen')
  assert.equal(formatPlayerName('Williams, Venus'), 'Venus Williams')
  assert.equal(playerInitials(PLAYER), 'SA')
  assert.equal(playerInitials('Madonna'), 'MA')

  assert.equal(playerColorIndex(PLAYER), playerColorIndex(PLAYER), 'the same canonical player keeps the same color')
  assert.ok(playerColorIndex(PLAYER) >= 0)
  assert.ok(playerColorIndex(PLAYER) < 8)
})

test('court display blocks group two non-Barnes halves and merge players sharing a session', () => {
  const reservations = {}
  add(reservations, PEN, '2026-08-12', 3, 480, [PLAYER, SECOND_PLAYER])
  add(reservations, PEN, '2026-08-12', 3, 510, [PLAYER, SECOND_PLAYER])
  add(reservations, PEN, '2026-08-12', 3, 540, [PLAYER])

  const blocks = courtSessionBlocks(reservations, {
    dateKey: '2026-08-12',
    location: PEN,
    court: 3,
  })

  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0].slots, [slot(480), slot(510)])
  assert.deepEqual(blocks[0].players, [SECOND_PLAYER, PLAYER], 'players are sorted by their displayed first name')
  assert.equal(blocks[0].timeRange, '8:00 AM–9:00 AM')
  assert.deepEqual(blocks[1].slots, [slot(540)])
  assert.equal(blocks[1].timeRange, '9:00 AM–9:30 AM')
})

test('court display blocks keep every Barnes 30-minute slot separate', () => {
  const reservations = {}
  add(reservations, BARNES, '2026-08-12', 4, 480, [PLAYER])
  add(reservations, BARNES, '2026-08-12', 4, 510, [PLAYER])

  const blocks = courtSessionBlocks(reservations, {
    dateKey: '2026-08-12',
    location: BARNES,
    court: '4',
  })

  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks.map((block) => block.slots.length), [1, 1])
  assert.deepEqual(blocks.map((block) => block.timeRange), ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM'])
})

test('focused session prefers the reservation on court now, then the next one', () => {
  const reservations = {}
  add(reservations, BARNES, '2026-08-12', 4, 720, [PLAYER]) // 12:00–12:30, already ended
  add(reservations, BARNES, '2026-08-12', 4, 780, [PLAYER, SECOND_PLAYER]) // 1:00–1:30, current at 1:15
  add(reservations, BARNES, '2026-08-12', 4, 840, [SECOND_PLAYER]) // 2:00–2:30, later

  const blocks = courtSessionBlocks(reservations, {
    dateKey: '2026-08-12',
    location: BARNES,
    court: 4,
  })

  const current = describeFocusedSession(blocks, { dateKey: '2026-08-12', nowMs: NOW })
  assert.equal(current.kind, 'current')
  assert.equal(current.block.timeRange, '1:00 PM–1:30 PM')
  assert.deepEqual(currentReservationPlayers(blocks, { dateKey: '2026-08-12', nowMs: NOW }), [SECOND_PLAYER, PLAYER])

  const afterCurrent = Date.UTC(2026, 7, 12, 20, 40) // 1:40 PM PDT
  const next = describeFocusedSession(blocks, { dateKey: '2026-08-12', nowMs: afterCurrent })
  assert.equal(next.kind, 'next')
  assert.equal(next.block.timeRange, '2:00 PM–2:30 PM')
  assert.deepEqual(currentReservationPlayers(blocks, { dateKey: '2026-08-12', nowMs: afterCurrent }), [])

  const tomorrow = describeFocusedSession(blocks, { dateKey: '2026-08-13', nowMs: NOW })
  assert.equal(tomorrow.kind, 'next')
  assert.equal(tomorrow.index, 0)

  assert.equal(describeFocusedSession([], { dateKey: '2026-08-12', nowMs: NOW }).index, -1)
  assert.equal(formatPlayerFirstName(PLAYER), 'Stephanie')
})

test('player reservation search covers every location and splits past, today, and upcoming', () => {
  const reservations = {}
  add(reservations, PEN, '2026-08-11', 1, 480, [PLAYER])
  add(reservations, PEN, '2026-08-11', 1, 510, [PLAYER])
  add(reservations, BARNES, '2026-08-12', 4, 750, [PLAYER]) // ended at 1 PM
  add(reservations, BARNES, '2026-08-12', 4, 780, [PLAYER]) // current at 1:15 PM
  add(reservations, PEN, '2026-08-13', 2, 480, [PLAYER])
  add(reservations, PEN, '2026-08-13', 2, 510, [PLAYER])
  add(reservations, 'USD', '2026-08-14', 7, 600, [PLAYER])
  add(reservations, PEN, '2026-08-13', 3, 600, [SECOND_PLAYER])

  const sections = playerReservationSections(reservations, PLAYER, { nowMs: NOW })

  assert.equal(sections.past.length, 1)
  assert.equal(sections.past[0].timeRange, '8:00 AM–9:00 AM')
  assert.equal(sections.past[0].status, 'Ended')
  assert.equal(sections.past[0].viewOnly, true)

  assert.equal(sections.current.length, 2, 'Barnes slots stay separate today')
  assert.equal(sections.current[0].status, 'Ended')
  assert.equal(sections.current[1].status, 'Today')
  assert.equal(sections.current[1].viewOnly, false)

  assert.equal(sections.upcoming.length, 2)
  assert.equal(sections.upcoming[0].date, '2026-08-13')
  assert.equal(sections.upcoming[0].slots.length, 2, 'tomorrow is one non-Barnes 60-minute session')
  assert.equal(sections.upcoming[0].status, 'Upcoming')
  assert.equal(sections.upcoming[0].viewOnly, false, 'tomorrow remains bookable')
  assert.equal(sections.upcoming[1].location, 'USD', 'hidden match sites are still searchable')
  assert.equal(sections.upcoming[1].viewOnly, true, 'dates beyond tomorrow are view only')
})
