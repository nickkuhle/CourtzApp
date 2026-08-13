// Tests the search + commit logic behind the shared PlayerSwitcher component,
// which is used identically in the navbar, Find a Court, the court-schedule
// modal and the reservation search.
//
// The rule this file protects: whatever the desk types, the value handed to
// onSelect (and therefore stored as the canonical currentPlayer and written to
// the Sheet) is ALWAYS an untouched canonical roster entry — never the typed
// text and never a reformatted display name.

import assert from 'node:assert/strict'
import test from 'node:test'

import { formatPlayerName, normalizeNameKey, resolveCanonicalName } from '../lib/reservation-index.js'

const ROSTER = [
  'Abbey, Stephanie',
  'Chen, Alice',
  'Waters, Eadan',
  'Reeves, Sam',
  'Zhou, Zhongyi',
  'Andreoli, Mia',
  'Shi, Kelly',
]

// Mirrors components/PlayerSwitcher.js: a roster entry matches when the query
// appears in either the canonical or the display form.
function searchIndexFor(name) {
  return `${normalizeNameKey(name)} \u0001 ${normalizeNameKey(formatPlayerName(name))}`
}

function matchesFor(query, roster = ROSTER) {
  const q = normalizeNameKey(query)
  if (!q) return roster
  return roster.filter((name) => searchIndexFor(name).includes(q))
}

// Mirrors commitTypedText(): prefer an exact canonical/display hit, otherwise
// take the first visible match (what Enter selects), otherwise keep the
// currently selected player.
function commit(query, currentPlayer, roster = ROSTER) {
  const exact = resolveCanonicalName(query, roster)
  if (exact) return exact
  const matches = matchesFor(query, roster)
  return matches.length ? matches[0] : currentPlayer
}

test('search matches both canonical "Last, First" and display "First Last"', () => {
  assert.deepEqual(matchesFor('abbey'), ['Abbey, Stephanie'])
  assert.deepEqual(matchesFor('stephanie'), ['Abbey, Stephanie'])
  assert.deepEqual(matchesFor('Stephanie Abbey'), ['Abbey, Stephanie'])
  assert.deepEqual(matchesFor('Abbey, Stephanie'), ['Abbey, Stephanie'])
  assert.deepEqual(matchesFor('alice chen'), ['Chen, Alice'])
  assert.deepEqual(matchesFor(''), ROSTER, 'an empty query shows the whole roster')
  assert.deepEqual(matchesFor('nobody'), [])
})

test('pressing Enter on a partial LAST name selects the canonical player', () => {
  assert.equal(commit('abbey', 'Chen, Alice'), 'Abbey, Stephanie')
  assert.equal(commit('Waters', 'Chen, Alice'), 'Waters, Eadan')
  assert.equal(commit('ZHOU', 'Chen, Alice'), 'Zhou, Zhongyi')
})

test('pressing Enter on a partial FIRST name selects the canonical player', () => {
  assert.equal(commit('stephanie', 'Chen, Alice'), 'Abbey, Stephanie')
  assert.equal(commit('Alice', 'Abbey, Stephanie'), 'Chen, Alice')
  assert.equal(commit('Eadan', 'Abbey, Stephanie'), 'Waters, Eadan')
})

test('pressing Enter on a full display-form name resolves to the Sheet value', () => {
  assert.equal(commit('Stephanie Abbey', 'Chen, Alice'), 'Abbey, Stephanie')
  assert.equal(commit('Alice Chen', 'Abbey, Stephanie'), 'Chen, Alice')
  assert.equal(commit('  kelly   shi  ', 'Chen, Alice'), 'Shi, Kelly')
})

test('pressing Enter on a full canonical name keeps that exact value', () => {
  assert.equal(commit('Abbey, Stephanie', 'Chen, Alice'), 'Abbey, Stephanie')
  assert.equal(commit('chen, alice', 'Abbey, Stephanie'), 'Chen, Alice')
})

test('an exact match wins over an alphabetically earlier partial match', () => {
  const roster = ['Chen, Alice', 'Chenoweth, Alicia']
  assert.equal(commit('Chen, Alice', 'Chenoweth, Alicia'), 'Chen, Alice')
  assert.equal(commit('Alice Chen', 'Chenoweth, Alicia'), 'Chen, Alice')
  // A prefix that matches both still resolves deterministically to the first.
  assert.deepEqual(matchesFor('chen', roster), roster)
})

test('an unresolvable query never changes the selected player', () => {
  assert.equal(commit('zzzz', 'Abbey, Stephanie'), 'Abbey, Stephanie')
  assert.equal(commit('   ', 'Abbey, Stephanie'), 'Abbey, Stephanie', 'blank shows everyone, commits the first')
})

test('every committed value is a canonical roster entry, never reformatted text', () => {
  for (const query of ['abbey', 'Stephanie Abbey', 'ALICE', 'zhou', 'Kelly Shi', 'mia', 'reeves']) {
    const selected = commit(query, 'Chen, Alice')
    assert.ok(ROSTER.includes(selected), `"${query}" -> "${selected}" must be a roster value`)
    assert.ok(selected.includes(','), 'the canonical "Last, First" form is preserved')
  }
})
