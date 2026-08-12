// Local mock of the v2.1 Apps Script web app for integration testing.
// The grid mirrors the real test sheet's layout but its dates are generated
// relative to "today" (America/Los_Angeles) so integration tests stay
// deterministic: two past days, today, tomorrow (bookable) and the day after
// tomorrow (view-only).
//   Barnes TC  - courts 4,5 on the first three days; 4,5,6 on the last two
//   Peninsula  - courts 1..12
//   PLNU       - courts 1..6
//   Pacific Beach TC / Balboa / USD - one seed reservation on the view-only
//   day (names in the SECOND column of the court's span, as in the real sheet)
// The mock applies the v2.1 booking rules (booking window + session limits +
// staff-approval warnings) under a serialised write queue that stands in for
// the Apps Script document lock.

import http from 'node:http'
import {
  validateBooking,
  existingPlayerSessions,
  isSlotCompleted,
  laNow,
  addDaysToDateKey,
} from '../lib/booking-rules.js'
import { DEFAULT_PRACTICE_LOCATIONS } from '../lib/locations.js'

const SCRIPT_VERSION = '2.1'

const LOCATION_MAP = {
  'Barnes TC': 'Barnes Tennis Center',
  'Peninsula Tennis Club': 'Peninsula Tennis Club',
  'Point Loma Nazarene College': 'Point Loma Nazarene College',
  'Pacific Beach TC': 'Pacific Beach Tennis Club',
  'Balboa Tennis': 'Balboa Tennis Center',
  'USD': 'USD',
}

const tabs = Object.keys(LOCATION_MAP)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday} ${MONTHS[m - 1]} ${d}`
}

const DAY_KEYS = (() => {
  const today = laNow().dateKey
  return [addDaysToDateKey(today, -2), addDaysToDateKey(today, -1), today, addDaysToDateKey(today, 1), addDaysToDateKey(today, 2)]
})()

// 8:00 AM .. 11:30 AM (enough for the session-limit scenarios)
const SLOT_STARTS = []
for (let t = 8 * 60; t <= 11 * 60 + 30; t += 30) SLOT_STARTS.push(t)

function timeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}

function emptyGrid(ncourts, baseCourt = 1) {
  // date row + header row + time rows (2 rows per 30-minute slot)
  const grid = []
  DAY_KEYS.forEach((dateKey, dateIndex) => {
    const courtCount = ncourts === 3 && dateIndex < 3 ? 2 : ncourts // Barnes adds court 6 on the last two days
    // Each court spans two columns: number, blank, number, blank, ...
    const header = ['', ...Array.from({ length: 2 * courtCount }, (_, i) => (i % 2 === 0 ? baseCourt + i / 2 : ''))]
    grid.push([dateLabel(dateKey), '', '', '', '', '', '', '', '', ''])
    grid.push(header)
    for (const start of SLOT_STARTS) {
      grid.push([timeLabel(start), '', '', '', '', '', '', '', '', ''])
      grid.push(['', '', '', '', '', '', '', '', '', ''])
    }
  })
  return grid
}

// Seed reservations on the view-only day (like the real sheet's Wednesday
// reservations that the old parser used to drop).
const seedNames = {
  'Pacific Beach Tennis Club': { court: 1, names: ['Waters, Eadan', 'Chen, Alice'] },
  'Balboa Tennis Center': { court: 3, names: ['Reeves, Sam', 'Zhou, Zhongyi'] },
  'USD': { court: 2, names: ['Andreoli, Mia', 'Shi, Kelly'] },
}

const grids = {}
for (const tab of tabs) {
  const ncourts = tab === 'Barnes TC' ? 3 : tab === 'Peninsula Tennis Club' ? 12 : 6
  // Barnes courts are numbered 4..6 in the real sheet.
  const grid = emptyGrid(ncourts, tab === 'Barnes TC' ? 4 : 1)
  const seed = seedNames[LOCATION_MAP[tab]]
  if (seed) {
    const viewOnlyLabel = dateLabel(DAY_KEYS[4])
    for (let r = 0; r < grid.length; r++) {
      if (String(grid[r][0]).includes(viewOnlyLabel)) {
        for (let rr = r + 1; rr < grid.length; rr++) {
          if (String(grid[rr][0]).includes('8:30 AM')) {
            grid[rr][(seed.court - 1) * 2 + 2] = seed.names[0]
            grid[rr + 1][(seed.court - 1) * 2 + 2] = seed.names[1]
            break
          }
        }
        break
      }
    }
  }
  grids[tab] = grid
}

// Very small span-aware parser mirroring the Apps Script behaviour
function parseGrid(values, tab) {
  const location = LOCATION_MAP[tab]
  const reservations = {}
  const dates = []
  const courtsByDate = {}
  let currentDate = null
  let courts = []
  for (let r = 0; r < values.length; r++) {
    const row = values[r]
    const first = String(row[0] || '').trim()
    const isDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3,9}\s+\d{1,2}/i.test(first)
    if (isDate) {
      const m = first.match(/([A-Za-z]{3,9})\s+(\d{1,2})/i)
      const month = String(MONTHS.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) + 1).padStart(2, '0')
      currentDate = `2026-${month}-${String(m[2]).padStart(2, '0')}`
      dates.push(currentDate)
      continue
    }
    const nums = []
    row.forEach((c, i) => {
      if (i > 0 && /^\d{1,2}$/.test(String(c || '').trim())) nums.push({ n: Number(c), idx: i })
    })
    if (nums.length && !first) {
      courts = nums.map((e, i) => {
        const start = e.idx
        const end = i + 1 < nums.length ? nums[i + 1].idx - 1 : start + 1
        return { court: e.n, cols: Array.from({ length: end - start + 1 }, (_, k) => start + k) }
      })
      if (currentDate) {
        if (!courtsByDate[currentDate]) courtsByDate[currentDate] = {}
        courtsByDate[currentDate][location] = courts.map(c => c.court)
      }
      continue
    }
    const timeMatch = first.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i)
    if (timeMatch && currentDate && courts.length) {
      const timeLabelN = normalizeTimeMock(first)
      const slot30 = `${timeLabelN}–${addMinutesMock(timeLabelN, 30)}`
      const secondRow = values[r + 1]
      const isSecondTime = /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(String(secondRow && secondRow[0] || '').trim())
      for (const c of courts) {
        const names = []
        for (const col of c.cols) {
          const v = String(row[col] || '').trim()
          if (v) names.push(v)
        }
        if (!isSecondTime) {
          for (const col of c.cols) {
            const v = String(secondRow[col] || '').trim()
            if (v) names.push(v)
          }
        }
        if (names.length) {
          const key = `${location}|${currentDate}|${c.court}`
          if (!reservations[key]) reservations[key] = {}
          if (!reservations[key][slot30]) reservations[key][slot30] = []
          names.forEach(n => { if (!reservations[key][slot30].includes(n)) reservations[key][slot30].push(n) })
        }
      }
    }
  }
  return { reservations, dates: [...new Set(dates)], courtsByDate }
}

function normalizeTimeMock(s) {
  return String(s).trim().replace(/(\d)(AM|PM)/i, '$1 $2').toUpperCase()
}
function addMinutesMock(timeStr, mins) {
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  let h = Number(m[1]), min = Number(m[2])
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  const total = h * 60 + min + mins
  let nh = Math.floor(total / 60) % 24, nm = total % 60
  const ap = nh >= 12 ? 'PM' : 'AM'
  const dh = nh % 12 === 0 ? 12 : nh % 12
  return `${dh}:${String(nm).padStart(2, '0')} ${ap}`
}

function locationToTab(location) {
  for (const [tab, name] of Object.entries(LOCATION_MAP)) {
    if (name === location || location.includes(name.split(' ')[0])) return tab
  }
  return location
}

function locateSlotCells(values, date, courtId, startNorm) {
  let sectionStart = -1
  for (let r = 0; r < values.length; r++) {
    const first = String(values[r][0] || '').trim()
    if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3,9}\s+\d{1,2}$/i.test(first)) {
      const m = first.match(/([A-Za-z]{3,9})\s+(\d{1,2})/i)
      const month = String(MONTHS.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) + 1).padStart(2, '0')
      const thisDate = `2026-${month}-${String(m[2]).padStart(2, '0')}`
      if (thisDate === date) { sectionStart = r; break }
    }
  }
  if (sectionStart === -1) return null
  let sectionEnd = values.length
  for (let r = sectionStart + 1; r < values.length; r++) {
    const first = String(values[r][0] || '').trim()
    if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3,9}\s+\d{1,2}$/i.test(first)) { sectionEnd = r; break }
  }
  let cols = []
  for (let r = sectionStart + 1; r < sectionEnd; r++) {
    const nums = []
    values[r].forEach((c, i) => { if (i > 0 && /^\d{1,2}$/.test(String(c || '').trim())) nums.push({ n: Number(c), idx: i }) })
    if (nums.length && !String(values[r][0] || '').trim()) {
      cols = nums.map((e, i) => {
        const start = e.idx
        const end = i + 1 < nums.length ? nums[i + 1].idx - 1 : start + 1
        return { court: e.n, cols: Array.from({ length: end - start + 1 }, (_, k) => start + k) }
      })
      break
    }
  }
  const court = cols.find(c => String(c.court) === String(courtId))
  if (!court) return null
  let timeRow = -1
  for (let r = sectionStart + 1; r < sectionEnd; r++) {
    if (normalizeTimeMock(values[r][0]) === startNorm) { timeRow = r; break }
  }
  if (timeRow === -1) return null
  const rows = [timeRow]
  const next = values[timeRow + 1]
  if (next && !/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(String(next[0] || '').trim()) && !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s/i.test(String(next[0] || '').trim())) rows.push(timeRow + 1)
  const cells = []
  for (const rr of rows) for (const col of court.cols) cells.push({ row: rr, col, value: String(values[rr][col] || '').trim() })
  return cells
}

// Current reservations of every tab, merged exactly like the Apps Script.
function currentReservations() {
  const all = {}
  for (const tab of tabs) {
    const p = parseGrid(grids[tab], tab)
    for (const [k, slots] of Object.entries(p.reservations)) {
      if (!all[k]) all[k] = {}
      for (const [slot, names] of Object.entries(slots)) {
        if (!all[k][slot]) all[k][slot] = []
        names.forEach(n => { if (!all[k][slot].includes(n)) all[k][slot].push(n) })
      }
    }
  }
  return all
}

// Serialised writes (stands in for the Apps Script document lock).
let writeQueue = Promise.resolve()

const PORT = Number(process.env.MOCK_PORT || 3100)

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }

  if (req.method === 'GET' && url.searchParams.get('action') === 'getSchedule') {
    const all = currentReservations()
    const days = []
    const courtsByDate = {}
    for (const tab of tabs) {
      const p = parseGrid(grids[tab], tab)
      p.dates.forEach(d => { if (!days.includes(d)) days.push(d) })
      for (const [d, locMap] of Object.entries(p.courtsByDate)) {
        if (!courtsByDate[d]) courtsByDate[d] = {}
        if (!courtsByDate[d][LOCATION_MAP[tab]]) courtsByDate[d][LOCATION_MAP[tab]] = locMap[LOCATION_MAP[tab]]
      }
    }
    // v2.1: ended 30-minute slots are no longer exposed (they are not
    // bookable or cancellable), and practice-session metadata is reported so
    // the UI can show how many sessions each player has used per day.
    const practiceSessions = {}
    days.forEach(d => {
      practiceSessions[d] = {}
      DEFAULT_PRACTICE_LOCATIONS.forEach(loc => {
        practiceSessions[d][loc] = existingPlayerSessions(all, { dateKey: d, name: null, practiceLocations: DEFAULT_PRACTICE_LOCATIONS })
          .filter(s => s.location === loc)
          .map(s => ({ player: s.player, court: s.court, start: s.start, slots: s.slots }))
      })
    })
    for (const [key, slots] of Object.entries(all)) {
      const [, date] = key.split('|')
      for (const [slot] of Object.entries(slots)) {
        if (isSlotCompleted(date, slot)) delete slots[slot]
      }
      if (!Object.keys(slots).length) delete all[key]
    }
    return send({ success: true, version: SCRIPT_VERSION, data: {
      roster: ['Abbey, Stephanie', 'Chen, Alice', 'Waters, Eadan', 'Reeves, Sam', 'Zhou, Zhongyi', 'Andreoli, Mia', 'Shi, Kelly'],
      reservations: all,
      days: [...new Set(days)].sort(),
      courtsByDate,
      locations: Object.values(LOCATION_MAP),
      practiceSessions,
      defaultPracticeLocations: DEFAULT_PRACTICE_LOCATIONS,
    } })
  }
  if (req.method === 'GET' && url.searchParams.get('action') === 'ping') {
    return send({ success: true, version: SCRIPT_VERSION, tabs })
  }

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let data
      try {
        data = JSON.parse(body)
      } catch (e) {
        return send({ success: false, version: SCRIPT_VERSION, error: 'Invalid JSON body' }, 400)
      }
      const tab = locationToTab(data.location)
      const values = grids[tab]
      if (values === undefined) {
        return send({ success: false, version: SCRIPT_VERSION, error: 'Sheet not found: ' + tab })
      }

      writeQueue = writeQueue.then(() => {
        try {
          if (data.action === 'bookGroup' || data.action === 'cancelGroup') {
            const names = [...new Set((data.names || []).map(n => String(n).trim()).filter(Boolean))]
            const slots = [...new Set((data.slots || []).map(s => String(s).trim()).filter(Boolean))]
            const validation = validateBooking({
              action: data.action === 'bookGroup' ? 'book' : 'cancel',
              location: data.location,
              date: data.date,
              courtId: data.courtId,
              slots,
              names,
              staffApproved: Boolean(data.staffApproved),
              reservations: currentReservations(),
              practiceLocations: data.practiceLocations,
            })
            if (!validation.ok) {
              return send({ success: false, version: SCRIPT_VERSION, error: validation.error, code: validation.isSessionLimitError ? 'SESSION_LIMIT' : 'BOOKING_RULES' }, 409)
            }
            if (data.action === 'bookGroup' && validation.warnings.length && !data.staffApproved) {
              return send({
                success: false,
                version: SCRIPT_VERSION,
                error: 'This booking is within one hour of another practice session. Tournament staff approval is required to continue.',
                code: 'STAFF_APPROVAL_REQUIRED',
                warnings: validation.warnings,
              }, 409)
            }

            if (data.action === 'bookGroup') {
              for (const slot of slots) {
                const startNorm = normalizeTimeMock(String(slot).split(/[–-]/)[0].trim())
                const cells = locateSlotCells(values, data.date, data.courtId, startNorm)
                if (!cells) return send({ success: false, version: SCRIPT_VERSION, error: 'Time slot not found: ' + slot })
                const filled = cells.filter(c => c.value)
                if (filled.length) return send({ success: false, version: SCRIPT_VERSION, error: 'Slot already booked on ' + tab + ' ' + data.date + ' Court ' + data.courtId })
                if (cells.length < names.length) return send({ success: false, version: SCRIPT_VERSION, error: 'Not enough cells' })
                for (let i = 0; i < names.length; i++) {
                  values[cells[i].row][cells[i].col] = names[i]
                }
              }
              return send({ success: true, version: SCRIPT_VERSION, action: 'bookGroup', warnings: validation.warnings })
            }

            // cancelGroup
            const namesSet = new Set(names)
            let found = 0
            for (const slot of slots) {
              const startNorm = normalizeTimeMock(String(slot).split(/[–-]/)[0].trim())
              const cells = locateSlotCells(values, data.date, data.courtId, startNorm) || []
              for (const c of cells) {
                if (c.value && namesSet.has(c.value)) { values[c.row][c.col] = ''; found++ }
              }
            }
            if (!found) return send({ success: false, version: SCRIPT_VERSION, error: 'No booking found to cancel' })
            return send({ success: true, version: SCRIPT_VERSION, action: 'cancelGroup' })
          }
          return send({ success: false, version: SCRIPT_VERSION, error: 'Unknown POST action' })
        } catch (e) {
          return send({ success: false, version: SCRIPT_VERSION, error: e.toString() })
        }
      })
    })
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock apps script (v2.1) listening on http://127.0.0.1:${PORT}/exec`)
})
