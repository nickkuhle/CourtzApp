import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'

import { startMock, stopMock } from '../scripts/mock-apps-script.mjs'
import { getBookingWindowKeys, isSlotCompleted } from '../lib/booking-window.js'

// End-to-end behaviour against the local mock Apps Script (which mirrors
// CourtzAppsScript.gs v2.1, including the booking window and session rules
// rechecked server-side). Exercises lib/sheets.js -> HTTP -> mock -> grid.

const PENINSULA = 'Peninsula Tennis Club'
const BARNES = 'Barnes Tennis Center'
const { today, tomorrow } = getBookingWindowKeys(new Date())

const yesterday = (() => {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - 1, 12))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
})()

// Unique player names so parallel test files (each with its own server
// process) can never interfere with one another.
const PLAYER = `Integration Player ${Date.now()}`

let mockServer = null

before(async () => {
  // Port 0 -> an OS-assigned port, so the suite also passes when a developer
  // already has `npm run mock:sheets` running on 3100.
  mockServer = await startMock(0)
  process.env.SHEETS_WEBAPP_URL = `http://127.0.0.1:${mockServer.address().port}/exec`
})

after(async () => {
  if (mockServer) await stopMock()
  delete process.env.SHEETS_WEBAPP_URL
})

async function loadFreshSheetsModule(label) {
  return import(`../lib/sheets.js?mockint=${label}-${Date.now()}-${Math.random()}`)
}

test('schedule loads from the mock Apps Script with version 2.1', async () => {
  const { getSchedule } = await loadFreshSheetsModule('read')
  const schedule = await getSchedule({ forceRefresh: true })
  assert.equal(schedule.connected, true)
  assert.equal(schedule.source, 'webapp')
  assert.equal(schedule.scriptVersion, '2.1')
  assert.ok(schedule.days.includes(today))
  assert.ok(schedule.days.includes(tomorrow))
  assert.deepEqual(schedule.locations, [
    'Barnes Tennis Center',
    'Peninsula Tennis Club',
    'Point Loma Nazarene College',
    'Pacific Beach Tennis Club',
    'Balboa Tennis Center',
    'USD',
  ])
  assert.ok(schedule.courtsByDate[tomorrow]?.[BARNES], 'courts discovered dynamically for tomorrow')
})

test('mock Apps Script rejects bookings on view-only (past) dates', async () => {
  const { bookGroup } = await loadFreshSheetsModule('past-book')
  await assert.rejects(
    bookGroup({
      location: BARNES,
      date: yesterday,
      courtId: 4,
      slots: ['9:00 AM–9:30 AM'],
      names: [PLAYER],
    }),
    /view only/i,
  )
})

test('mock Apps Script rejects cancellations on view-only (past) dates', async () => {
  const { cancelGroup } = await loadFreshSheetsModule('past-cancel')
  await assert.rejects(
    cancelGroup({
      location: BARNES,
      date: yesterday,
      courtId: 4,
      slots: ['9:00 AM–9:30 AM'],
      names: [PLAYER],
    }),
    /view only/i,
  )
})

test('one 60-minute Peninsula booking counts as one session (no approval needed)', async () => {
  const { bookGroup, getSchedule } = await loadFreshSheetsModule('sixty-first')
  // Fresh player: the 60-minute booking's own two adjacent Sheet slots must
  // NOT trigger the staff-approval warning.
  await bookGroup({
    location: PENINSULA,
    date: tomorrow,
    courtId: 6,
    slots: ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM'],
    names: [`${PLAYER} 60a`],
    staffApproved: false,
  })
  const schedule = await getSchedule({ forceRefresh: true })
  const key = `${PENINSULA}|${tomorrow}|6`
  assert.deepEqual(schedule.reservations[key]['8:00 AM–8:30 AM'], [`${PLAYER} 60a`])
  assert.deepEqual(schedule.reservations[key]['8:30 AM–9:00 AM'], [`${PLAYER} 60a`])
})

test('two separate 60-minute bookings are allowed; a third session is rejected server-side', async () => {
  const { bookGroup } = await loadFreshSheetsModule('limit')
  const name = `${PLAYER} limit`
  await bookGroup({
    location: PENINSULA,
    date: tomorrow,
    courtId: 7,
    slots: ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM'],
    names: [name],
  })
  await bookGroup({
    location: PENINSULA,
    date: tomorrow,
    courtId: 7,
    slots: ['10:00 AM–10:30 AM', '10:30 AM–11:00 AM'],
    names: [name],
  })
  await assert.rejects(
    bookGroup({
      location: PENINSULA,
      date: tomorrow,
      courtId: 8,
      slots: ['2:00 PM–2:30 PM', '2:30 PM–3:00 PM'],
      names: [name],
      staffApproved: true, // the override must never bypass the hard limit
    }),
    /2 practice sessions/,
  )
})

test('two adjacent Barnes 30-minute reservations require staff approval, and the override proceeds', async () => {
  const { bookGroup, getSchedule } = await loadFreshSheetsModule('barnes-adjacent')
  const name = `${PLAYER} barnes`
  await bookGroup({
    location: BARNES,
    date: tomorrow,
    courtId: 4,
    slots: ['9:00 AM–9:30 AM'],
    names: [name],
  })
  await assert.rejects(
    bookGroup({
      location: BARNES,
      date: tomorrow,
      courtId: 4,
      slots: ['9:30 AM–10:00 AM'],
      names: [name],
      staffApproved: false,
    }),
    /STAFF_APPROVAL_REQUIRED/,
  )
  await bookGroup({
    location: BARNES,
    date: tomorrow,
    courtId: 4,
    slots: ['9:30 AM–10:00 AM'],
    names: [name],
    staffApproved: true,
  })
  const schedule = await getSchedule({ forceRefresh: true })
  const key = `${BARNES}|${tomorrow}|4`
  assert.deepEqual(schedule.reservations[key]['9:30 AM–10:00 AM'], [name])
})

test('mock Apps Script rejects already-ended time slots on today', async (t) => {
  const { bookGroup } = await loadFreshSheetsModule('window-multislot')
  // Today's earliest slot: if it has already ended (it normally has by the
  // time the suite runs), the mock must reject it - just like the real
  // Apps Script.
  const slot = '8:00 AM–8:30 AM'
  if (!isSlotCompleted(slot, today, new Date())) {
    t.skip('nothing has ended yet at this time of day')
    return
  }
  await assert.rejects(
    bookGroup({
      location: BARNES,
      date: today,
      courtId: 4,
      slots: [slot],
      names: [`${PLAYER} ended`],
    }),
    /already ended/,
  )
})
