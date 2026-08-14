import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSiteOverview, slotOccupancyStatus, slotPlayerCount } from '../lib/site-overview.js'

const LOCATION = 'Peninsula Tennis Club'
const DATE = '2026-08-14'

function add(reservations, court, label, players) {
  const key = `${LOCATION}|${DATE}|${court}`
  reservations[key] ||= {}
  reservations[key][label] = players
}

test('slotOccupancyStatus classifies ended, open, partial and full slots', () => {
  assert.equal(slotOccupancyStatus({ players: [], ended: true }), 'ended')
  assert.equal(slotOccupancyStatus({ players: [] }), 'open')
  assert.equal(slotOccupancyStatus({ players: ['A'] }), 'partial')
  assert.equal(slotOccupancyStatus({ players: ['A', 'B', 'C'] }), 'partial')
  assert.equal(slotOccupancyStatus({ players: ['A', 'B', 'C', 'D'] }), 'full')
  assert.equal(slotOccupancyStatus({ players: 'A' }), 'partial', 'legacy string values still count')
  assert.equal(slotPlayerCount([]), 0)
  assert.equal(slotPlayerCount(['A', 'B']), 2)
  assert.equal(slotPlayerCount('A'), 1)
})

test('buildSiteOverview aligns one row of cells per court and a per-time availability summary', () => {
  const reservations = {}
  const labels = ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM', '9:00 AM–9:30 AM', '9:30 AM–10:00 AM']
  // Court 1: open, 2/4 booked, 4/4 booked, 1/4 booked (but the slot ended)
  add(reservations, 1, labels[0], [])
  add(reservations, 1, labels[1], ['A', 'B'])
  add(reservations, 1, labels[2], ['A', 'B', 'C', 'D'])
  add(reservations, 1, labels[3], ['A'])
  // Court 2: fully booked at 8:30 and 9:00, otherwise empty
  add(reservations, 2, labels[1], ['W', 'X', 'Y', 'Z'])
  add(reservations, 2, labels[2], ['W', 'X', 'Y', 'Z'])

  const ended = new Set([labels[3]])
  const { rows, summary } = buildSiteOverview({
    courts: [{ id: 1 }, { id: 2 }],
    reservations,
    location: LOCATION,
    dateKey: DATE,
    slotLabels: labels,
    completedSlots: ended,
  })

  assert.equal(rows.length, 2)
  assert.equal(rows[0].court.id, 1)
  assert.deepEqual(rows[0].cells.map((c) => c.status), ['open', 'partial', 'full', 'ended'])

  assert.equal(rows[1].cells[0].status, 'open')
  assert.equal(rows[1].cells[1].status, 'full')

  // Summary counts courts with space left. At 8:00 both courts are open; at
  // 8:30 one still has space; at 9:00 both are full (site-wide busy); at 9:30
  // the slot has ended.
  assert.deepEqual(
    summary.map((s) => ({ ended: s.ended, available: s.available, total: s.total })),
    [
      { ended: false, available: 2, total: 2 },
      { ended: false, available: 1, total: 2 },
      { ended: false, available: 0, total: 2 },
      { ended: true, available: 0, total: 2 },
    ]
  )
})

test('buildSiteOverview treats unknown courts as fully open', () => {
  const { rows, summary } = buildSiteOverview({
    courts: [{ id: 4 }, { id: 5 }],
    reservations: {},
    location: 'Barnes Tennis Center',
    dateKey: DATE,
    slotLabels: ['8:00 AM–8:30 AM'],
    completedSlots: new Set(),
  })
  assert.equal(rows[0].cells[0].status, 'open')
  assert.equal(summary[0].available, 2)
})
