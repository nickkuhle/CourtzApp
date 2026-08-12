import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getLAParts, getLADateKey } from '../lib/booking-window.js'

// Loads the REAL CourtzAppsScript.gs into a Node VM with minimal Apps Script
// stubs and exercises its booking-window and session-rule validation directly.
// This proves the logic that will run inside Google Apps Script (where it
// rechecks under the write lock), not just the JS mirror in lib/.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const gasSource = fs.readFileSync(path.join(__dirname, '..', 'CourtzAppsScript.gs'), 'utf8')

// Fixed "now": 2026-08-12 20:15 UTC = 1:15 PM America/Los_Angeles.
const FIXED_MS = Date.UTC(2026, 7, 12, 20, 15)

function buildGAS(nowMs = FIXED_MS) {
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(nowMs)
      else super(...args)
    }
    static now() {
      return nowMs
    }
  }

  const pad = (n) => String(n).padStart(2, '0')
  const sandbox = {
    Date: FixedDate,
    console,
    Utilities: {
      formatDate(date, tz, fmt) {
        assert.equal(tz, 'America/Los_Angeles')
        const p = getLAParts(date)
        if (fmt === 'yyyy-MM-dd') return `${p.year}-${pad(p.month)}-${pad(p.day)}`
        if (fmt === 'HH:mm') return `${pad(p.hours)}:${pad(p.minutes)}`
        throw new Error(`unexpected formatDate pattern: ${fmt}`)
      },
    },
    Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
    SpreadsheetApp: { openById: () => { throw new Error('not used in these tests') } },
    LockService: { getDocumentLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }) },
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(gasSource, context, { filename: 'CourtzAppsScript.gs' })
  return context
}

// Minimal grid fixture: one date (Wed Aug 12 = 2026-08-12), courts 4 and 5 at
// Barnes with two-column spans, and Peninsula court 1.
function gridValues(courtNumbers) {
  const rows = []
  rows.push(['Wed Aug 12', '', '', '', '', '', '', '', '', '', '', '', ''])
  const header = ['', ...courtNumbers.flatMap((n) => [n, ''])]
  while (header.length < 13) header.push('')
  rows.push(header)
  const times = [
    '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM',
    '10:00 AM', '10:30 AM', '11:00 AM', '12:30 PM', '1:00 PM', '1:30 PM',
    '2:00 PM', '2:30 PM',
  ]
  for (const t of times) {
    rows.push([t, ...Array.from({ length: 12 }, () => '')])
    rows.push(['', ...Array.from({ length: 12 }, () => '')])
  }
  return rows
}

function courtCol(courtNumber, courtNumbers) {
  // 0-based index of the FIRST column of a court within a header built from
  // courtNumbers (courts appear in list order, each spanning two columns).
  const order = courtNumbers.indexOf(courtNumber)
  return 1 + order * 2
}

function makeFakeSS(tabs) {
  const sheets = tabs.map((t) => ({
    getName: () => t.name,
    getDataRange: () => ({ getValues: () => t.values }),
  }))
  return {
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((s) => s.getName() === name) || null,
  }
}

function emptyPlayersTab() {
  return { name: 'Players', values: [['Name'], ['Player A'], ['Player B']] }
}

test('GAS parseGridValues keeps the multi-column court spans', () => {
  const gas = buildGAS()
  const values = gridValues([4, 5])
  values[2][courtCol(4, [4, 5])] = 'Zhou, Zhongyi' // 8:00 AM, court 4, first column of its span
  values[3][courtCol(4, [4, 5]) + 1] = 'Shi, Kelly' // continuation row, second column of court 4's span
  values[2][courtCol(5, [4, 5])] = 'Neves, Lucia' // 8:00 AM, court 5, first column
  const parsed = gas.parseGridValues(values, 'Barnes TC')
  const key = 'Barnes Tennis Center|2026-08-12|4'
  assert.deepEqual([...parsed.reservations[key]['8:00 AM\u20138:30 AM']], ['Zhou, Zhongyi', 'Shi, Kelly'])
  assert.deepEqual([...parsed.reservations['Barnes Tennis Center|2026-08-12|5']['8:00 AM\u20138:30 AM']], ['Neves, Lucia'])
})

test('GAS booking window: today/tomorrow only, ended slots locked, current slot open', () => {
  const gas = buildGAS()
  // Fixed now is 1:15 PM LA on 2026-08-12.
  assert.doesNotThrow(() => gas.validateBookingWindowInGAS({ date: '2026-08-12', slots: ['1:00 PM\u20131:30 PM'] }))
  assert.doesNotThrow(() => gas.validateBookingWindowInGAS({ date: '2026-08-13', slots: ['8:00 AM\u20138:30 AM'] }))
  assert.throws(
    () => gas.validateBookingWindowInGAS({ date: '2026-08-11', slots: ['9:00 AM\u20139:30 AM'] }),
    /view only/,
  )
  assert.throws(
    () => gas.validateBookingWindowInGAS({ date: '2026-08-12', slots: ['12:30 PM\u20131:00 PM'] }),
    /already ended/,
  )
})

test('GAS session rules: 60-minute Peninsula booking = one session, no internal warning', () => {
  const gas = buildGAS()
  const tabs = [
    emptyPlayersTab(),
    { name: 'Peninsula Tennis Club', values: gridValues([1]) },
  ]
  const ss = makeFakeSS(tabs)
  assert.doesNotThrow(() =>
    gas.validateSessionRulesInGAS(ss, {
      location: 'Peninsula Tennis Club',
      date: '2026-08-12',
      courtId: 1,
      slots: ['8:00 AM\u20138:30 AM', '8:30 AM\u20139:00 AM'],
      names: ['Fresh Player'],
      staffApproved: false,
    }),
  )
})

test('GAS session rules: two 60-minute sessions allowed, a third is rejected', () => {
  const gas = buildGAS()
  const peninsula = gridValues([1, 2])
  // Player A holds one 60-minute session on court 1: 8:00-9:00.
  peninsula[2][courtCol(1, [1, 2])] = 'Player A' // 8:00
  peninsula[3][courtCol(1, [1, 2])] = 'Player A'
  peninsula[4][courtCol(1, [1, 2])] = 'Player A' // 8:30
  peninsula[5][courtCol(1, [1, 2])] = 'Player A'
  // Player D holds two 60-minute sessions on court 2: 8:00-9:00 and 10:00-11:00.
  peninsula[2][courtCol(2, [1, 2])] = 'Player D' // 8:00
  peninsula[3][courtCol(2, [1, 2])] = 'Player D'
  peninsula[4][courtCol(2, [1, 2])] = 'Player D' // 8:30
  peninsula[5][courtCol(2, [1, 2])] = 'Player D'
  peninsula[10][courtCol(2, [1, 2])] = 'Player D' // 10:00
  peninsula[11][courtCol(2, [1, 2])] = 'Player D'
  peninsula[12][courtCol(2, [1, 2])] = 'Player D' // 10:30
  peninsula[13][courtCol(2, [1, 2])] = 'Player D'
  const ss = makeFakeSS([emptyPlayersTab(), { name: 'Peninsula Tennis Club', values: peninsula }])

  // A second 60-minute session two hours later is allowed for Player A.
  assert.doesNotThrow(() =>
    gas.validateSessionRulesInGAS(ss, {
      location: 'Peninsula Tennis Club',
      date: '2026-08-12',
      courtId: 1,
      slots: ['10:00 AM\u201310:30 AM', '10:30 AM\u201311:00 AM'],
      names: ['Player A'],
      staffApproved: false,
    }),
  )

  // Player D's third session is rejected even with staffApproved (hard limit).
  assert.throws(
    () =>
      gas.validateSessionRulesInGAS(ss, {
        location: 'Peninsula Tennis Club',
        date: '2026-08-12',
        courtId: 2,
        slots: ['2:00 PM\u20132:30 PM', '2:30 PM\u20133:00 PM'],
        names: ['Player D'],
        staffApproved: true,
      }),
    /2 practice sessions/,
  )

  // Back-to-back with Player A's existing session needs approval...
  assert.throws(
    () =>
      gas.validateSessionRulesInGAS(ss, {
        location: 'Peninsula Tennis Club',
        date: '2026-08-12',
        courtId: 1,
        slots: ['9:00 AM\u20139:30 AM'],
        names: ['Player A'],
        staffApproved: false,
      }),
    /STAFF_APPROVAL_REQUIRED/,
  )
  // ...and the staff override lets it through (still within the max of two).
  assert.doesNotThrow(() =>
    gas.validateSessionRulesInGAS(ss, {
      location: 'Peninsula Tennis Club',
      date: '2026-08-12',
      courtId: 1,
      slots: ['9:00 AM\u20139:30 AM'],
      names: ['Player A'],
      staffApproved: true,
    }),
  )
})

test('GAS session rules: adjacent Barnes slots are two sessions and need staff approval', () => {
  const gas = buildGAS()
  const barnes = gridValues([4, 5])
  barnes[2][courtCol(4, [4, 5])] = 'Player B' // 8:00 AM on court 4
  const ss = makeFakeSS([emptyPlayersTab(), { name: 'Barnes TC', values: barnes }])

  assert.throws(
    () =>
      gas.validateSessionRulesInGAS(ss, {
        location: 'Barnes Tennis Center',
        date: '2026-08-12',
        courtId: 4,
        slots: ['8:30 AM\u20139:00 AM'],
        names: ['Player B'],
        staffApproved: false,
      }),
    /STAFF_APPROVAL_REQUIRED/,
  )
  // The override proceeds.
  assert.doesNotThrow(() =>
    gas.validateSessionRulesInGAS(ss, {
      location: 'Barnes Tennis Center',
      date: '2026-08-12',
      courtId: 4,
      slots: ['8:30 AM\u20139:00 AM'],
      names: ['Player B'],
      staffApproved: true,
    }),
  )
})

test('GAS session rules: hidden-site reservations do not count unless active', () => {
  const gas = buildGAS()
  const usd = gridValues([1, 2])
  // Player C holds two 60-minute sessions at USD: 8:00-9:00 and 10:00-11:00.
  usd[2][courtCol(1, [1, 2])] = 'Player C' // 8:00
  usd[3][courtCol(1, [1, 2])] = 'Player C'
  usd[4][courtCol(1, [1, 2])] = 'Player C' // 8:30
  usd[5][courtCol(1, [1, 2])] = 'Player C'
  usd[10][courtCol(1, [1, 2])] = 'Player C' // 10:00
  usd[11][courtCol(1, [1, 2])] = 'Player C'
  usd[12][courtCol(1, [1, 2])] = 'Player C' // 10:30
  usd[13][courtCol(1, [1, 2])] = 'Player C'
  const peninsula = gridValues([1])
  const ss = makeFakeSS([
    emptyPlayersTab(),
    { name: 'USD', values: usd },
    { name: 'Peninsula Tennis Club', values: peninsula },
  ])

  const booking = {
    location: 'Peninsula Tennis Club',
    date: '2026-08-12',
    courtId: 1,
    slots: ['2:00 PM\u20132:30 PM'],
    names: ['Player C'],
  }
  // USD hidden -> allowed.
  assert.doesNotThrow(() => gas.validateSessionRulesInGAS(ss, { ...booking, activeLocations: [] }))
  // USD deliberately added -> third session -> rejected.
  assert.throws(
    () => gas.validateSessionRulesInGAS(ss, { ...booking, activeLocations: ['USD'], staffApproved: true }),
    /2 practice sessions/,
  )
})

test('GAS readFullSchedule discovers grid tabs dynamically', () => {
  const gas = buildGAS()
  const newTab = gridValues([1, 2, 3])
  const ss = makeFakeSS([
    emptyPlayersTab(),
    { name: 'Barnes TC', values: gridValues([4, 5]) },
    { name: 'Brand New Courts', values: newTab }, // a brand-new tab not in LOCATION_MAP
  ])
  const schedule = gas.readFullSchedule(ss)
  assert.ok(schedule.locations.includes('Brand New Courts'))
  assert.ok(schedule.locations.includes('Barnes Tennis Center'))
  assert.deepEqual([...schedule.courtsByDate['2026-08-12']['Brand New Courts']], [1, 2, 3])
})
