// Local mock of the v2.2 Apps Script web app for integration testing.
// The grid mirrors the real test sheet's layout but its dates are generated
// relative to "today" (America/Los_Angeles) so integration tests stay
// deterministic: two past days, today, tomorrow (bookable) and the day after
// tomorrow (view-only).
//   Barnes TC  - courts 4,5 on the first three days; 4,5,6 on the last two
//   Peninsula  - courts 1..12
//   PLNU       - courts 1..6
//   Pacific Beach TC / Balboa / USD - one seed reservation on the view-only
//   day (names in the SECOND column of the court's span, as in the real sheet)
// The mock applies the v2.2 booking rules (booking window + session limits +
// protected staff approvals) under a serialised write queue that stands in for
// the Apps Script document lock.

import http from 'node:http'
import {
  validateBooking,
  existingPlayerSessions,
  laNow,
  addDaysToDateKey,
} from '../lib/booking-rules.js'
import { DEFAULT_PRACTICE_LOCATIONS } from '../lib/locations.js'

const SCRIPT_VERSION = '2.4'
const STAFF_APPROVAL_CODE = String(process.env.STAFF_APPROVAL_CODE || '').trim()
let warnedAboutUnprotectedStaffApproval = false

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

// Seed view-only future reservations plus reservations on a past day and in a
// completed slot today. v2.2 schedule reads must preserve all of them.
const seedReservations = {
  'Peninsula Tennis Club': [
    { dayIndex: 0, court: 1, start: 480, names: ['Waters, Eadan'] },
  ],
  'Point Loma Nazarene College': [
    { dayIndex: 2, court: 1, start: 480, names: ['Reeves, Sam'] },
  ],
  'Pacific Beach Tennis Club': [
    { dayIndex: 4, court: 1, start: 510, names: ['Waters, Eadan', 'Chen, Alice'] },
  ],
  'Balboa Tennis Center': [
    { dayIndex: 4, court: 3, start: 510, names: ['Reeves, Sam', 'Zhou, Zhongyi'] },
  ],
  'USD': [
    { dayIndex: 4, court: 2, start: 510, names: ['Andreoli, Mia', 'Shi, Kelly'] },
  ],
}

function writeSeedReservation(grid, seed) {
  const wantedDate = dateLabel(DAY_KEYS[seed.dayIndex])
  const wantedTime = timeLabel(seed.start)
  const dateRow = grid.findIndex(row => String(row[0] || '').trim() === wantedDate)
  if (dateRow === -1) throw new Error(`Seed date not found: ${wantedDate}`)
  const header = grid[dateRow + 1]
  const courtCol = header.findIndex((value, index) => index > 0 && String(value) === String(seed.court))
  if (courtCol === -1) throw new Error(`Seed court not found: ${seed.court}`)
  let nextCourtCol = header.length
  for (let col = courtCol + 1; col < header.length; col++) {
    if (/^\d{1,2}$/.test(String(header[col] || '').trim())) { nextCourtCol = col; break }
  }
  const courtCols = Array.from({ length: nextCourtCol - courtCol }, (_, index) => courtCol + index)
  let timeRow = -1
  for (let row = dateRow + 2; row < grid.length; row++) {
    if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s/i.test(String(grid[row][0] || '').trim())) break
    if (String(grid[row][0] || '').trim() === wantedTime) { timeRow = row; break }
  }
  if (timeRow === -1) throw new Error(`Seed time not found: ${wantedTime}`)
  const cells = []
  for (const row of [timeRow, timeRow + 1]) {
    for (const col of [...courtCols].reverse()) cells.push({ row, col })
  }
  if (cells.length < seed.names.length) throw new Error(`Not enough cells for seed on Court ${seed.court}`)
  seed.names.forEach((name, index) => {
    grid[cells[index].row][cells[index].col] = name
  })
}

const grids = {}
for (const tab of tabs) {
  const ncourts = tab === 'Barnes TC' ? 3 : tab === 'Peninsula Tennis Club' ? 12 : 6
  // Barnes courts are numbered 4..6 in the real sheet.
  const grid = emptyGrid(ncourts, tab === 'Barnes TC' ? 4 : 1)
  for (const seed of seedReservations[LOCATION_MAP[tab]] || []) writeSeedReservation(grid, seed)
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

function warnAboutUnprotectedStaffApprovalOnce() {
  if (warnedAboutUnprotectedStaffApproval) return
  warnedAboutUnprotectedStaffApproval = true
  console.warn('STAFF_APPROVAL_CODE is not set; staffApproved requests are not protected by a staff code.')
}

function authorizeStaffApproval(data) {
  if (!data.staffApproved) return false
  if (!STAFF_APPROVAL_CODE) {
    warnAboutUnprotectedStaffApprovalOnce()
    return true
  }
  if (!String(data.staffCode || '').trim()) {
    const error = new Error('A tournament staff approval code is required.')
    error.code = 'STAFF_APPROVAL_CODE_REQUIRED'
    error.status = 403
    error.staffCodeRequired = true
    throw error
  }
  if (String(data.staffCode).trim() !== STAFF_APPROVAL_CODE) {
    const error = new Error('The tournament staff approval code is incorrect.')
    error.code = 'STAFF_APPROVAL_CODE_INVALID'
    error.status = 403
    error.staffCodeRequired = true
    throw error
  }
  return true
}

function validateWrite(data, action, slots, names) {
  const staffApproved = action === 'book' ? authorizeStaffApproval(data) : false
  const validation = validateBooking({
    action,
    location: data.location,
    date: data.date,
    courtId: data.courtId,
    slots,
    names,
    staffApproved,
    reservations: currentReservations(),
    practiceLocations: data.practiceLocations,
  })
  if (!validation.ok) {
    const error = new Error(validation.error)
    error.code = validation.isSessionLimitError ? 'SESSION_LIMIT' : 'BOOKING_RULES'
    error.status = 409
    throw error
  }
  if (action === 'book' && validation.warnings.length && !staffApproved) {
    if (!STAFF_APPROVAL_CODE) warnAboutUnprotectedStaffApprovalOnce()
    const error = new Error('This booking is within one hour of another practice session. Tournament staff approval is required to continue.')
    error.code = 'STAFF_APPROVAL_REQUIRED'
    error.status = 409
    error.staffCodeRequired = Boolean(STAFF_APPROVAL_CODE)
    error.warnings = validation.warnings
    throw error
  }
  return validation
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
    // v2.2 keeps past and ended reservations in `all`. They remain view-only
    // through the mirrored write rules, and still count in session metadata.
    const practiceSessions = {}
    days.forEach(d => {
      practiceSessions[d] = {}
      DEFAULT_PRACTICE_LOCATIONS.forEach(loc => {
        practiceSessions[d][loc] = existingPlayerSessions(all, { dateKey: d, name: null, practiceLocations: DEFAULT_PRACTICE_LOCATIONS })
          .filter(s => s.location === loc)
          .map(s => ({ player: s.player, court: s.court, start: s.start, slots: s.slots }))
      })
    })
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
            const action = data.action === 'bookGroup' ? 'book' : 'cancel'
            const validation = validateWrite(data, action, slots, names)

            if (data.action === 'bookGroup') {
              for (const slot of slots) {
                const startNorm = normalizeTimeMock(String(slot).split(/[–-]/)[0].trim())
                const cells = locateSlotCells(values, data.date, data.courtId, startNorm)
                if (!cells) return send({ success: false, version: SCRIPT_VERSION, error: 'Time slot not found: ' + slot })
                // Prevent duplicate booking of same player in same slot
                for (const name of names) {
                  if (cells.some(c => c.value === name)) {
                    return send({ success: false, version: SCRIPT_VERSION, error: `Slot ${slot} already booked by ${name} on Court ${data.courtId}` })
                  }
                }
                const emptyCells = cells.filter(c => !c.value)
                if (emptyCells.length < names.length) {
                  return send({ success: false, version: SCRIPT_VERSION, error: `Slot ${slot} on Court ${data.courtId} only has ${emptyCells.length} open spot(s) for ${names.length} player(s) (already ${cells.length - emptyCells.length}/${cells.length} booked)` })
                }
                if (cells.length < names.length) return send({ success: false, version: SCRIPT_VERSION, error: 'Not enough cells' })
                for (let i = 0; i < names.length; i++) {
                  values[emptyCells[i].row][emptyCells[i].col] = names[i]
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

          if (data.action === 'toggleReservation') {
            const name = String(data.name || '').trim()
            const slot = String(data.slot || '').trim()
            const startNorm = normalizeTimeMock(slot.split(/[–-]/)[0].trim())
            const cells = locateSlotCells(values, data.date, data.courtId, startNorm)
            if (!cells) return send({ success: false, version: SCRIPT_VERSION, error: 'Time slot not found: ' + slot })
            const isRemoval = cells.some(cell => cell.value === name)
            const action = isRemoval ? 'cancel' : 'book'
            validateWrite(data, action, [slot], [name])

            if (isRemoval) {
              const cell = cells.find(candidate => candidate.value === name)
              values[cell.row][cell.col] = ''
            } else {
              const cell = cells.find(candidate => !candidate.value)
              if (!cell) return send({ success: false, version: SCRIPT_VERSION, error: 'Slot full' })
              values[cell.row][cell.col] = name
            }
            return send({ success: true, version: SCRIPT_VERSION, action: 'toggleReservation', toggleAction: action })
          }

          return send({ success: false, version: SCRIPT_VERSION, error: 'Unknown POST action' })
        } catch (e) {
          return send({
            success: false,
            version: SCRIPT_VERSION,
            error: e.message || String(e),
            code: e.code || undefined,
            staffCodeRequired: Boolean(e.staffCodeRequired),
            warnings: e.warnings || undefined,
          }, e.status || 500)
        }
      })
    })
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock apps script (v${SCRIPT_VERSION}) listening on http://127.0.0.1:${PORT}/exec`)
})
