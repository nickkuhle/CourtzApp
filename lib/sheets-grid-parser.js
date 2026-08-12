// sheets-grid-parser.js - Parse the Barnes/Peninsula/PLNU/etc. grid layout.
//
// Verified layout of the tournament test sheet (per date section):
//   Row A: date row          e.g. "Mon Aug 10" (some copied cells hide year 2001)
//   Row B: court header row  e.g. ["", 4, "", 5, "", 6, "", ...]
//                            - each court may span MULTIPLE spreadsheet columns
//                              (merged cells: the number appears once, the next
//                              number marks the end of the span)
//   Rows C..: time rows      e.g. "8:00 AM" then a continuation row (blank col A)
//                            - every 30-minute slot uses 2 physical rows
//                            - EVERY non-empty cell inside a court's column span
//                              belongs to that court (that is where the old parser
//                              lost bookings - it only read the first column)
//
// The parser is deliberately tolerant so the remaining tabs (Pacific Beach TC,
// Balboa Tennis, USD) work too:
//   - dates: "Mon Aug 10", "Monday, August 12", "8/12/2026", "8/12", "2026-08-12",
//            Date objects, cells carrying hidden year 2001 -> 2026
//   - times: "8:00 AM", "8:00am", "8:00", "14:00", Date objects (year 1899)
//   - courts: bare numbers or "Court N" labels

export const LOCATION_MAP = {
  'Barnes TC': 'Barnes Tennis Center',
  'Peninsula Tennis Club': 'Peninsula Tennis Club',
  'Point Loma Nazarene College': 'Point Loma Nazarene College',
  'Pacific Beach TC': 'Pacific Beach Tennis Club',
  'Balboa Tennis': 'Balboa Tennis Center',
  'USD': 'USD',
}

export const COURT_TABS = Object.keys(LOCATION_MAP)

export function sheetNameToLocation(sheetName) {
  return LOCATION_MAP[sheetName] || sheetName
}

// --- Time helpers -----------------------------------------------------------

export function isTimeString(s) {
  if (s == null || s === '') return false
  if (s instanceof Date && !isNaN(s)) return s.getFullYear() === 1899
  const t = String(s).trim()
  if (!t) return false
  // "8:00 AM" / "8:00am" / "8:00" / "14:00"
  if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(t)) return true
  return false
}

export function normalizeTime(s) {
  if (s instanceof Date && !isNaN(s) && s.getFullYear() === 1899) {
    let h = s.getHours()
    let m = s.getMinutes()
    let ap = h >= 12 ? 'PM' : 'AM'
    let dh = h % 12 === 0 ? 12 : h % 12
    return `${dh}:${String(m).padStart(2, '0')} ${ap}`
  }
  let t = String(s).trim().toUpperCase()
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    // No AM/PM: 24-hour style (14:00) or 12-hour style (8:00 -> 8:00 AM)
    let [h, m] = t.split(':').map(Number)
    const ap = h >= 12 ? 'PM' : 'AM'
    let dh = h % 12 === 0 ? 12 : h % 12
    return `${dh}:${String(m).padStart(2, '0')} ${ap}`
  }
  t = t.replace(/(\d)(AM|PM)/, '$1 $2')
  return t
}

export function timeToMinutes(timeStr) {
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
  if (!m) return NaN
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ap = (m[3] || '').toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}

export function addMinutes(timeStr, mins) {
  const base = timeToMinutes(timeStr)
  if (isNaN(base)) return timeStr
  const total = base + mins
  let nh = Math.floor(total / 60) % 24
  const nm = total % 60
  const nap = nh >= 12 ? 'PM' : 'AM'
  const dh = nh % 12 === 0 ? 12 : nh % 12
  return `${dh}:${String(nm).padStart(2, '0')} ${nap}`
}

export function minutesToTimeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}

export function slotStartLabel(slot) {
  return String(slot).split(/[–\-]/)[0].trim()
}

// --- Date helpers -----------------------------------------------------------

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
const DEFAULT_TOURNAMENT_YEAR = '2026'

export function parseSheetDate(cell) {
  if (cell == null || cell === '') return null
  if (cell instanceof Date && !isNaN(cell)) {
    if (cell.getFullYear() === 1899) return null // time value
    if (cell.getFullYear() === 2001) {
      return `${DEFAULT_TOURNAMENT_YEAR}-${String(cell.getMonth() + 1).padStart(2, '0')}-${String(cell.getDate()).padStart(2, '0')}`
    }
    return `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, '0')}-${String(cell.getDate()).padStart(2, '0')}`
  }
  const s = String(cell).trim()
  if (!s) return null

  // "2026-08-12" (ISO) - checked first so it is never seen as "01-08-13"
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${normYear(m[1])}-${m[2]}-${m[3]}`

  // "Mon Aug 10" / "Monday, August 10" / "Wed Aug 12, 2026"
  m = s.match(/(?:[A-Za-z]{3,9})[\s,/]+([A-Za-z]{3,9})[\s,/]+(\d{1,2})(?:[\s,/]+(\d{2,4}))?/i)
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)]
    if (!mon) {
      // maybe "August 12" without weekday - month is in first group
      const mon2 = MONTHS[m[0].toLowerCase().slice(0, 3)]
      if (mon2) {
        const day = String(m[2]).padStart(2, '0')
        const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR
        return `${year}-${mon2}-${day}`
      }
      return null
    }
    const day = String(m[2]).padStart(2, '0')
    const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR
    return `${year}-${mon}-${day}`
  }
  // "August 12" / "Aug 12" / "August 12, 2026"
  m = s.match(/([A-Za-z]{3,9})[\s,/]+(\d{1,2})(?:[\s,/]+(\d{2,4}))?/)
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)]
    if (mon) {
      const day = String(m[2]).padStart(2, '0')
      const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR
      return `${year}-${mon}-${day}`
    }
  }
  // "Wed 8/12" / "8/12" / "8/12/2026" / "8/12/26" (never a substring of "2001-08-13")
  m = s.match(/(?:^|[^\d])(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?=$|[^\d])/)
  if (m) {
    const mon = String(m[1]).padStart(2, '0')
    const day = String(m[2]).padStart(2, '0')
    const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR
    if (mon <= 12 && day <= 31) return `${year}-${mon}-${day}`
  }
  return null
}

function normYear(y) {
  const n = parseInt(y, 10)
  if (n === 2001) return DEFAULT_TOURNAMENT_YEAR // copied cells carry hidden year 2001
  if (n >= 100) return String(n)
  return '20' + String(n).padStart(2, '0')
}

// --- Court header helpers ---------------------------------------------------

// Returns [{n, idx}] for every numeric / "Court N" cell in a row (col 0 excluded).
export function detectCourtNumbers(row) {
  const out = []
  if (!row) return out
  row.forEach((cell, idx) => {
    if (idx === 0) return
    const s = String(cell == null ? '' : cell).trim()
    if (!s) return
    let n = null
    if (/^\d{1,2}$/.test(s)) n = parseInt(s, 10)
    else if (/^court\s*#?\s*\d{1,2}$/i.test(s)) n = parseInt(s.match(/\d+/)[0], 10)
    if (n != null && n >= 1 && n <= 50) out.push({ n, idx })
  })
  return out
}

// A row is a court header when it contains court numbers and its first cell is
// empty, "Court", or a date (a few sheets put the date and courts on one row).
export function isCourtHeaderRow(row) {
  const nums = detectCourtNumbers(row)
  if (!nums.length) return false
  const first = String(row && row[0] != null ? row[0] : '').trim().toLowerCase()
  if (!first) return true
  if (first === 'court' || first === 'courts') return true
  if (parseSheetDate(row[0])) return true
  return false
}

// Given the detected court entries of one header row, work out the column span
// of every court. Spans run from a court's own column up to the next court's
// column minus one. The last court is assumed to be as wide as the most common
// span (ties favour the wider guess - reading an extra empty column is harmless,
// while reading too few columns would drop bookings).
export function computeCourtSpans(nums) {
  if (!nums || !nums.length) return []
  const widths = []
  for (let i = 0; i < nums.length - 1; i++) widths.push(nums[i + 1].idx - nums[i].idx)
  let standard = 1
  if (widths.length) {
    const counts = {}
    widths.forEach((w) => { counts[w] = (counts[w] || 0) + 1 })
    const best = Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1] // most frequent first
      return b[0] - a[0] // wider wins ties
    })[0]
    standard = Math.max(1, parseInt(best[0], 10))
  }
  return nums.map((entry, i) => {
    const start = entry.idx
    let end
    if (i + 1 < nums.length) {
      end = nums[i + 1].idx - 1
    } else {
      end = start + standard - 1
    }
    if (end < start) end = start
    const cols = []
    for (let c = start; c <= end; c++) cols.push(c)
    return { court: entry.n, cols }
  })
}

function cellText(cell) {
  if (cell == null) return ''
  if (cell instanceof Date && !isNaN(cell)) return String(cell)
  return String(cell).trim()
}

// --- Main parser ------------------------------------------------------------

// Parses one tab's grid. Returns:
//   {
//     reservations: { "Location|YYYY-MM-DD|Court": { "8:00 AM–8:30 AM": ["Name", ...] } },
//     dates: ["YYYY-MM-DD", ...]  (every date row found, in sheet order),
//     courtsByDate: { "YYYY-MM-DD": { "Location": [court, ...] } },
//     sections: [ { date, row, courts: [{court, cols}] } ]  (for write lookups)
//   }
export function parseGridValues(values, sheetName) {
  const reservations = {}
  const location = sheetNameToLocation(sheetName)
  const sections = []
  let current = null // { date, row, headerRow, courts }
  let pendingHeader = null // { nums, row }
  const datesSeen = new Set()

  const ensureSection = (date, row) => {
    if (!current || current.date !== date) {
      current = { date, row, headerRow: -1, courts: pendingHeader ? computeCourtSpans(pendingHeader.nums) : [] }
      if (pendingHeader) { current.headerRow = pendingHeader.row; pendingHeader = null }
      sections.push(current)
      if (!datesSeen.has(date)) datesSeen.add(date)
    }
    return current
  }

  for (let r = 0; r < values.length; r++) {
    const row = values[r]
    if (!row) continue
    const firstRaw = row[0]
    const hasContent = row.some((c) => cellText(c) !== '')
    if (!hasContent) continue

    const date = parseSheetDate(firstRaw)
    const firstIsTime = isTimeString(firstRaw)

    if (date && !firstIsTime) {
      ensureSection(date, r)
      // Some layouts put the court numbers on the same row as the date.
      const inlineNums = detectCourtNumbers(row)
      if (inlineNums.length) {
        current.courts = computeCourtSpans(inlineNums)
        current.headerRow = r
      }
      continue
    }

    if (isCourtHeaderRow(row)) {
      const nums = detectCourtNumbers(row)
      if (current) {
        current.courts = computeCourtSpans(nums)
        current.headerRow = r
      } else {
        pendingHeader = { nums, row: r }
      }
      continue
    }

    if (firstIsTime && current && current.courts.length) {
      const timeLabel = normalizeTime(firstRaw)
      const slot30 = `${timeLabel}–${addMinutes(timeLabel, 30)}`
      const secondRow = values[r + 1]
      const secondRowIsTime = secondRow && isTimeString(secondRow[0])
      const secondRowIsDate = secondRow && parseSheetDate(secondRow[0]) && !isTimeString(secondRow[0])
      const twoRowSlot = secondRow && !secondRowIsTime && !secondRowIsDate

      for (const c of current.courts) {
        const names = []
        for (const col of c.cols) {
          const v = cellText(row[col])
          if (v) pushName(names, v)
        }
        if (twoRowSlot) {
          for (const col of c.cols) {
            const v = cellText(secondRow[col])
            if (v) pushName(names, v)
          }
        }
        if (names.length) {
          const key = `${location}|${current.date}|${c.court}`
          if (!reservations[key]) reservations[key] = {}
          if (!reservations[key][slot30]) reservations[key][slot30] = []
          names.forEach((n) => {
            if (!reservations[key][slot30].includes(n)) reservations[key][slot30].push(n)
          })
        }
      }
    }
  }

  // courtsByDate: preserve header order; only include dates that actually had a
  // court header (empty dates still get their courts from the header row).
  const courtsByDate = {}
  for (const sec of sections) {
    if (!sec.courts.length) continue
    if (!courtsByDate[sec.date]) courtsByDate[sec.date] = {}
    courtsByDate[sec.date][location] = sec.courts.map((c) => c.court)
  }

  return { reservations, dates: [...datesSeen], courtsByDate, sections }
}

function pushName(list, raw) {
  // One cell = one player. If someone pasted several names into one cell with
  // newlines, split on newlines only (commas belong inside "Last, First").
  const parts = String(raw).split(/\r?\n/).map((p) => p.trim()).filter(Boolean)
  parts.forEach((p) => { if (!list.includes(p)) list.push(p) })
}

// --- Write helpers (used by the service-account path) -----------------------

export function colToLetter(col) {
  let s = ''
  while (col > 0) {
    const m = (col - 1) % 26
    s = String.fromCharCode(65 + m) + s
    col = Math.floor((col - 1) / 26)
  }
  return s
}

// Locates the spreadsheet cells that belong to one court's 30-minute slot.
// Returns { rows: [r, r+1?], cols: [...], cells: [{row, col, value}] }
// or null when the date/court/time cannot be found.
export function findSlotCells(values, date, courtId, slotStart) {
  const targetDate = String(date)
  const startNorm = normalizeTime(slotStart)
  const sections = parseGridValues(values, '').sections
  const sec = sections.find((s) => s.date === targetDate)
  if (!sec) return null
  const court = sec.courts.find((c) => String(c.court) === String(courtId))
  if (!court) return null

  // Find the time row inside this date section.
  const nextDateRow = sections.find((s) => s.date !== targetDate && s.row > sec.row)
  const sectionEnd = nextDateRow ? nextDateRow.row : values.length
  let timeRow = -1
  for (let r = Math.max(sec.row + 1, 0); r < sectionEnd; r++) {
    if (isTimeString(values[r][0]) && normalizeTime(values[r][0]) === startNorm) { timeRow = r; break }
  }
  if (timeRow === -1) return null

  const rows = [timeRow]
  const next = values[timeRow + 1]
  const nextIsTime = next && isTimeString(next[0])
  const nextIsDate = next && parseSheetDate(next[0]) && !isTimeString(next[0])
  if (next && !nextIsTime && !nextIsDate) rows.push(timeRow + 1)

  const cells = []
  for (const rr of rows) {
    for (const col of court.cols) {
      cells.push({ row: rr, col, value: values[rr] ? cellText(values[rr][col]) : '' })
    }
  }
  return { rows, cols: court.cols, cells }
}

// All cell addresses (A1 notation) belonging to a court for a list of slots.
export function findSlotCellRanges(values, date, courtId, slots) {
  const out = []
  for (const slot of slots) {
    const start = slotStartLabel(slot)
    const found = findSlotCells(values, date, courtId, start)
    if (!found) return null
    for (const c of found.cells) {
      out.push({
        row: c.row + 1, // 1-based for A1
        col: c.col,
        a1: `${colToLetter(c.col + 1)}${c.row + 1}`,
        value: c.value,
      })
    }
  }
  return out
}

export default parseGridValues
