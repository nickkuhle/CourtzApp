import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import handler from '../pages/api/reservations.js'
import { getBookingWindowKeys, isSlotCompleted } from '../lib/booking-window.js'

const originalFetch = global.fetch
const originalWebAppUrl = process.env.SHEETS_WEBAPP_URL

const PENINSULA = 'Peninsula Tennis Club'
const BARNES = 'Barnes Tennis Center'

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body)
    },
  }
}

function fakeRes() {
  return {
    code: 200,
    body: null,
    headers: {},
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    setHeader(key, value) {
      this.headers[key] = value
    },
    end() {},
  }
}

// The handler reads the schedule fresh (forceRefresh) before booking, so each
// test configures what GET /schedule returns; POSTs are captured.
function installFetchMock({ reservations = {} } = {}) {
  const posts = []
  global.fetch = async (url, options) => {
    if (options && options.method === 'POST') {
      posts.push(JSON.parse(options.body))
      return jsonResponse({ success: true, version: '2.1' })
    }
    assert.match(String(url), /action=getSchedule/)
    return jsonResponse({
      success: true,
      version: '2.1',
      data: {
        roster: ['Player A', 'Player B', 'Player C'],
        reservations,
        days: [],
        courtsByDate: {},
        locations: [BARNES, PENINSULA, 'Point Loma Nazarene College'],
      },
    })
  }
  return posts
}

const { today, tomorrow } = getBookingWindowKeys(new Date())
const yesterday = (() => {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - 1, 12))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
})()

afterEach(() => {
  global.fetch = originalFetch
  if (originalWebAppUrl === undefined) delete process.env.SHEETS_WEBAPP_URL
  else process.env.SHEETS_WEBAPP_URL = originalWebAppUrl
})

test('API rejects bookings on past dates (view only)', async () => {
  installFetchMock()
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: { action: 'book', location: BARNES, date: yesterday, courtId: 4, slots: ['9:00 AM–9:30 AM'], names: ['Player A'] },
    },
    res,
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /view only/i)
})

test('API rejects bookings on days after tomorrow (view only)', async () => {
  const [y, m, d] = tomorrow.split('-').map(Number)
  const dayAfter = new Date(Date.UTC(y, m - 1, d + 1, 12))
  const dayAfterKey = `${dayAfter.getUTCFullYear()}-${String(dayAfter.getUTCMonth() + 1).padStart(2, '0')}-${String(dayAfter.getUTCDate()).padStart(2, '0')}`
  installFetchMock()
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: { action: 'book', location: BARNES, date: dayAfterKey, courtId: 4, slots: ['9:00 AM–9:30 AM'], names: ['Player A'] },
    },
    res,
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /view only/i)
})

test('API rejects already-ended time slots on today', async (t) => {
  const slot = '8:00 AM–8:30 AM'
  if (!isSlotCompleted(slot, today, new Date())) {
    t.skip('no ended slots yet at this time of day')
    return
  }
  installFetchMock()
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: { action: 'book', location: BARNES, date: today, courtId: 4, slots: [slot], names: ['Player A'] },
    },
    res,
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /already ended/i)
})

test('API rejects cancellations of already-ended time slots on today', async (t) => {
  const slot = '8:00 AM–8:30 AM'
  if (!isSlotCompleted(slot, today, new Date())) {
    t.skip('no ended slots yet at this time of day')
    return
  }
  installFetchMock()
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: { action: 'cancel', location: BARNES, date: today, courtId: 4, slots: [slot], names: ['Player A'] },
    },
    res,
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /already ended/i)
})

test('API rejects cancellations outside the booking window (a change on a view-only day)', async () => {
  installFetchMock()
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: { action: 'cancel', location: BARNES, date: yesterday, courtId: 4, slots: ['9:00 AM–9:30 AM'], names: ['Player A'] },
    },
    res,
  )
  assert.equal(res.code, 400)
})

test('API books a valid group and forwards staffApproved + activeLocations', async () => {
  const posts = installFetchMock()
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: {
        action: 'book',
        location: PENINSULA,
        date: tomorrow,
        courtId: 1,
        slots: ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM'],
        names: ['Player A', 'Player B'],
        staffApproved: true,
        activeLocations: ['USD'],
      },
    },
    res,
  )
  assert.equal(res.code, 200)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].action, 'bookGroup')
  assert.equal(posts[0].staffApproved, true)
  assert.deepEqual(posts[0].activeLocations, ['USD'])
  assert.deepEqual(posts[0].slots, ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM'])
  assert.deepEqual(posts[0].names, ['Player A', 'Player B'])
})

test('API rejects a third session even when staffApproved is true (hard limit)', async () => {
  // Player A already holds two 60-minute sessions on tomorrow.
  const reservations = {
    [`${PENINSULA}|${tomorrow}|1`]: {
      '8:00 AM–8:30 AM': ['Player A'],
      '8:30 AM–9:00 AM': ['Player A'],
      '10:00 AM–10:30 AM': ['Player A'],
      '10:30 AM–11:00 AM': ['Player A'],
    },
  }
  const posts = installFetchMock({ reservations })
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: {
        action: 'book',
        location: BARNES,
        date: tomorrow,
        courtId: 4,
        slots: ['2:00 PM–2:30 PM'],
        names: ['Player A'],
        staffApproved: true, // staff override must NOT bypass the hard limit
      },
    },
    res,
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /2 practice sessions/)
  assert.equal(posts.length, 0, 'nothing may be written to the backend')
})

test('API requires staff approval when sessions are close, and lets the override through', async () => {
  // Existing Barnes 30-minute session at 8:00; booking the adjacent 8:30 slot.
  const reservations = {
    [`${BARNES}|${tomorrow}|4`]: { '8:00 AM–8:30 AM': ['Player A'] },
  }
  const posts = installFetchMock({ reservations })
  const body = {
    action: 'book',
    location: BARNES,
    date: tomorrow,
    courtId: 4,
    slots: ['8:30 AM–9:00 AM'],
    names: ['Player A'],
  }

  const denied = fakeRes()
  await handler({ method: 'POST', body }, denied)
  assert.equal(denied.code, 409)
  assert.match(denied.body.error, /STAFF_APPROVAL_REQUIRED/)
  assert.equal(posts.length, 0)

  const approved = fakeRes()
  await handler({ method: 'POST', body: { ...body, staffApproved: true } }, approved)
  assert.equal(approved.code, 200)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].staffApproved, true)
})

test('API validates every player in a multi-player booking', async () => {
  const reservations = {
    [`${PENINSULA}|${tomorrow}|1`]: {
      '8:00 AM–8:30 AM': ['Player B'],
      '8:30 AM–9:00 AM': ['Player B'],
      '10:00 AM–10:30 AM': ['Player B'],
      '10:30 AM–11:00 AM': ['Player B'],
    },
  }
  const posts = installFetchMock({ reservations })
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: {
        action: 'book',
        location: BARNES,
        date: tomorrow,
        courtId: 4,
        slots: ['2:00 PM–2:30 PM'],
        names: ['Player A', 'Player B'], // B already has 2 sessions
        staffApproved: true,
      },
    },
    res,
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /Player B/)
  assert.equal(posts.length, 0)
})

test('API ignores hidden-site reservations unless the site is active', async () => {
  // Player A holds two 60-minute sessions at USD (hidden match-play site).
  const reservations = {
    [`USD|${tomorrow}|1`]: {
      '8:00 AM–8:30 AM': ['Player A'],
      '8:30 AM–9:00 AM': ['Player A'],
      '10:00 AM–10:30 AM': ['Player A'],
      '10:30 AM–11:00 AM': ['Player A'],
    },
  }
  // Without USD in activeLocations the booking is fine.
  const posts = installFetchMock({ reservations })
  const res = fakeRes()
  await handler(
    {
      method: 'POST',
      body: {
        action: 'book',
        location: PENINSULA,
        date: tomorrow,
        courtId: 1,
        slots: ['2:00 PM–2:30 PM'],
        names: ['Player A'],
        activeLocations: [],
      },
    },
    res,
  )
  assert.equal(res.code, 200)
  assert.equal(posts.length, 1)

  // With USD deliberately added, the same booking is a third session.
  const posts2 = installFetchMock({ reservations })
  const res2 = fakeRes()
  await handler(
    {
      method: 'POST',
      body: {
        action: 'book',
        location: PENINSULA,
        date: tomorrow,
        courtId: 1,
        slots: ['2:00 PM–2:30 PM'],
        names: ['Player A'],
        activeLocations: ['USD'],
      },
    },
    res2,
  )
  assert.equal(res2.code, 400)
  assert.equal(posts2.length, 0)
})
