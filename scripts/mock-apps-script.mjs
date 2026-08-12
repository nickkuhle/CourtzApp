// Local mock of the v2.0 Apps Script web app for integration testing.
// It mirrors the real test sheet's layout:
//   Barnes TC  - courts 4,5 on Aug 10/11; 4,5,6 from Aug 12 on (court 6 empty)
//   Peninsula  - courts 1..12
//   PLNU       - courts 1..6
//   Pacific Beach TC / Balboa / USD - Wednesday (Aug 12) reservations that the
//   old parser used to drop (names in the SECOND column of a court's span)
// The mock keeps an in-memory grid and applies bookGroup/cancelGroup writes.

import http from 'node:http'

const LOCATION_MAP = {
  'Barnes TC': 'Barnes Tennis Center',
  'Peninsula Tennis Club': 'Peninsula Tennis Club',
  'Point Loma Nazarene College': 'Point Loma Nazarene College',
  'Pacific Beach TC': 'Pacific Beach Tennis Club',
  'Balboa Tennis': 'Balboa Tennis Center',
  'USD': 'USD',
}

const tabs = Object.keys(LOCATION_MAP)

function emptyGrid(ncourts, width = 2) {
  // date row + header row + a few time rows (2 rows per slot)
  const grid = []
  const header = ['', ...Array.from({ length: ncourts }, (_, i) => (i % 2 === 0 ? i / 2 + 1 : ''))]
  const push = (cells) => grid.push(cells)
  push(['Mon Aug 10', '', '', '', '', '', '', '', '', ''])
  push(header)
  push(['8:00 AM', '', '', '', '', '', '', '', '', ''])
  push(['', '', '', '', '', '', '', '', '', ''])
  push(['8:30 AM', '', '', '', '', '', '', '', '', ''])
  push(['', '', '', '', '', '', '', '', '', ''])
  push(['9:00 AM', '', '', '', '', '', '', '', '', ''])
  push(['', '', '', '', '', '', '', '', '', ''])
  push(['Tue Aug 11', '', '', '', '', '', '', '', '', ''])
  push(header)
  push(['8:00 AM', '', '', '', '', '', '', '', '', ''])
  push(['', '', '', '', '', '', '', '', '', ''])
  push(['Wed Aug 12', '', '', '', '', '', '', '', '', ''])
  push(header)
  push(['8:00 AM', '', '', '', '', '', '', '', '', ''])
  push(['', '', '', '', '', '', '', '', '', ''])
  push(['8:30 AM', '', '', '', '', '', '', '', '', ''])
  push(['', '', '', '', '', '', '', '', '', ''])
  push(['Fri Aug 14', '', '', '', '', '', '', '', '', ''])
  push(header)
  push(['8:00 AM', '', '', '', '', '', '', '', '', ''])
  push(['', '', '', '', '', '', '', '', '', ''])
  return grid
}

// The real sheet's Wednesday reservations (they exist only in the tabs the old
// frontend never showed, and in the second column of the court's span).
const wednesdaySeed = {
  'Pacific Beach Tennis Club': { court: 1, names: ['Waters, Eadan', 'Chen, Alice'] },
  'Balboa Tennis Center': { court: 3, names: ['Reeves, Sam', 'Zhou, Zhongyi'] },
  'USD': { court: 2, names: ['Andreoli, Mia', 'Shi, Kelly'] },
}

const grids = {}
for (const tab of tabs) {
  const ncourts = tab === 'Barnes TC' ? 3 : tab === 'Peninsula Tennis Club' ? 12 : 6
  const grid = emptyGrid(ncourts, 2)
  const seed = wednesdaySeed[LOCATION_MAP[tab]]
  if (seed) {
    // find the Wed Aug 12 section and put names into the SECOND column of the
    // court's span (col index = (court-1)*2 + 2), 8:30 AM slot
    for (let r = 0; r < grid.length; r++) {
      if (String(grid[r][0]).includes('Wed Aug 12')) {
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
  let headerRow = -1
  for (let r = 0; r < values.length; r++) {
    const row = values[r]
    const first = String(row[0] || '').trim()
    const isDate = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3,9}\s+\d{1,2}/i.test(first)
    if (isDate) {
      const m = first.match(/([A-Za-z]{3,9})\s+(\d{1,2})/i)
      const month = String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase().slice(0,3)) + 1).padStart(2, '0')
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
      headerRow = r
      if (currentDate) {
        if (!courtsByDate[currentDate]) courtsByDate[currentDate] = {}
        courtsByDate[currentDate][location] = courts.map(c => c.court)
      }
      continue
    }
    const timeMatch = first.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i)
    if (timeMatch && currentDate && courts.length) {
      const timeLabel = normalizeTimeMock(first)
      const slot30 = `${timeLabel}–${addMinutesMock(timeLabel, 30)}`
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
      const month = String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase().slice(0,3)) + 1).padStart(2, '0')
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
  let headerRow = -1
  let cols = []
  for (let r = sectionStart + 1; r < sectionEnd; r++) {
    const nums = []
    values[r].forEach((c, i) => { if (i > 0 && /^\d{1,2}$/.test(String(c || '').trim())) nums.push({ n: Number(c), idx: i }) })
    if (nums.length && !String(values[r][0] || '').trim()) {
      headerRow = r
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
  for (let r = Math.max(sectionStart + 1, headerRow + 1); r < sectionEnd; r++) {
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (obj) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
  }

  if (req.method === 'GET' && url.searchParams.get('action') === 'getSchedule') {
    const all = {}
    const days = []
    const courtsByDate = {}
    for (const tab of tabs) {
      const p = parseGrid(grids[tab], tab)
      for (const [k, slots] of Object.entries(p.reservations)) {
        if (!all[k]) all[k] = {}
        for (const [slot, names] of Object.entries(slots)) {
          if (!all[k][slot]) all[k][slot] = []
          names.forEach(n => { if (!all[k][slot].includes(n)) all[k][slot].push(n) })
        }
      }
      p.dates.forEach(d => { if (!days.includes(d)) days.push(d) })
      for (const [d, locMap] of Object.entries(p.courtsByDate)) {
        if (!courtsByDate[d]) courtsByDate[d] = {}
        if (!courtsByDate[d][LOCATION_MAP[tab]]) courtsByDate[d][LOCATION_MAP[tab]] = locMap[LOCATION_MAP[tab]]
      }
    }
    return send({ success: true, version: '2.0', data: {
      roster: ['Abbey, Stephanie', 'Chen, Alice', 'Waters, Eadan', 'Reeves, Sam', 'Zhou, Zhongyi', 'Andreoli, Mia', 'Shi, Kelly'],
      reservations: all,
      days: [...new Set(days)].sort(),
      courtsByDate,
      locations: Object.values(LOCATION_MAP),
    } })
  }
  if (req.method === 'GET' && url.searchParams.get('action') === 'ping') {
    return send({ success: true, version: '2.0', tabs })
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
          const names = [...new Set(data.names.map(n => String(n).trim()).filter(Boolean))]
          const written = []
          for (const slot of data.slots) {
            const startNorm = normalizeTimeMock(String(slot).split(/[–-]/)[0].trim())
            const cells = locateSlotCells(values, data.date, data.courtId, startNorm)
            if (!cells) return send({ success: false, version: '2.0', error: 'Time slot not found: ' + slot })
            const filled = cells.filter(c => c.value)
            if (filled.length) return send({ success: false, version: '2.0', error: 'Slot already booked on ' + tab + ' ' + data.date + ' Court ' + data.courtId })
            if (cells.length < names.length) return send({ success: false, version: '2.0', error: 'Not enough cells' })
            for (let i = 0; i < names.length; i++) {
              values[cells[i].row][cells[i].col] = names[i]
              written.push(cells[i])
            }
          }
          return send({ success: true, version: '2.0', action: 'bookGroup' })
        }
        if (data.action === 'cancelGroup') {
          const names = new Set(data.names.map(n => String(n).trim()))
          let found = 0
          for (const slot of data.slots) {
            const startNorm = normalizeTimeMock(String(slot).split(/[–-]/)[0].trim())
            const cells = locateSlotCells(values, data.date, data.courtId, startNorm) || []
            for (const c of cells) {
              if (c.value && names.has(c.value)) { values[c.row][c.col] = ''; found++ }
            }
          }
          if (!found) return send({ success: false, version: '2.0', error: 'No booking found to cancel' })
          return send({ success: true, version: '2.0', action: 'cancelGroup' })
        }
        return send({ success: false, version: '2.0', error: 'Unknown POST action' })
      } catch (e) {
        return send({ success: false, version: '2.0', error: e.toString() })
      }
    })
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(3100, '127.0.0.1', () => {
  console.log('mock apps script listening on http://127.0.0.1:3100/exec')
})
