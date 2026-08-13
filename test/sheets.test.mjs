import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

const originalFetch = global.fetch
const originalWebAppUrl = process.env.SHEETS_WEBAPP_URL

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body)
    },
  }
}

async function loadFreshSheetsModule(label) {
  return import(`../lib/sheets.js?test=${label}-${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  global.fetch = originalFetch
  if (originalWebAppUrl === undefined) delete process.env.SHEETS_WEBAPP_URL
  else process.env.SHEETS_WEBAPP_URL = originalWebAppUrl
})

test('loads reservations, roster, dates and courts from the supplied Apps Script URL', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  const requestedUrls = []
  global.fetch = async (url, options) => {
    requestedUrls.push(String(url))
    assert.equal(options.cache, 'no-store')
    // The unpruned history read uses the SAME script's existing read-only
    // `getAll` action, so past (ended) reservations stay searchable.
    if (String(url).includes('action=getAll')) {
      return jsonResponse({
        success: true,
        version: '2.0',
        roster: ['Abbey, Stephanie'],
        reservations: {
          'Barnes Tennis Center|2026-08-11|4': {
            '8:00 AM–8:30 AM': ['Abbey, Stephanie', 'Andreoli, Mia'],
          },
        },
      })
    }
    return jsonResponse({
      success: true,
      version: '2.0',
      data: {
        roster: ['Abbey, Stephanie'],
        reservations: {
          'Barnes Tennis Center|2001-08-11|4': {
            '8:00 AM–8:30 AM': ['Abbey, Stephanie'],
          },
          'Barnes Tennis Center|2026-08-11|4': {
            '8:00 AM–8:30 AM': ['Abbey, Stephanie', 'Andreoli, Mia'],
          },
        },
        days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-15'],
        courtsByDate: {
          '2026-08-10': { 'Barnes Tennis Center': [4, 5] },
          '2026-08-11': { 'Barnes Tennis Center': [4, 5] },
          '2026-08-12': { 'Barnes Tennis Center': [4, 5, 6] }, // empty court 6
        },
        locations: ['Barnes Tennis Center', 'Peninsula Tennis Club'],
      },
    })
  }

  const { getSchedule } = await loadFreshSheetsModule('read')
  const schedule = await getSchedule()

  assert.ok(requestedUrls.every((u) => u.includes('AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g')))
  assert.ok(requestedUrls.some((u) => /action=getSchedule/.test(u)), 'the bookable schedule is read')
  assert.ok(requestedUrls.some((u) => /action=getAll/.test(u)), 'the ended-slot history is read read-only')
  assert.ok(schedule.reservationHistory, 'history is exposed for the reservation search')
  assert.equal(schedule.connected, true)
  assert.equal(schedule.source, 'webapp')
  assert.equal(schedule.scriptVersion, '2.0')
  assert.deepEqual(schedule.roster, ['Abbey, Stephanie'])
  assert.deepEqual(schedule.days, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-15'])
  assert.deepEqual(schedule.courtsByDate['2026-08-12']['Barnes Tennis Center'], [4, 5, 6])
  assert.deepEqual(schedule.locations, ['Barnes Tennis Center', 'Peninsula Tennis Club'])
  assert.deepEqual(
    schedule.reservations['Barnes Tennis Center|2026-08-11|4']['8:00 AM–8:30 AM'],
    ['Abbey, Stephanie', 'Andreoli, Mia'],
  )
  assert.equal(schedule.reservations['Barnes Tennis Center|2001-08-11|4'], undefined)
})

test('derives days and courts from reservations when talking to a legacy deployment', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  global.fetch = async (url) => {
    if (String(url).includes('action=getAll')) {
      return jsonResponse({
        success: true,
        version: '1.2',
        roster: ['Abbey, Stephanie'],
        reservations: {
          'Barnes Tennis Center|2026-08-11|4': { '8:00 AM–8:30 AM': ['Abbey, Stephanie'] },
        },
      })
    }
    return jsonResponse({ success: true, version: '1.2', data: null })
  }

  const { getSchedule } = await loadFreshSheetsModule('legacy-read')
  const schedule = await getSchedule()

  assert.equal(schedule.connected, true)
  assert.ok(schedule.days.includes('2026-08-11'))
  assert.deepEqual(schedule.courtsByDate['2026-08-11']['Barnes Tennis Center'], [4])
  assert.deepEqual(schedule.locations, ['Barnes Tennis Center'])
})

test('books a whole group atomically via bookGroup', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  let request
  global.fetch = async (url, options) => {
    request = { url: String(url), options }
    return jsonResponse({ success: true, version: '2.0' })
  }

  const { bookGroup } = await loadFreshSheetsModule('group-book')
  await bookGroup({
    location: 'Barnes Tennis Center',
    date: '2026-08-15',
    courtId: 6,
    slots: ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM'],
    names: ['Abbey, Stephanie', 'Chen, Alice'],
  })

  assert.equal(request.options.method, 'POST')
  assert.deepEqual(JSON.parse(request.options.body), {
    action: 'bookGroup',
    location: 'Barnes Tennis Center',
    date: '2026-08-15',
    courtId: '6',
    slots: ['8:00 AM–8:30 AM', '8:30 AM–9:00 AM'],
    names: ['Abbey, Stephanie', 'Chen, Alice'],
    staffApproved: false,
    practiceLocations: null,
  })
})

test('cancels a whole group atomically via cancelGroup', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  let request
  global.fetch = async (url, options) => {
    request = { url: String(url), options }
    return jsonResponse({ success: true, version: '2.0' })
  }

  const { cancelGroup } = await loadFreshSheetsModule('group-cancel')
  await cancelGroup({
    location: 'Barnes Tennis Center',
    date: '2026-08-15',
    courtId: 6,
    slots: ['8:00 AM–8:30 AM'],
    names: ['Abbey, Stephanie', 'Chen, Alice'],
  })

  assert.deepEqual(JSON.parse(request.options.body), {
    action: 'cancelGroup',
    location: 'Barnes Tennis Center',
    date: '2026-08-15',
    courtId: '6',
    slots: ['8:00 AM–8:30 AM'],
    names: ['Abbey, Stephanie', 'Chen, Alice'],
    staffApproved: false,
    practiceLocations: null,
  })
})

test('writes a single reservation to Apps Script (legacy toggle)', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  let request
  global.fetch = async (url, options) => {
    request = { url: String(url), options }
    return jsonResponse({ success: true, version: '2.0' })
  }

  const { toggleReservation } = await loadFreshSheetsModule('write')
  await toggleReservation({
    location: 'Barnes Tennis Center',
    date: '2026-08-15',
    courtId: 4,
    slot: '8:00 AM–8:30 AM',
    name: 'Abbey, Stephanie',
  })

  assert.match(request.url, /AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/)
  assert.equal(request.options.method, 'POST')
  assert.deepEqual(JSON.parse(request.options.body), {
    action: 'toggleReservation',
    location: 'Barnes Tennis Center',
    date: '2026-08-15',
    courtId: '4',
    slot: '8:00 AM–8:30 AM',
    name: 'Abbey, Stephanie',
    staffApproved: false,
    practiceLocations: null,
  })
})

test('retries the copied sheet legacy 2001 date when an old deployment cannot find 2026', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  const postedDates = []
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body)
    postedDates.push(payload.date)
    if (postedDates.length === 1) {
      return jsonResponse({ success: false, error: 'Error: Date not found in sheet: 2026-08-11 on Barnes TC' })
    }
    return jsonResponse({ success: true, version: '1.2' })
  }

  const { toggleReservation } = await loadFreshSheetsModule('legacy-write')
  await toggleReservation({
    location: 'Barnes Tennis Center',
    date: '2026-08-11',
    courtId: 4,
    slot: '8:00 AM–8:30 AM',
    name: 'Abbey, Stephanie',
  })

  assert.deepEqual(postedDates, ['2026-08-11', '2001-08-11'])
})
