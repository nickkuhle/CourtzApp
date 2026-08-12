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

test('loads reservations and roster from the supplied Apps Script URL', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  let requestedUrl = ''
  global.fetch = async (url, options) => {
    requestedUrl = String(url)
    assert.equal(options.cache, 'no-store')
    return jsonResponse({
      success: true,
      version: '1.1',
      roster: ['Abbey, Stephanie'],
      reservations: {
        'Barnes Tennis Center|2001-08-11|4': {
          '8:00 AM–8:30 AM': ['Abbey, Stephanie'],
        },
        'Barnes Tennis Center|2026-08-11|4': {
          '8:00 AM–8:30 AM': ['Abbey, Stephanie', 'Andreoli, Mia'],
        },
      },
    })
  }

  const { getSchedule } = await loadFreshSheetsModule('read')
  const schedule = await getSchedule()

  assert.match(requestedUrl, /AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/)
  assert.match(requestedUrl, /action=getAll/)
  assert.equal(schedule.connected, true)
  assert.equal(schedule.source, 'webapp')
  assert.deepEqual(schedule.roster, ['Abbey, Stephanie'])
  assert.deepEqual(
    schedule.reservations['Barnes Tennis Center|2026-08-11|4']['8:00 AM–8:30 AM'],
    ['Abbey, Stephanie', 'Andreoli, Mia'],
  )
  assert.equal(schedule.reservations['Barnes Tennis Center|2001-08-11|4'], undefined)
})

test('writes a reservation to Apps Script', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  let request
  global.fetch = async (url, options) => {
    request = { url: String(url), options }
    return jsonResponse({ success: true, version: '1.1' })
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
  })
})

test('retries the copied sheet legacy 2001 date when Apps Script v1.1 cannot find 2026', async () => {
  delete process.env.SHEETS_WEBAPP_URL
  const postedDates = []
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body)
    postedDates.push(payload.date)
    if (postedDates.length === 1) {
      return jsonResponse({ success: false, error: 'Error: Date not found in sheet: 2026-08-11 on Barnes TC' })
    }
    return jsonResponse({ success: true, version: '1.1' })
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
