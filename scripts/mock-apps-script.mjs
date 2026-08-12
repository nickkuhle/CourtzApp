// Local mock of the v2.1 Apps Script web app for integration testing.
// It mirrors the real test sheet's layout and the v2.1 rules:
//   - grid tabs with multi-column court spans (each court = 2 columns)
//   - Barnes TC courts 4,5,6 / Peninsula 1..12 / other tabs 1..6
//   - dates generated around today in America/Los_Angeles (so the booking
//     window can be exercised against the real clock)
//   - booking window enforcement (today/tomorrow only, ended slots locked)
//   - session limit (max 2/player/day) + staff-approval proximity warnings,
//     rechecked against the in-memory grid exactly like the Apps Script does
// The mock keeps an in-memory grid and applies bookGroup/cancelGroup writes.
//
// Usable two ways:
//   npm run mock:sheets            -> starts the server on port 3100
//   import { startMock, stopMock } -> starts/stops it from a test

import http from 'node:http'

const LOCATION_MAP = {
  'Barnes TC': 'Barnes Tennis Center',
  'Peninsula Tennis Club': 'Peninsula Tennis Club',
  'Point Loma Nazarene College': 'Point Loma Nazarene College',
  'Pacific Beach TC': 'Pacific Beach Tennis Club',
  'Balboa Tennis': 'Balboa Tennis Center',
  'USD': 'USD',
}
const PRACTICE_DEFAULT_LOCATIONS = ['Barnes Tennis Center', 'Peninsula Tennis Club', 'Point Loma Nazarene College']

const tabs = Object.keys(LOCATION_MAP)

// --- America/Los_Angeles helpers (mirror lib/booking-window.js) ------------
function getLAOffsetMinutes(utcDate) {
  const year = utcDate.getUTCFullYear()
  const marchFirst = new Date(Date.UTC(year, 2, 1))
  const firstSundayMarchDay = 1 + ((7 - marchFirst.getUTCDay()) % 7)
  const dstStartUtc = Date.UTC(year, 2, firstSundayMarchDay + 7, 10)
  const novemberFirst = new Date(Date.UTC(year, 10, 1))
  const firstSundayNovDay = 1 + ((7 - novemberFirst.getUTCDay()) % 7)
  const dstEndUtc = Date.UTC(year, 10, firstSundayNovDay, 9)
  const t = utcDate.getTime()
  return t >= dstStartUtc && t < dstEndUtc ? -7 * 60 : -8 * 60
}

function getLAParts(date) {
  const offsetMinutes = getLAOffsetMinutes(date)
  const shifted = new Date(date.getTime() + offsetMinutes * 60000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  }
}

function laDateKeyOffsetDays(offsetDays) {
  const p = getLAParts(new Date())
  const noon = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays, 12))
  const t = getLAParts(noon)
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

function laMinutesNow() {
  const p = getLAParts(new Date())
  return p.hours * 60 + p.minutes
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dateKeyToLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dayOfWeek = getLAParts(new Date(Date.UTC(y, m - 1, d, 12))).dayOfWeek
  return `${WEEKDAYS[dayOfWeek]} ${MONTHS[m - 1]} ${d}`
}

function dateKeyToWeekday(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return getLAParts(new Date(Date.UTC(y, m - 1, d, 12))).dayOfWeek
}

function formatTimeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}

// --- Grid generation -------------------------------------------------------
// Dates: today-2 ... today+2 (LA), full day of 30-minute slots 8:00-18:00.
// Each court spans 2 columns (merged header cells): [4, '', 5, '', 6, ''].
function buildDateKeys() {
  const keys = []
  for (let offset = -2; offset <= 2; offset++) keys.push(laDateKeyOffsetDays(offset))
  return keys
}

const DATE_KEYS = buildDateKeys()
const LABEL_TO_KEY = Object.fromEntries(DATE_KEYS.map((k) => [dateKeyToLabel(k), k]))

function buildGrid(ncourts, firstCourt = 1) {
  const width = 2
  const grid = []
  const header = ['', ...Array.from({ length: ncourts * width }, (_, i) => (i % 2 === 0 ? i / 2 + firstCourt : ''))]
  for (const dateKey of DATE_KEYS) {
    grid.push([dateKeyToLabel(dateKey), ...Array.from({ length: ncourts * width }, () => '')])
    grid.push([...header])
    for (let t = 8 * 60; t < 18 * 60; t += 30) {
      grid.push([formatTimeLabel(t), ...Array.from({ length: ncourts * width }, () => '')])
      grid.push(['', ...Array.from({ length: ncourts * width }, () => '')])
    }
  }
  return grid
}

// The real sheet's hidden-site reservations exist only in the second column of
// a court's span; keep that coverage by seeding names into the second column
// on the first Wednesday-ish date available (fallback: the last date).
const wednesdaySeed = {
  'Pacific Beach Tennis Club': { court: 1, names: ['Waters, Eadan', 'Chen, Alice'] },
  'Balboa Tennis Center': { court: 3, names: ['Reeves, Sam', 'Zhou, Zhongyi'] },
  'USD': { court: 2, names: ['Andreoli, Mia', 'Shi, Kelly'] },
}

const grids = {}
for (const tab of tabs) {
  const ncourts = tab === 'Barnes TC' ? 3 : tab === 'Peninsula Tennis Club' ? 12 : 6
  const grid = buildGrid(ncourts, tab === 'Barnes TC' ? 4 : 1)
  const seed = wednesdaySeed[LOCATION_MAP[tab]]
  if (seed) {
    let targetDate = DATE_KEYS.find((k) => dateKeyToWeekday(k) === 3) || DATE_KEYS[DATE_KEYS.length - 1]
    for (let r = 0; r < grid.length; r++) {
      if (String(grid[r][0]).includes(dateKeyToLabel(targetDate))) {
        for (let rr = r + 1; rr < grid.length; rr++) {
          if (/^8:30 AM$/.test(String(grid[rr][0] || ''))) {
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

// --- Span-aware parser mirroring the Apps Script behaviour -----------------
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
    const isDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3,9}\s+\d{1,2}$/i.test(first)
    if (isDate && LABEL_TO_KEY[first]) {
      currentDate = LABEL_TO_KEY[first]
      if (!dates.includes(currentDate)) dates.push(currentDate)
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
        courtsByDate[currentDate][location] = courts.map((c) => c.court)
      }
      continue
    }
    const timeMatch = first.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i)
    if (timeMatch && currentDate && courts.length) {
      const timeLabel = normalizeTimeMock(first)
      const slot30 = `${timeLabel}–${addMinutesMock(timeLabel, 30)}`
      const secondRow = values[r + 1]
      const isSecondTime = /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(String((secondRow && secondRow[0]) || '').trim())
      for (const c of courts) {
        const names = []
        for (const col of c.cols) {
          const v = String(row[col] || '').trim()
          if (v) names.push(v)
        }
        if (!isSecondTime) {
          for (const col of c.cols) {
            const v = String((secondRow && secondRow[col]) || '').trim()
            if (v) names.push(v)
          }
        }
        if (names.length) {
          const key = `${location}|${currentDate}|${c.court}`
          if (!reservations[key]) reservations[key] = {}
          if (!reservations[key][slot30]) reservations[key][slot30] = []
          names.forEach((n) => { if (!reservations[key][slot30].includes(n)) reservations[key][slot30].push(n) })
        }
      }
    }
  }
  return { reservations, dates: [...new Set(dates)], courtsByDate }
}

function normalizeTimeMock(s) {
  return String(s).trim().replace(/(\d)(AM|PM)/i, '$1 $2').toUpperCase()
}

function timeToMinutesMock(timeStr) {
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
  if (!m) return NaN
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = (m[3] || '').toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}

function addMinutesMock(timeStr, mins) {
  const base = timeToMinutesMock(timeStr)
  if (isNaN(base)) return timeStr
  const total = base + mins
  let nh = Math.floor(total / 60) % 24
  const nm = total % 60
  const ap = nh >= 12 ? 'PM' : 'AM'
  const dh = nh % 12 === 0 ? 12 : nh % 12
  return `${dh}:${String(nm).padStart(2, '0')} ${ap}`
}

function slotParts(slot) {
  const parts = String(slot).split(/[–\-]/)
  return { start: timeToMinutesMock(parts[0]), end: timeToMinutesMock(parts[1] || '') }
}

function locationToTab(location) {
  for (const [tab, name] of Object.entries(LOCATION_MAP)) {
    if (name === location) return tab
  }
  return location
}

function locateSlotCells(values, date, courtId, startNorm) {
  let sectionStart = -1
  for (let r = 0; r < values.length; r++) {
    const first = String(values[r][0] || '').trim()
    if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3,9}\s+\d{1,2}$/i.test(first) && LABEL_TO_KEY[first] === date) {
      sectionStart = r
      break
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
  const court = cols.find((c) => String(c.court) === String(courtId))
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

// --- v2.1 rule rechecks (mirror CourtzAppsScript.gs) ------------------------
function allReservations() {
  const all = {}
  for (const tab of tabs) {
    const p = parseGrid(grids[tab], tab)
    for (const [k, slots] of Object.entries(p.reservations)) {
      if (!all[k]) all[k] = {}
      for (const [slot, names] of Object.entries(slots)) {
        if (!all[k][slot]) all[k][slot] = []
        names.forEach((n) => { if (!all[k][slot].includes(n)) all[k][slot].push(n) })
      }
    }
  }
  return all
}

function validateWindow(date, slots) {
  const today = laDateKeyOffsetDays(0)
  const tomorrow = laDateKeyOffsetDays(1)
  if (date !== today && date !== tomorrow) {
    throw new Error(`This day is view only. Reservations can only be booked or changed for ${today} or ${tomorrow} (America/Los_Angeles).`)
  }
  const nowMinutes = laMinutesNow()
  const completed = []
  for (const slot of slots) {
    const { end } = slotParts(slot)
    if (isNaN(end)) throw new Error(`Invalid time slot: ${slot}`)
    if (date === today && nowMinutes >= end) completed.push(slot)
  }
  if (completed.length) {
    throw new Error(`These times have already ended: ${completed.join(', ')}. Ended time slots cannot be booked or canceled; the current 30-minute slot stays available until it ends.`)
  }
}

function groupPartsIntoSessions(parts) {
  const byCourt = {}
  for (const p of parts) {
    const k = `${p.location}|${p.court}`
    if (!byCourt[k]) byCourt[k] = []
    byCourt[k].push(p)
  }
  const sessions = []
  for (const key of Object.keys(byCourt)) {
    const sorted = byCourt[key].sort((a, b) => a.start - b.start || a.end - b.end)
    // Barnes never merges consecutive slots: every 30-minute reservation there
    // is one session of its own.
    const isBarnes = sorted.length > 0 && /barnes/i.test(String(sorted[0].location || ''))
    let current = null
    for (const p of sorted) {
      if (current && !isBarnes && current.parts.length < 2 && current.end === p.start) {
        current.parts.push(p)
        current.end = p.end
      } else {
        current = { start: p.start, end: p.end, parts: [p], location: p.location, court: p.court }
        sessions.push(current)
      }
    }
  }
  return sessions
}

function sessionsClose(a, b) {
  if (Math.abs(a.start - b.start) < 60) return true
  if (a.start === b.end || a.end === b.start) return true
  return false
}

function validateSessions(data) {
  const names = [...new Set((data.names || []).map((n) => String(n).trim()).filter(Boolean))]
  const slots = data.slots || []
  if (!names.length || !slots.length) return

  const active = [...PRACTICE_DEFAULT_LOCATIONS, ...(data.activeLocations || []), data.location]
  const reservations = allReservations()
  const proposedParts = slots
    .map((s) => slotParts(s))
    .map((p) => ({ ...p, location: data.location, court: String(data.courtId) }))

  const overLimit = []
  const warnings = []
  for (const name of names) {
    const existingParts = []
    for (const [key, slotsMap] of Object.entries(reservations)) {
      const [location, d, court] = key.split('|')
      if (!active.includes(location) || d !== data.date) continue
      for (const [slotLabel, players] of Object.entries(slotsMap)) {
        if (!players.includes(name)) continue
        const p = slotParts(slotLabel)
        existingParts.push({ ...p, location, court })
      }
    }
    const combined = groupPartsIntoSessions([...existingParts, ...proposedParts])
    if (combined.length > 2) overLimit.push(name)
    const existingSessions = groupPartsIntoSessions(existingParts)
    const proposedSessions = groupPartsIntoSessions(proposedParts)
    const seen = []
    for (const proposed of proposedSessions) {
      for (const existing of existingSessions) {
        if (sessionsClose(proposed, existing)) warnings.push({ player: name })
      }
      for (const other of seen) {
        if (sessionsClose(proposed, other)) warnings.push({ player: name })
      }
      seen.push(proposed)
    }
  }
  if (overLimit.length) {
    throw new Error(`${overLimit.join(', ')} already ${overLimit.length === 1 ? 'has' : 'have'} reached the maximum of 2 practice sessions for ${data.date}. The limit cannot be bypassed.`)
  }
  if (warnings.length && data.staffApproved !== true) {
    const who = [...new Set(warnings.map((w) => w.player))]
    throw new Error(`STAFF_APPROVAL_REQUIRED: Tournament staff approval is required for ${who.join(', ')}. This booking places a practice session back-to-back with another session, or its start time is within one hour of another session's start time. Continue only if tournament staff have approved it.`)
  }
}

// --- HTTP server -------------------------------------------------------------
export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }

  if (req.method === 'GET' && url.searchParams.get('action') === 'getSchedule') {
    const all = allReservations()
    const days = []
    const courtsByDate = {}
    for (const tab of tabs) {
      const p = parseGrid(grids[tab], tab)
      p.dates.forEach((d) => { if (!days.includes(d)) days.push(d) })
      for (const [d, locMap] of Object.entries(p.courtsByDate)) {
        if (!courtsByDate[d]) courtsByDate[d] = {}
        if (!courtsByDate[d][LOCATION_MAP[tab]]) courtsByDate[d][LOCATION_MAP[tab]] = locMap[LOCATION_MAP[tab]]
      }
    }
    return send({
      success: true,
      version: '2.1',
      data: {
        roster: ['Abbey, Stephanie', 'Chen, Alice', 'Waters, Eadan', 'Reeves, Sam', 'Zhou, Zhongyi', 'Andreoli, Mia', 'Shi, Kelly'],
        reservations: all,
        days: [...new Set(days)].sort(),
        courtsByDate,
        locations: Object.values(LOCATION_MAP),
      },
    })
  }
  if (req.method === 'GET' && url.searchParams.get('action') === 'ping') {
    return send({ success: true, version: '2.1', tabs })
  }

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const tab = locationToTab(data.location)
        const values = grids[tab]
        if (data.action === 'bookGroup') {
          const names = [...new Set((data.names || []).map((n) => String(n).trim()).filter(Boolean))]
          try {
            validateWindow(data.date, data.slots || [])
            validateSessions(data)
          } catch (e) {
            return send({ success: false, version: '2.1', error: e.toString() })
          }
          for (const slot of data.slots) {
            const startNorm = normalizeTimeMock(String(slot).split(/[–-]/)[0].trim())
            const cells = locateSlotCells(values, data.date, data.courtId, startNorm)
            if (!cells) return send({ success: false, version: '2.1', error: `Time slot not found: ${slot}` })
            const filled = cells.filter((c) => c.value)
            if (filled.length) return send({ success: false, version: '2.1', error: `Slot already booked on ${tab} ${data.date} Court ${data.courtId}` })
            if (cells.length < names.length) return send({ success: false, version: '2.1', error: 'Not enough cells' })
            for (let i = 0; i < names.length; i++) {
              values[cells[i].row][cells[i].col] = names[i]
            }
          }
          return send({ success: true, version: '2.1', action: 'bookGroup' })
        }
        if (data.action === 'cancelGroup') {
          const names = new Set((data.names || []).map((n) => String(n).trim()))
          try {
            validateWindow(data.date, data.slots || [])
          } catch (e) {
            return send({ success: false, version: '2.1', error: e.toString() })
          }
          let found = 0
          for (const slot of data.slots) {
            const startNorm = normalizeTimeMock(String(slot).split(/[–-]/)[0].trim())
            const cells = locateSlotCells(values, data.date, data.courtId, startNorm) || []
            for (const c of cells) {
              if (c.value && names.has(c.value)) { values[c.row][c.col] = ''; found++ }
            }
          }
          if (!found) return send({ success: false, version: '2.1', error: 'No booking found to cancel' })
          return send({ success: true, version: '2.1', action: 'cancelGroup' })
        }
        return send({ success: false, version: '2.1', error: 'Unknown POST action' })
      } catch (e) {
        return send({ success: false, version: '2.1', error: e.toString() })
      }
    })
    return
  }

  res.writeHead(404)
  res.end('not found')
})

export function startMock(port = 3100) {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`mock apps script listening on http://127.0.0.1:${port}/exec`)
      resolve(server)
    })
  })
}

export function stopMock() {
  return new Promise((resolve) => server.close(resolve))
}

// Run directly: npm run mock:sheets
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startMock()
}
