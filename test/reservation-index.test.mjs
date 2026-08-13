// Regression tests for the single memoized reservation index and the player
// reservation search it powers.
//
// The names used here are the canonical Sheet form ("Last, First"). Every test
// that looks a player up ALSO looks them up by the displayed "First Last" form
// and asserts both resolve to the exact same records.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EMPTY_RESERVATION_INDEX,
  buildReservationIndex,
  formatPlayerName,
  mergeEndedReservations,
  nameAliases,
  nameTokenKey,
  normalizeNameKey,
  resolveCanonicalName,
} from '../lib/reservation-index.js'
import { existingPlayerSessions } from '../lib/booking-rules.js'

const BARNES = 'Barnes Tennis Center'
const PEN = 'Peninsula Tennis Club'
const PLNU = 'Point Loma Nazarene College'
const USD = 'USD'
const BALBOA = 'Balboa Tennis Center'

const ABBEY = 'Abbey, Stephanie'
const CHEN = 'Chen, Alice'

// Aug 12, 2026 at 1:15 PM PDT — the fixed "now" every assertion is written for.
const NOW = Date.UTC(2026, 7, 12, 20, 15)
const YESTERDAY = '2026-08-11'
const TODAY = '2026-08-12'
const TOMORROW = '2026-08-13'
const LATER = '2026-08-14'

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

// A realistic multi-location, multi-day fixture reused by most tests.
function fixture() {
  const r = {}
  // Past: Peninsula 60-minute session shared by two players.
  add(r, PEN, YESTERDAY, 1, 480, [ABBEY, CHEN])
  add(r, PEN, YESTERDAY, 1, 510, [ABBEY, CHEN])
  // Today at Barnes: two SEPARATE 30-minute sessions, the first already ended.
  add(r, BARNES, TODAY, 4, 750, [ABBEY]) // 12:30–1:00 PM, ended at 1:15 PM
  add(r, BARNES, TODAY, 4, 780, [ABBEY]) // 1:00–1:30 PM, still running
  // Tomorrow: a non-Barnes 60-minute session and a PLNU 30-minute session.
  add(r, PEN, TOMORROW, 2, 600, [ABBEY, CHEN])
  add(r, PEN, TOMORROW, 2, 630, [ABBEY, CHEN])
  add(r, PLNU, TOMORROW, 5, 540, [CHEN])
  // Hidden match-play locations, on a view-only day.
  add(r, USD, LATER, 7, 600, [ABBEY])
  add(r, BALBOA, LATER, 3, 600, [CHEN])
  return r
}

// --- Name aliases -----------------------------------------------------------

test('name helpers normalize canonical and display forms to the same keys', () => {
  assert.equal(formatPlayerName(ABBEY), 'Stephanie Abbey')
  assert.equal(formatPlayerName('Stephanie Abbey'), 'Stephanie Abbey')
  assert.equal(normalizeNameKey('  ABBEY,   Stephanie '), 'abbey stephanie')
  assert.equal(normalizeNameKey("O'Brien, Mary"), 'obrien mary')
  assert.equal(nameTokenKey(ABBEY), nameTokenKey('Stephanie Abbey'))
  assert.equal(nameTokenKey(CHEN), nameTokenKey('  alice   CHEN  '))
  assert.deepEqual(nameAliases(ABBEY), ['abbey stephanie', 'stephanie abbey'])
})

test('resolveCanonicalName maps typed text back to the canonical Sheet value', () => {
  const roster = [ABBEY, CHEN, 'Waters, Eadan']
  assert.equal(resolveCanonicalName('Abbey, Stephanie', roster), ABBEY)
  assert.equal(resolveCanonicalName('Stephanie Abbey', roster), ABBEY)
  assert.equal(resolveCanonicalName('  stephanie   abbey ', roster), ABBEY)
  assert.equal(resolveCanonicalName('ALICE CHEN', roster), CHEN)
  assert.equal(resolveCanonicalName('Nobody Here', roster), null)
  assert.equal(resolveCanonicalName('', roster), null)
  // The canonical value is returned verbatim — never reformatted.
  assert.equal(resolveCanonicalName('Stephanie Abbey', roster), 'Abbey, Stephanie')
})

// --- Lookup -----------------------------------------------------------------

test('canonical and display-name lookups resolve to identical reservation records', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })

  assert.equal(index.lookup(ABBEY), ABBEY)
  assert.equal(index.lookup('Stephanie Abbey'), ABBEY)
  assert.equal(index.lookup('stephanie abbey'), ABBEY)
  assert.equal(index.lookup('  Abbey,  Stephanie '), ABBEY)
  assert.equal(index.lookup('Not, Aplayer'), null)

  const canonical = index.sessionsFor(ABBEY)
  const display = index.sessionsFor('Stephanie Abbey')
  assert.ok(canonical.length > 0)
  assert.deepEqual(display, canonical, 'both lookup forms return the same records')
  assert.deepEqual(index.sessionsFor('Alice Chen'), index.sessionsFor(CHEN))

  // Records always carry the untouched canonical Sheet value.
  for (const session of display) assert.equal(session.player, ABBEY)
})

test('sessionsFor returns nothing for an unknown player instead of throwing', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  assert.deepEqual(index.sessionsFor('Ghost, Player'), [])
  assert.deepEqual(index.sessionsFor(''), [])
  assert.deepEqual(index.sessionsFor(null), [])
  assert.deepEqual(EMPTY_RESERVATION_INDEX.sessionsFor(ABBEY), [])
  assert.equal(EMPTY_RESERVATION_INDEX.sections(ABBEY).total, 0)
})

test('whitespace and casing differences between roster and Sheet values still match', () => {
  const reservations = {}
  add(reservations, PEN, TOMORROW, 1, 480, ['  Abbey,  Stephanie  '])
  const index = buildReservationIndex(reservations, { nowMs: NOW })

  // The Sheet cell is stored trimmed, and both lookup forms find it.
  assert.equal(index.lookup(ABBEY), 'Abbey,  Stephanie')
  assert.equal(index.lookup('Stephanie Abbey'), 'Abbey,  Stephanie')
  assert.equal(index.sessionsFor(ABBEY).length, 1)
  assert.equal(index.sessionsFor('stephanie abbey').length, 1)
})

// --- Session grouping -------------------------------------------------------

test('Barnes reservations stay separate 30-minute sessions', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  const barnes = index.sessionsFor(ABBEY).filter((s) => s.location === BARNES)

  assert.equal(barnes.length, 2, 'two consecutive Barnes slots are two sessions')
  assert.deepEqual(barnes.map((s) => s.durationMinutes), [30, 30])
  assert.deepEqual(barnes.map((s) => s.slots.length), [1, 1])
  assert.deepEqual(barnes.map((s) => s.timeRange), ['12:30 PM–1:00 PM', '1:00 PM–1:30 PM'])
  assert.ok(barnes.every((s) => s.isBarnes))
})

test('non-Barnes consecutive slots group into one 60-minute session', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  const peninsula = index.sessionsFor(ABBEY).filter((s) => s.location === PEN)

  assert.equal(peninsula.length, 2, 'four 30-minute slots across two days = two sessions')
  assert.ok(peninsula.every((s) => s.durationMinutes === 60))
  assert.ok(peninsula.every((s) => s.slots.length === 2))
  assert.equal(peninsula[0].timeRange, '8:00 AM–9:00 AM')
  assert.equal(peninsula[1].timeRange, '10:00 AM–11:00 AM')
})

test('index grouping matches existingPlayerSessions exactly (the booking rules)', () => {
  const reservations = fixture()
  const index = buildReservationIndex(reservations, { nowMs: NOW })
  const practiceLocations = [BARNES, PEN, PLNU]

  for (const date of [YESTERDAY, TODAY, TOMORROW]) {
    for (const player of [ABBEY, CHEN]) {
      const fromRules = existingPlayerSessions(reservations, { dateKey: date, name: player, practiceLocations })
        .map((s) => `${s.location}|${s.court}|${s.start}|${s.slots.join(',')}`)
        .sort()
      const fromIndex = index
        .sessionsFor(player)
        .filter((s) => s.date === date && practiceLocations.includes(s.location))
        .map((s) => `${s.location}|${s.court}|${s.start}|${s.slots.join(',')}`)
        .sort()
      assert.deepEqual(fromIndex, fromRules, `${player} on ${date}`)
    }
  }
})

test('three consecutive non-Barnes slots become a 60-minute plus a 30-minute session', () => {
  const reservations = {}
  add(reservations, PEN, TOMORROW, 3, 480, [ABBEY])
  add(reservations, PEN, TOMORROW, 3, 510, [ABBEY])
  add(reservations, PEN, TOMORROW, 3, 540, [ABBEY])

  const sessions = buildReservationIndex(reservations, { nowMs: NOW }).sessionsFor('Stephanie Abbey')
  assert.deepEqual(sessions.map((s) => s.durationMinutes), [60, 30])
})

// --- Court blocks / shared players -----------------------------------------

test('multiple players sharing a session produce ONE shared court block', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  const blocks = index.blocksFor({ date: YESTERDAY, location: PEN, court: 1 })

  assert.equal(blocks.length, 1, 'both players share a single 60-minute block')
  assert.deepEqual(blocks[0].players, [CHEN, ABBEY], 'sorted by displayed first name')
  assert.deepEqual(blocks[0].slots, [slot(480), slot(510)])
  assert.equal(blocks[0].timeRange, '8:00 AM–9:00 AM')

  // Both players still get their own individual session record.
  assert.equal(index.sessionsFor(ABBEY).filter((s) => s.date === YESTERDAY).length, 1)
  assert.equal(index.sessionsFor('Alice Chen').filter((s) => s.date === YESTERDAY).length, 1)
})

test('blocksFor keeps Barnes 30-minute previews separate and tolerates court types', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })

  const barnes = index.blocksFor({ date: TODAY, location: BARNES, court: 4 })
  assert.equal(barnes.length, 2)
  assert.deepEqual(barnes.map((b) => b.slots.length), [1, 1])

  // Numeric and string court ids address the same block.
  assert.deepEqual(index.blocksFor({ date: TODAY, location: BARNES, court: '4' }), barnes)
  assert.deepEqual(index.blocksFor({ date: TODAY, location: BARNES, court: 99 }), [])
  assert.deepEqual(index.blocksFor({}), [])
})

// --- Past / current / upcoming sections ------------------------------------

test('sections split past, current/today and upcoming across every location', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  const sections = index.sections(ABBEY, { nowMs: NOW })

  assert.equal(sections.player, ABBEY, 'the resolved canonical player is reported')
  assert.equal(sections.total, 5)

  assert.equal(sections.past.length, 1)
  assert.equal(sections.past[0].location, PEN)
  assert.equal(sections.past[0].status, 'Ended')
  assert.equal(sections.past[0].viewOnly, true)
  assert.equal(sections.past[0].durationMinutes, 60)

  assert.equal(sections.current.length, 2, 'Barnes slots stay separate today')
  assert.equal(sections.current[0].status, 'Ended', 'the 12:30 PM slot finished at 1:00 PM')
  assert.equal(sections.current[0].ended, true)
  assert.equal(sections.current[1].status, 'Today', 'the 1:00 PM slot is still running at 1:15 PM')
  assert.equal(sections.current[1].ended, false)
  assert.equal(sections.current[1].viewOnly, false)

  assert.equal(sections.upcoming.length, 2)
  assert.equal(sections.upcoming[0].date, TOMORROW)
  assert.equal(sections.upcoming[0].status, 'Upcoming')
  assert.equal(sections.upcoming[0].viewOnly, false, 'tomorrow is still bookable')
  assert.equal(sections.upcoming[1].location, USD, 'hidden match sites are searchable')
  assert.equal(sections.upcoming[1].viewOnly, true, 'dates beyond tomorrow are view only')
})

test('sections are identical whether searched by canonical or display name', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  const canonical = index.sections('Abbey, Stephanie', { nowMs: NOW })
  const display = index.sections('Stephanie Abbey', { nowMs: NOW })
  assert.deepEqual(display, canonical)

  const chenCanonical = index.sections('Chen, Alice', { nowMs: NOW })
  const chenDisplay = index.sections('Alice Chen', { nowMs: NOW })
  assert.deepEqual(chenDisplay, chenCanonical)
  assert.equal(chenCanonical.total, 4, 'Chen: past Peninsula, tomorrow Peninsula + PLNU, Balboa')
})

test('hidden match-play locations are included in the search results', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  const locations = index.sections('Alice Chen', { nowMs: NOW }).upcoming.map((e) => e.location)
  assert.ok(locations.includes(BALBOA), 'Balboa is hidden in the UI but still searchable')
  assert.ok(index.sections(ABBEY, { nowMs: NOW }).upcoming.some((e) => e.location === USD))
})

test('past entries read most-recent-first while today and upcoming read chronologically', () => {
  const reservations = {}
  add(reservations, PEN, '2026-08-09', 1, 480, [ABBEY])
  add(reservations, PEN, YESTERDAY, 1, 480, [ABBEY])
  add(reservations, PEN, TOMORROW, 1, 600, [ABBEY])
  add(reservations, PEN, LATER, 1, 480, [ABBEY])

  const sections = buildReservationIndex(reservations, { nowMs: NOW }).sections(ABBEY, { nowMs: NOW })
  assert.deepEqual(sections.past.map((e) => e.date), [YESTERDAY, '2026-08-09'])
  assert.deepEqual(sections.upcoming.map((e) => e.date), [TOMORROW, LATER])
})

test('view-only status is set for every date outside today and tomorrow', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  const all = [
    ...index.sections(ABBEY, { nowMs: NOW }).past,
    ...index.sections(ABBEY, { nowMs: NOW }).current,
    ...index.sections(ABBEY, { nowMs: NOW }).upcoming,
  ]
  for (const entry of all) {
    const bookableDay = entry.date === TODAY || entry.date === TOMORROW
    assert.equal(entry.viewOnly, !bookableDay, `${entry.date} view-only flag`)
  }
})

// --- Index metadata ---------------------------------------------------------

test('the index reports every loaded date, location and player exactly once', () => {
  const index = buildReservationIndex(fixture(), { nowMs: NOW })
  assert.deepEqual(index.dates, [YESTERDAY, TODAY, TOMORROW, LATER])
  assert.deepEqual(index.locations, [BALBOA, BARNES, PEN, PLNU, USD])
  assert.deepEqual(index.players, [CHEN, ABBEY], '"Alice Chen" sorts before "Stephanie Abbey" by displayed name')
  assert.equal(index.sessionCount, index.sessionsFor(ABBEY).length + index.sessionsFor(CHEN).length)
})

test('malformed reservation entries are skipped rather than crashing the index', () => {
  const index = buildReservationIndex({
    'bad-key': { '8:00 AM–8:30 AM': [ABBEY] },
    [`${PEN}|${TOMORROW}|1`]: { 'not a time': [ABBEY], '8:00 AM–8:30 AM': [ABBEY, '', null, '   '] },
    [`${PEN}|${TOMORROW}|2`]: null,
  }, { nowMs: NOW })

  assert.equal(index.players.length, 1)
  assert.equal(index.sessionsFor(ABBEY).length, 1)
})

// --- Ended-slot history merge ----------------------------------------------

test('mergeEndedReservations restores ended slots without resurrecting live ones', () => {
  // The bookable payload prunes ended slots; the history payload still has them.
  const bookable = {}
  add(bookable, PEN, TODAY, 1, 780, [ABBEY]) // 1:00 PM, live

  const history = {}
  add(history, PEN, TODAY, 1, 480, [ABBEY]) // 8:00 AM, ended
  add(history, PEN, TODAY, 1, 780, [ABBEY, CHEN]) // stale copy of the live slot
  add(history, PEN, TODAY, 2, 840, [CHEN]) // 2:00 PM, has NOT ended yet

  const merged = mergeEndedReservations(bookable, history, { nowMs: NOW })
  const court1 = merged[`${PEN}|${TODAY}|1`]

  assert.deepEqual(court1[slot(480)], [ABBEY], 'ended slot recovered from history')
  assert.deepEqual(court1[slot(780)], [ABBEY], 'live slot comes from the bookable payload only')
  assert.equal(merged[`${PEN}|${TODAY}|2`], undefined, 'a stale not-yet-ended slot is not resurrected')
})

test('an optimistic cancellation is never undone by the history payload', () => {
  const history = {}
  add(history, PEN, TOMORROW, 1, 600, [ABBEY, CHEN])
  // The desk just cancelled Abbey optimistically; only Chen remains bookable.
  const bookable = {}
  add(bookable, PEN, TOMORROW, 1, 600, [CHEN])

  const merged = mergeEndedReservations(bookable, history, { nowMs: NOW })
  assert.deepEqual(merged[`${PEN}|${TOMORROW}|1`][slot(600)], [CHEN])
  assert.equal(buildReservationIndex(merged, { nowMs: NOW }).sessionsFor(ABBEY).length, 0)
})

test('the search index built from merged data finds past sessions the bookable payload dropped', () => {
  const history = fixture()
  // Simulate the v2.1 backend pruning everything that already ended.
  const bookable = {}
  for (const [key, slots] of Object.entries(history)) {
    const date = key.split('|')[1]
    for (const [label, players] of Object.entries(slots)) {
      if (date < TODAY) continue
      if (date === TODAY && label === slot(750)) continue // 12:30 PM has ended
      bookable[key] ||= {}
      bookable[key][label] = players
    }
  }

  const bookableOnly = buildReservationIndex(bookable, { nowMs: NOW }).sections(ABBEY, { nowMs: NOW })
  assert.equal(bookableOnly.past.length, 0, 'past is empty without the history payload')

  const merged = buildReservationIndex(mergeEndedReservations(bookable, history, { nowMs: NOW }), { nowMs: NOW })
  const sections = merged.sections('Stephanie Abbey', { nowMs: NOW })
  assert.equal(sections.past.length, 1, 'the past Peninsula session is visible again')
  assert.equal(sections.current.length, 2, 'the ended 12:30 PM Barnes slot is back too')
  assert.equal(sections.total, 5)
})
