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
  let requestedUrl = ''
  global.fetch = async (url, options) => {
    requestedUrl = String(url)
    assert.equal(options.cache, 'no-store')
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

  assert.match(requestedUrl, /AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/)
  assert.match(requestedUrl, /action=getSchedule/)
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

test('the service-account fallback keeps the grid days and courts (empty courts included)', async () => {
  // Regression: getSchedule's fallback used to throw away the days/courtsByDate
  // reported by the service-account grid read and re-derive them from
  // reservation keys, so empty courts (e.g. Barnes Court 6) disappeared.
  const { composeFallbackSchedule } = await loadFreshSheetsModule('fallback-grid')
  const schedule = composeFallbackSchedule({
    reservations: {
      'Barnes Tennis Center|2026-08-11|4': { '8:00 AM–8:30 AM': ['Abbey, Stephanie'] },
    },
    roster: ['Abbey, Stephanie'],
    source: 'service-account',
    gridDays: ['2026-08-10', '2026-08-11', '2026-08-10'], // unsorted, duplicated
    gridCourtsByDate: {
      '2026-08-10': { 'Barnes Tennis Center': [4, 5, 6] },
      '2026-08-11': { 'Barnes Tennis Center': [4, 5, 6] }, // court 6 has no bookings
    },
  })

  assert.equal(schedule.source, 'service-account')
  assert.equal(schedule.connected, true)
  assert.deepEqual(schedule.days, ['2026-08-10', '2026-08-11']) // sorted + deduped
  assert.deepEqual(schedule.courtsByDate['2026-08-11']['Barnes Tennis Center'], [4, 5, 6])
  assert.deepEqual(schedule.courtsByDate['2026-08-10']['Barnes Tennis Center'], [4, 5, 6])
})

test('the fallback derives days and courts from reservation keys only when no grid data exists', async () => {
  const { composeFallbackSchedule } = await loadFreshSheetsModule('fallback-derive')
  const schedule = composeFallbackSchedule({
    reservations: {
      'Barnes Tennis Center|2026-08-11|4': { '8:00 AM–8:30 AM': ['Abbey, Stephanie'] },
    },
    roster: null,
    source: 'local',
  })

  assert.equal(schedule.connected, false) // local files cannot write to the sheet
  assert.deepEqual(schedule.roster, [])
  assert.ok(schedule.days.includes('2026-08-11'))
  assert.deepEqual(schedule.courtsByDate['2026-08-11']['Barnes Tennis Center'], [4])
  assert.deepEqual(schedule.locations, ['Barnes Tennis Center'])
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
