// End-to-end tests of the Next.js API routes against the local mock of the
// v2.4 Apps Script backend (scripts/mock-apps-script.mjs). The mock's grid is
// generated relative to today (America/Los_Angeles): two past days, today,
// tomorrow (bookable) and the day after tomorrow (view-only).
//
// These tests verify the full chain: API rule enforcement -> Apps Script
// payload -> mock write -> fresh schedule read.

import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { spawn } from 'node:child_process'
import net from 'node:net'

// The mock listens on a random port so this test never collides with a mock
// that is already running (e.g. the one serving the live preview).
const MOCK_PORT = 30000 + Math.floor(Math.random() * 1000)

// Must be set before the API modules (and lib/sheets.js) are imported.
process.env.SHEETS_WEBAPP_URL = `http://127.0.0.1:${MOCK_PORT}/exec`
const STAFF_CODE = 'integration-staff-code'
process.env.STAFF_APPROVAL_CODE = STAFF_CODE
delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
delete process.env.GOOGLE_PRIVATE_KEY

const { default: reservationsHandler } = await import('../pages/api/reservations.js')
const { default: scheduleHandler } = await import('../pages/api/schedule.js')
const { laNow, addDaysToDateKey, isSlotCompleted } = await import('../lib/booking-rules.js')

const TODAY = laNow().dateKey
const TOMORROW = addDaysToDateKey(TODAY, 1)
const DAY_AFTER = addDaysToDateKey(TODAY, 2)
const PAST = addDaysToDateKey(TODAY, -2)

function formatTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}
const slot = (startMinutes) => `${formatTime(startMinutes)}–${formatTime(startMinutes + 30)}`

// --- Mock server lifecycle --------------------------------------------------

let mockProcess = null

function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tryConnect = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - startedAt > timeoutMs) reject(new Error('mock Apps Script did not start'))
        else setTimeout(tryConnect, 150)
      })
    }
    tryConnect()
  })
}

async function startMock() {
  mockProcess = spawn(process.execPath, [new URL('../scripts/mock-apps-script.mjs', import.meta.url).pathname], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
  })
  await waitForPort(MOCK_PORT, 15000)
}

after(async () => {
  if (mockProcess) {
    mockProcess.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (!mockProcess.killed) mockProcess.kill('SIGKILL')
  }
})

// --- Fake request/response helpers ------------------------------------------

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this },
    json(obj) { this.body = obj; return this },
    setHeader(k, v) { this.headers[k] = v },
    end(msg) { this.body = msg || this.body; return this },
  }
  return res
}

async function callApi(handler, req) {
  const res = fakeRes()
  await handler(req, res)
  return res
}

function post(action, payload) {
  return callApi(reservationsHandler, { method: 'POST', body: { action, ...payload } })
}

async function postDirectlyToMock(payload) {
  const response = await fetch(process.env.SHEETS_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  })
  return { statusCode: response.status, body: await response.json() }
}

async function getSchedule(forceRefresh = false) {
  const res = await callApi(scheduleHandler, { method: 'GET', query: forceRefresh ? { refresh: '1' } : {} })
  assert.equal(res.statusCode, 200, 'schedule read should succeed')
  return res.body
}

// --- Tests ------------------------------------------------------------------

test('schedule API reports every location, defaults, days and practice sessions', async () => {
  await startMock()
  const schedule = await getSchedule()
  assert.equal(schedule.connected, true)
  assert.equal(schedule.scriptVersion, '2.4')
  assert.equal(schedule.staffCodeRequired, true)
  for (const loc of ['Barnes Tennis Center', 'Peninsula Tennis Club', 'Point Loma Nazarene College', 'Pacific Beach Tennis Club', 'Balboa Tennis Center', 'USD']) {
    assert.ok(schedule.locations.includes(loc), `${loc} should be reported`)
  }
  assert.deepEqual(schedule.defaultPracticeLocations, ['Barnes Tennis Center', 'Peninsula Tennis Club', 'Point Loma Nazarene College'])
  for (const d of [TODAY, TOMORROW, DAY_AFTER, PAST]) {
    assert.ok(schedule.days.includes(d), `${d} should be in days`)
  }
  assert.ok(schedule.practiceSessions[TOMORROW])
  assert.ok(schedule.practiceSessions[TOMORROW]['Peninsula Tennis Club'])

  // Regression: v2.1 deleted every completed slot before returning the
  // schedule, which erased every reservation on a past day and earlier today.
  const pastKey = `Peninsula Tennis Club|${PAST}|1`
  assert.deepEqual(schedule.reservations[pastKey][slot(480)], ['Waters, Eadan'])

  const todayKey = `Point Loma Nazarene College|${TODAY}|1`
  assert.equal(isSlotCompleted(TODAY, slot(480)), true, 'the seeded 8:00 AM slot should have ended today')
  assert.deepEqual(schedule.reservations[todayKey][slot(480)], ['Reeves, Sam'])
  assert.ok(
    schedule.practiceSessions[TODAY]['Point Loma Nazarene College']
      .some((session) => session.player === 'Reeves, Sam' && session.slots.includes(slot(480))),
    "today's ended reservation should still count in practice-session metadata",
  )
})

test('view-only days are rejected by the API for both book and cancel', async () => {
  const future = await post('book', {
    location: 'Barnes Tennis Center',
    date: DAY_AFTER,
    courtId: 6,
    slots: [slot(480)],
    names: ['Abbey, Stephanie'],
  })
  assert.equal(future.statusCode, 400)
  assert.equal(future.body.code, 'BOOKING_RULES')
  assert.match(future.body.error, /today and tomorrow/)

  const past = await post('cancel', {
    location: 'Barnes Tennis Center',
    date: PAST,
    courtId: 6,
    slots: [slot(480)],
    names: ['Abbey, Stephanie'],
  })
  assert.equal(past.statusCode, 400)
  assert.equal(past.body.code, 'BOOKING_RULES')
})

test('Player X can join the same partially occupied slot after Player A books it', async () => {
  const location = 'Barnes Tennis Center'
  const courtId = 4
  const sharedSlot = slot(690)
  const playerA = 'Zhou, Zhongyi'
  const playerX = 'Andreoli, Mia'

  const first = await post('book', {
    location,
    date: TOMORROW,
    courtId,
    slots: [sharedSlot],
    names: [playerA],
  })
  assert.equal(first.statusCode, 200, JSON.stringify(first.body))

  // This is the exact reported flow at the write boundary: switch the acting
  // player, then book the already-partially-occupied court/time.
  const second = await post('book', {
    location,
    date: TOMORROW,
    courtId,
    slots: [sharedSlot],
    names: [playerX],
  })
  assert.equal(second.statusCode, 200, JSON.stringify(second.body))

  const schedule = await getSchedule(true)
  const key = `${location}|${TOMORROW}|${courtId}`
  assert.deepEqual(schedule.reservations[key]?.[sharedSlot], [playerA, playerX])
})

test('Barnes adjacent 30-minute bookings need staff approval; the hard 2-session limit cannot be bypassed', async () => {
  const player = 'Abbey, Stephanie'
  const first = await post('book', {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 6,
    slots: [slot(480)],
    names: [player],
  })
  assert.equal(first.statusCode, 200, JSON.stringify(first.body))

  // Back-to-back booking without approval -> rejected with STAFF_APPROVAL_REQUIRED.
  const secondNoApproval = await post('book', {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 6,
    slots: [slot(510)],
    names: [player],
  })
  assert.equal(secondNoApproval.statusCode, 409)
  assert.equal(secondNoApproval.body.code, 'STAFF_APPROVAL_REQUIRED')
  assert.equal(secondNoApproval.body.staffCodeRequired, true)
  assert.match(secondNoApproval.body.error, /staff approval is required/i)

  // A caller cannot self-assert staff approval when a code is configured.
  const secondMissingCode = await post('book', {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 6,
    slots: [slot(510)],
    names: [player],
    staffApproved: true,
  })
  assert.equal(secondMissingCode.statusCode, 403)
  assert.equal(secondMissingCode.body.code, 'STAFF_APPROVAL_CODE_REQUIRED')

  const directMissingCode = await postDirectlyToMock({
    action: 'bookGroup',
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 6,
    slots: [slot(510)],
    names: [player],
    staffApproved: true,
  })
  assert.equal(directMissingCode.statusCode, 403)
  assert.equal(directMissingCode.body.code, 'STAFF_APPROVAL_CODE_REQUIRED')

  const secondWrongCode = await post('book', {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 6,
    slots: [slot(510)],
    names: [player],
    staffApproved: true,
    staffCode: 'wrong-code',
  })
  assert.equal(secondWrongCode.statusCode, 403)
  assert.equal(secondWrongCode.body.code, 'STAFF_APPROVAL_CODE_INVALID')

  // With the matching staff code the second (back-to-back) session is allowed.
  const secondApproved = await post('book', {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 6,
    slots: [slot(510)],
    names: [player],
    staffApproved: true,
    staffCode: STAFF_CODE,
  })
  assert.equal(secondApproved.statusCode, 200, JSON.stringify(secondApproved.body))

  // A third session is over the hard limit - staff approval cannot bypass it.
  const third = await post('book', {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 6,
    slots: [slot(540)],
    names: [player],
    staffApproved: true,
    staffCode: STAFF_CODE,
  })
  assert.equal(third.statusCode, 409)
  assert.equal(third.body.code, 'SESSION_LIMIT')
  assert.match(third.body.error, /maximum is 2/)
})

test('a 60-minute non-Barnes booking counts as ONE session and needs no staff approval for its own two halves', async () => {
  const player = 'Chen, Alice'
  const hour = await post('book', {
    location: 'Peninsula Tennis Club',
    date: TOMORROW,
    courtId: 1,
    slots: [slot(480), slot(510)],
    names: [player],
  })
  assert.equal(hour.statusCode, 200, JSON.stringify(hour.body))

  // Two 60-minute sessions are allowed (second starts 120 minutes later).
  const secondHour = await post('book', {
    location: 'Peninsula Tennis Club',
    date: TOMORROW,
    courtId: 1,
    slots: [slot(600), slot(630)],
    names: [player],
  })
  assert.equal(secondHour.statusCode, 200, JSON.stringify(secondHour.body))

  // The third session is rejected outright.
  const thirdHour = await post('book', {
    location: 'Peninsula Tennis Club',
    date: TOMORROW,
    courtId: 2,
    slots: [slot(720), slot(750)],
    names: [player],
    staffApproved: true,
    staffCode: STAFF_CODE,
  })
  assert.equal(thirdHour.statusCode, 409)
  assert.equal(thirdHour.body.code, 'SESSION_LIMIT')
})

test('legacy toggle-add enforces the session limit while toggle-remove still works', async () => {
  const player = 'Waters, Eadan'
  for (const start of [480, 600]) {
    const booked = await post('book', {
      location: 'Barnes Tennis Center',
      date: TOMORROW,
      courtId: 5,
      slots: [slot(start)],
      names: [player],
    })
    assert.equal(booked.statusCode, 200, JSON.stringify(booked.body))
  }

  // Omitting `action` exercises the legacy single-player toggle route. This
  // would previously validate as cancel even though it was adding a booking.
  const overLimitAdd = await post(undefined, {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 5,
    slot: slot(690),
    name: player,
  })
  assert.equal(overLimitAdd.statusCode, 409)
  assert.equal(overLimitAdd.body.code, 'SESSION_LIMIT')

  // Old cached clients call Apps Script directly, so the locked backend must
  // independently make the same add-vs-remove decision.
  const directOverLimitAdd = await postDirectlyToMock({
    action: 'toggleReservation',
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 5,
    slot: slot(690),
    name: player,
  })
  assert.equal(directOverLimitAdd.statusCode, 409)
  assert.equal(directOverLimitAdd.body.code, 'SESSION_LIMIT')

  let schedule = await getSchedule(true)
  const key = `Barnes Tennis Center|${TOMORROW}|5`
  assert.equal(schedule.reservations[key]?.[slot(690)], undefined, 'rejected toggle-add must not reach the backend')

  const legitimateRemove = await post(undefined, {
    location: 'Barnes Tennis Center',
    date: TOMORROW,
    courtId: 5,
    slot: slot(600),
    name: player,
    // A cancellation must not require an approval code, even if a stale old
    // client happens to send staffApproved.
    staffApproved: true,
  })
  assert.equal(legitimateRemove.statusCode, 200, JSON.stringify(legitimateRemove.body))
  assert.equal(legitimateRemove.body.action, 'cancel')

  schedule = await getSchedule(true)
  assert.equal(schedule.reservations[key]?.[slot(600)], undefined)
  assert.deepEqual(schedule.reservations[key]?.[slot(480)], [player])
})

test('schedule read reflects the stored bookings and groups the 60-minute booking into ONE session', async () => {
  const schedule = await getSchedule(true)
  const pen = schedule.practiceSessions[TOMORROW]['Peninsula Tennis Club']
  const chen = pen.filter((s) => s.player === 'Chen, Alice')
  assert.equal(chen.length, 2, 'two 60-minute sessions')
  assert.deepEqual(chen.map((s) => s.slots.length), [2, 2], 'each session groups its two 30-minute halves')

  const barnes = schedule.practiceSessions[TOMORROW]['Barnes Tennis Center']
  const abbey = barnes.filter((s) => s.player === 'Abbey, Stephanie')
  assert.equal(abbey.length, 2, 'two separate Barnes sessions')
  assert.deepEqual(abbey.map((s) => s.slots.length), [1, 1], 'each Barnes 30-minute slot is its own session')

  // The group booking is stored in the reservations payload.
  const key = `Peninsula Tennis Club|${TOMORROW}|1`
  assert.ok(schedule.reservations[key])
  assert.deepEqual(schedule.reservations[key][slot(480)], ['Chen, Alice'])
})

test('canceling an existing booking on a bookable day works', async () => {
  const cancel = await post('cancel', {
    location: 'Peninsula Tennis Club',
    date: TOMORROW,
    courtId: 1,
    slots: [slot(480), slot(510)],
    names: ['Chen, Alice'],
  })
  assert.equal(cancel.statusCode, 200, JSON.stringify(cancel.body))

  const schedule = await getSchedule(true)
  const key = `Peninsula Tennis Club|${TOMORROW}|1`
  assert.ok(!schedule.reservations[key] || !schedule.reservations[key][slot(480)], 'the canceled slots are gone')
})
