// Unit tests for the shared, memoized reservation index and the canonical vs.
// display name handling it is built on.
//
// The Google Sheet stores names canonically as "Last, First" (e.g.
// "Abbey, Stephanie") while the UI shows "First Last" ("Stephanie Abbey").
// Both lookup forms MUST resolve to exactly the same reservation records, and
// the canonical Sheet value must never be rewritten.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReservationIndex,
  mergeCompletedHistory,
  formatMinutes,
} from '../lib/reservation-index.js'
import {
  formatPlayerName,
  nameAliases,
  normalizeNameKey,
  playerColorIndex,
  playerInitials,
} from '../lib/player-names.js'
import { matchRosterQuery } from '../lib/player-names.js'

const BARNES = 'Barnes Tennis Center'
const PEN = 'Peninsula Tennis Club'
const PLNU = 'Point Loma Nazarene College'
const USD = 'USD'

const ABBEY = 'Abbey, Stephanie'
const CHEN = 'Chen, Alice'

const NOW = Date.UTC(2026, 7, 12, 20, 15) // Aug 12, 2026 at 1:15 PM PDT
const TODAY = '2026-08-12'
const YESTERDAY = '2026-08-11'
const TOMORROW = '2026-08-13'
const LATER = '2026-08-14'

function formatTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}
const slot = (start) => `${formatTime(start)}–${formatTime(start + 30)}`

function add(reservations, location, date, court, start, players) {
  const key = `${location}|${date}|${court}`
  reservations[key] ||= {}
  reservations[key][slot(start)] = players
  return reservations
}

// A fixture covering every scenario the index has to handle.
function fixture() {
  const r = {}
  // Past: one non-Barnes 60-minute session shared by two players.
  add(r, PEN, YESTERDAY, 1, 480, [ABBEY, CHEN])
  add(r, PEN, YESTERDAY, 1, 510, [ABBEY, CHEN])
  // Today at Barnes: two separate 30-minute sessions (first already ended).
  add(r, BARNES, TODAY, 4, 750, [ABBEY]) // 12:30–1:00 PM, ended at 1:15 PM
  add(r, BARNES, TODAY, 4, 780, [ABBEY]) // 1:00–1:30 PM, still running
  // Tomorrow at PLNU: one 60-minute session.
  add(r, PLNU, TOMORROW, 2, 480, [ABBEY])
  add(r, PLNU, TOMORROW, 2, 510, [ABBEY])
  // A hidden match-play location beyond tomorrow (view only).
  add(r, USD, LATER, 7, 600, [ABBEY])
  // Somebody else, so filtering is actually exercised.
  add(r, PEN, TOMORROW, 3, 600, [CHEN])
  return r
}

// --- Name helpers -----------------------------------------------------------

test('display names are derived from canonical values without changing them', () => {
  assert.equal(formatPlayerName(ABBEY), 'Stephanie Abbey')
  assert.equal(formatPlayerName('Williams, Venus'), 'Venus Williams')
  assert.equal(formatPlayerName('  Alice Chen  '), 'Alice Chen')
  assert.equal(playerInitials(ABBEY), 'SA')
  assert.equal(playerInitials('Madonna'), 'MA')
})

test('name keys collapse case and whitespace differences between Sheet tabs', () => {
  assert.equal(normalizeNameKey('Abbey, Stephanie'), 'abbey, stephanie')
  assert.equal(normalizeNameKey('  ABBEY ,  Stephanie '), 'abbey, stephanie')
  assert.equal(normalizeNameKey('Abbey,Stephanie'), 'abbey, stephanie')
  assert.deepEqual(nameAliases(ABBEY), ['abbey, stephanie', 'stephanie abbey'])
  assert.deepEqual(nameAliases('Madonna'), ['madonna'])
})

test('player colors are stable across every spelling of the same player', () => {
  // One player must always get one color, whichever name form produced it.
  assert.equal(playerColorIndex(ABBEY), playerColorIndex(' abbey,  Stephanie '))
  assert.equal(playerColorIndex(ABBEY), playerColorIndex('Stephanie Abbey'))
  assert.notEqual(playerColorIndex(ABBEY), playerColorIndex(CHEN))
  assert.ok(playerColorIndex(ABBEY) >= 0 && playerColorIndex(ABBEY) < 8)
})

test('formatMinutes renders 12-hour tournament times', () => {
  assert.equal(formatMinutes(480), '8:00 AM')
  assert.equal(formatMinutes(720), '12:00 PM')
  assert.equal(formatMinutes(780), '1:00 PM')
})

// --- Canonical + display lookup ---------------------------------------------

test('both canonical and First Last lookup forms resolve to the same records', () => {
  const index = buildReservationIndex(fixture())

  const canonical = index.sessionsForPlayer('Abbey, Stephanie')
  const display = index.sessionsForPlayer('Stephanie Abbey')
  assert.ok(canonical.length > 0, 'the canonical form must find reservations')
  assert.deepEqual(display, canonical, 'the display form must return the identical records')

  // Case and whitespace variants of either form work too.
  assert.deepEqual(index.sessionsForPlayer('  stephanie   abbey '), canonical)
  assert.deepEqual(index.sessionsForPlayer('ABBEY,Stephanie'), canonical)

  // Every returned record keeps the untouched canonical Sheet value.
  for (const session of canonical) assert.equal(session.player, ABBEY)
})

test('resolvePlayer maps any lookup form back to the canonical Sheet value', () => {
  const index = buildReservationIndex(fixture())
  assert.equal(index.resolvePlayer('Stephanie Abbey'), ABBEY)
  assert.equal(index.resolvePlayer('abbey, stephanie'), ABBEY)
  assert.equal(index.resolvePlayer('Alice Chen'), CHEN)
  assert.equal(index.resolvePlayer(CHEN), CHEN)
  assert.equal(index.resolvePlayer('Nobody, At All'), null)
})

test('a player search finds every reservation for Abbey and Chen separately', () => {
  const index = buildReservationIndex(fixture())
  assert.equal(index.sessionsForPlayer(ABBEY).length, 5, '1 past + 2 Barnes today + 1 tomorrow + 1 hidden')
  assert.equal(index.sessionsForPlayer('Alice Chen').length, 2, '1 shared past session + 1 tomorrow')
})

// --- Session grouping -------------------------------------------------------

test('Barnes slots stay separate and non-Barnes consecutive slots group into 60 minutes', () => {
  const index = buildReservationIndex(fixture())

  const barnes = index.sessionsForPlayer(ABBEY).filter((s) => s.location === BARNES)
  assert.equal(barnes.length, 2, 'each Barnes 30-minute slot is its own session')
  assert.deepEqual(barnes.map((s) => s.minutes), [30, 30])
  assert.ok(barnes.every((s) => s.barnes === true))

  const plnu = index.sessionsForPlayer(ABBEY).find((s) => s.location === PLNU)
  assert.equal(plnu.slots.length, 2, 'two consecutive non-Barnes slots are ONE session')
  assert.equal(plnu.minutes, 60)
  assert.equal(plnu.timeRange, '8:00 AM–9:00 AM')
})

test('a non-Barnes session never grows past two 30-minute slots', () => {
  const r = {}
  add(r, PEN, TOMORROW, 5, 480, [ABBEY])
  add(r, PEN, TOMORROW, 5, 510, [ABBEY])
  add(r, PEN, TOMORROW, 5, 540, [ABBEY]) // 90 consecutive minutes
  const sessions = buildReservationIndex(r).sessionsForPlayer(ABBEY)
  assert.equal(sessions.length, 2, '90 minutes becomes a 60-minute plus a 30-minute session')
  assert.deepEqual(sessions.map((s) => s.minutes), [60, 30])
})

test('multiple players sharing a session are merged into one court block', () => {
  const index = buildReservationIndex(fixture())
  const blocks = index.blocksForCourt({ dateKey: YESTERDAY, location: PEN, court: 1 })

  assert.equal(blocks.length, 1, 'the shared 60-minute window is a single block')
  assert.deepEqual(blocks[0].players, [CHEN, ABBEY], 'players are sorted by displayed first name')
  assert.equal(blocks[0].minutes, 60)
  assert.equal(blocks[0].timeRange, '8:00 AM–9:00 AM')

  // Both players still get their own session record.
  assert.equal(index.sessionsForPlayer(ABBEY).filter((s) => s.date === YESTERDAY).length, 1)
  assert.equal(index.sessionsForPlayer(CHEN).filter((s) => s.date === YESTERDAY).length, 1)
})

test('court blocks accept a numeric or string court id and ignore unknown courts', () => {
  const index = buildReservationIndex(fixture())
  assert.equal(index.blocksForCourt({ dateKey: TODAY, location: BARNES, court: 4 }).length, 2)
  assert.equal(index.blocksForCourt({ dateKey: TODAY, location: BARNES, court: '4' }).length, 2)
  assert.equal(index.blocksForCourt({ dateKey: TODAY, location: BARNES, court: 99 }).length, 0)
  assert.equal(index.blocksForCourt({}).length, 0)
})

// --- Sections ---------------------------------------------------------------

test('sections split past, current/today and upcoming with the right statuses', () => {
  const index = buildReservationIndex(fixture())
  const sections = index.sectionsForPlayer('Stephanie Abbey', { nowMs: NOW })

  assert.equal(sections.past.length, 1)
  assert.equal(sections.past[0].date, YESTERDAY)
  assert.equal(sections.past[0].status, 'Ended')
  assert.equal(sections.past[0].viewOnly, true)
  assert.equal(sections.past[0].minutes, 60)

  assert.equal(sections.current.length, 2, 'both Barnes slots are today')
  assert.equal(sections.current[0].status, 'Ended', '12:30 PM finished before 1:15 PM')
  assert.equal(sections.current[1].status, 'Today', '1:00–1:30 PM is still running')
  assert.equal(sections.current[1].viewOnly, false)

  assert.equal(sections.upcoming.length, 2)
  assert.equal(sections.upcoming[0].date, TOMORROW)
  assert.equal(sections.upcoming[0].status, 'Upcoming')
  assert.equal(sections.upcoming[0].viewOnly, false, 'tomorrow is still bookable')
})

test('hidden match-play locations remain searchable and are flagged view only', () => {
  const index = buildReservationIndex(fixture())
  const sections = index.sectionsForPlayer(ABBEY, { nowMs: NOW })
  const hidden = sections.upcoming.find((entry) => entry.location === USD)
  assert.ok(hidden, 'a USD reservation must still be found even though USD is hidden by default')
  assert.equal(hidden.viewOnly, true, 'dates beyond tomorrow are view only')
  assert.equal(hidden.status, 'Upcoming')
  assert.ok(index.locations.includes(USD))
})

test('the canonical and display forms produce identical sections', () => {
  const index = buildReservationIndex(fixture())
  const byCanonical = index.sectionsForPlayer('Abbey, Stephanie', { nowMs: NOW })
  const byDisplay = index.sectionsForPlayer('Stephanie Abbey', { nowMs: NOW })
  assert.deepEqual(byDisplay, byCanonical)
})

test('an unknown or empty player yields empty sections instead of throwing', () => {
  const index = buildReservationIndex(fixture())
  for (const value of ['', null, undefined, 'Nobody Here']) {
    const sections = index.sectionsForPlayer(value, { nowMs: NOW })
    assert.deepEqual(sections, { past: [], current: [], upcoming: [] })
  }
})

test('an empty reservations payload builds a usable empty index', () => {
  for (const empty of [{}, null, undefined]) {
    const index = buildReservationIndex(empty)
    assert.deepEqual(index.sessions, [])
    assert.deepEqual(index.players, [])
    assert.deepEqual(index.sessionsForPlayer(ABBEY), [])
    assert.deepEqual(index.sectionsForPlayer(ABBEY, { nowMs: NOW }), { past: [], current: [], upcoming: [] })
  }
})

test('the index is built in a single pass over every date and location', () => {
  const index = buildReservationIndex(fixture())
  assert.deepEqual(index.dates, [YESTERDAY, TODAY, TOMORROW, LATER])
  assert.deepEqual([...index.players].sort(), [ABBEY, CHEN].sort())
  // Every session appears exactly once in the flat list.
  assert.equal(index.sessions.length, index.sessionsForPlayer(ABBEY).length + index.sessionsForPlayer(CHEN).length)
})

// --- Root cause of the broken search: pruned ended slots --------------------

test('ended slots from history are merged for display without touching live data', () => {
  // The v2.1 Apps Script strips ENDED slots from getSchedule, which is why a
  // player's past reservations used to disappear from the search entirely.
  const live = {}
  add(live, PLNU, TOMORROW, 2, 480, [ABBEY])

  const history = {}
  add(history, PEN, YESTERDAY, 1, 480, [ABBEY]) // ended, only in history
  add(history, PEN, YESTERDAY, 1, 510, [ABBEY])
  add(history, PLNU, TOMORROW, 2, 480, [ABBEY]) // still live, must not duplicate
  add(history, PLNU, TOMORROW, 9, 480, [CHEN]) // NOT ended -> must be ignored

  const merged = mergeCompletedHistory(live, history, NOW)
  const index = buildReservationIndex(merged)

  const sections = index.sectionsForPlayer(ABBEY, { nowMs: NOW })
  assert.equal(sections.past.length, 1, 'the past session is visible again')
  assert.equal(sections.past[0].minutes, 60)
  assert.equal(sections.upcoming.length, 1, 'the live session is not duplicated')

  // A future slot that only exists in the stale history is never resurrected,
  // so a pending cancellation can not be undone by the history merge.
  assert.equal(merged[`${PLNU}|${TOMORROW}|9`], undefined)
})

test('merging history is a no-op when there is nothing to merge', () => {
  const live = {}
  add(live, PLNU, TOMORROW, 2, 480, [ABBEY])
  assert.equal(mergeCompletedHistory(live, null, NOW), live)
  assert.equal(mergeCompletedHistory(live, {}, NOW), live)
})

// --- Roster search ----------------------------------------------------------

test('the roster search matches canonical and display forms, exact matches first', () => {
  const roster = [ABBEY, CHEN, 'Abbeyson, Nina', 'Waters, Eadan']

  assert.deepEqual(matchRosterQuery(roster, 'Abbey, Stephanie')[0], ABBEY)
  assert.deepEqual(matchRosterQuery(roster, 'Stephanie Abbey')[0], ABBEY)
  // A full display name must win over a longer partial match on the surname.
  assert.equal(matchRosterQuery(roster, 'stephanie abbey')[0], ABBEY)
  // Partial matches on either the first or the last name still work.
  assert.ok(matchRosterQuery(roster, 'abbey').includes('Abbeyson, Nina'))
  assert.deepEqual(matchRosterQuery(roster, 'alice'), [CHEN])
  assert.deepEqual(matchRosterQuery(roster, 'chen'), [CHEN])
  assert.deepEqual(matchRosterQuery(roster, 'zzz'), [])
  assert.deepEqual(matchRosterQuery(roster, ''), [])
})
