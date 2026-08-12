// sheets-grid-parser.js - Parse the actual Barnes/Peninsula/etc. grid layout
// Sheet layout: Date rows (e.g. "Sat Aug 8") -> Court header row -> Time rows (each slot = 2 physical rows)

export function parseGridValues(values, sheetName) {
  // values: 2D array from Sheets API (A1:ZZ)
  const reservations = {} // key: "Location|YYYY-MM-DD|Court" -> { "8:00 AM–8:30 AM": ["Name"] }
  const rosterSet = new Set()
  
  if (!values || values.length < 5) return { reservations, roster: [] }

  // Normalize location name: sheet "Barnes TC" -> "Barnes Tennis Center"
  const locationMap = {
    "Barnes TC": "Barnes Tennis Center",
    "Peninsula Tennis Club": "Peninsula Tennis Club",
    "Point Loma Nazarene College": "Point Loma Nazarene College",
    "Pacific Beach TC": "Pacific Beach Tennis Club",
    "Balboa Tennis": "Balboa Tennis Center",
    "USD": "USD"
  }
  const location = locationMap[sheetName] || sheetName

  let currentDate = null
  let courtColumns = {} // courtNumber -> column index
  let courtHeadersRow = -1

  for (let r = 0; r < values.length; r++) {
    const row = values[r]
    if (!row || row.every(c => !String(c||"").trim())) continue
    const first = String(row[0]||"").trim()

    // Detect date row: either Date object string or "Sat Aug 8" or "Mon Aug 10"
    // In API values, dates come as "2026-08-08" or "Sat Aug 8" depending on formatting
    // We check if row[0] looks like a date
    const maybeDate = parseSheetDate(row[0])
    if (maybeDate && !isTimeString(first)) {
      // Heuristic: date rows have no time and are alone or with empty courts
      // Count non-empty courts in next row to confirm it's a date section
      // If this row has a date and next row looks like court numbers, it's a date header
      currentDate = maybeDate
      // Look ahead for court numbers row
      for (let look = r+1; look < Math.min(r+4, values.length); look++) {
        const cand = values[look]
        if (!cand) continue
        const courts = extractCourtNumbers(cand)
        if (courts.length > 0) {
          courtHeadersRow = look
          courtColumns = {}
          // Map each court number to its column index
          // In sheet, courts are at B,D,F,... (every other col), but we just map where number appears
          cand.forEach((cell, idx) => {
            const n = parseInt(String(cell).trim())
            if (!isNaN(n) && n > 0) courtColumns[n] = idx
          })
          break
        }
        // Also handle "Court" label row: ["Court", 4, null, 5 ...]
        if (String(cand[0]).toLowerCase() === "court") {
          courtHeadersRow = look
          courtColumns = {}
          cand.forEach((cell, idx) => {
            if (idx===0) return
            const n = parseInt(String(cell).trim())
            if (!isNaN(n)) courtColumns[n] = idx
          })
          break
        }
      }
      continue
    }

    // Detect time row: first col like "8:00 AM" or "8:30 AM"
    if (isTimeString(first) && currentDate && Object.keys(courtColumns).length) {
      const timeLabel = normalizeTime(first) // "8:00 AM"
      // Next row is second half of slot (no time in col A)
      const secondRow = values[r+1] || []
      const isSecondRowTime = secondRow[0] && isTimeString(String(secondRow[0]))
      // If next row has a time, then this slot is only one row; otherwise second row belongs to this slot
      
      for (const [courtNum, colIdx] of Object.entries(courtColumns)) {
        const court = String(courtNum)
        // Slot label: app expects like "8:00 AM–8:30 AM" or "8:00 AM–9:00 AM"
        // For 60-min slots, app will check overlapping. We store both 30 and 60 variants
        const slot30 = `${timeLabel}–${addMinutes(timeLabel, 30)}`
        const slot60 = `${timeLabel}–${addMinutes(timeLabel, 60)}`
        
        // Collect names from this court/time: up to 2 rows, possibly 1 col or 2 cols per court?
        // In this sheet, each court occupies 1 column, but has 2 rows per slot
        const names = []
        // First row cell
        const cell1 = String(row[colIdx]||"").trim()
        if (cell1) {
          // Cell may contain "Last, First" or single name
          cell1.split(/[,;]\s*/).forEach(n => {
            // Actually names are "Last, First" as single entry; don't split on comma inside name
            // So treat whole cell as one name if it contains comma
            if (cell1.includes(",")) names.push(cell1)
            else if (cell1) names.push(cell1)
          })
          // Simpler: each cell is one player
          if (names.length===0 && cell1) names.push(cell1)
          // Remove duplicates from split logic
        }
        // Second row cell (if belongs to this slot)
        if (!isSecondRowTime) {
          const cell2 = String(secondRow[colIdx]||"").trim()
          if (cell2) names.push(cell2)
        }
        // Add to roster set
        names.forEach(n => rosterSet.add(n))
        
        if (names.length) {
          const key = `${location}|${currentDate}|${court}`
          if (!reservations[key]) reservations[key] = {}
          // Store under 30-min slot (app will check this)
          if (!reservations[key][slot30]) reservations[key][slot30] = []
          names.forEach(n => {
            if (!reservations[key][slot30].includes(n)) reservations[key][slot30].push(n)
          })
          // Also store under exact timeLabel for debugging
        }
      }
      // If we consumed second row, skip it
      if (!isSecondRowTime) {
        // second row already handled, but loop will still process it as non-time row (it will be skipped)
      }
    }
  }
  return { reservations, roster: [...rosterSet].filter(Boolean).sort() }
}

function parseSheetDate(cell) {
  if (cell == null || cell === "") return null
  // If it's already YYYY-MM-DD
  let s = String(cell).trim()
  // Try Date object serialization: "2026-08-10" or JS Date
  // If cell is a Date object, openpyxl gave datetime, Sheets API gives string or serial
  // Handle "Sat Aug 8" or "Mon Aug 10"
  const months = {jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"}
  const m = s.match(/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Za-z]+)\s+(\d{1,2})/i)
  if (m) {
    const mon = months[m[1].toLowerCase().slice(0,3)]
    const day = String(m[2]).padStart(2,"0")
    // Year: assume 2026 (from sheet data)
    return `2026-${mon}-${day}`
  }
  // Handle "2026-08-10" or "8/10/2026". A few copied cells
  // accidentally carry the hidden year 2001; they belong to this 2026 event.
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1] === "2001" ? "2026" : iso[1]}-${iso[2]}-${iso[3]}`
  const mdY = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (mdY) return `${mdY[3] === "2001" ? "2026" : mdY[3]}-${String(mdY[1]).padStart(2,"0")}-${String(mdY[2]).padStart(2,"0")}`
  // Try parsing as Date
  const d = new Date(s)
  if (!isNaN(d.getTime()) && s.length > 6 && d.getFullYear() > 2000) {
    if (d.getFullYear() === 2001) {
      return `2026-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
    }
    return d.toISOString().slice(0,10)
  }
  return null
}

function isTimeString(s) {
  return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(String(s).trim())
}
function normalizeTime(s) {
  let t = String(s).trim().toUpperCase()
  // Ensure space before AM/PM
  t = t.replace(/(\d)(AM|PM)/, "$1 $2")
  return t
}
function addMinutes(timeStr, mins) {
  const [time, ap] = timeStr.split(" ")
  let [h, m] = time.split(":").map(Number)
  if (ap === "PM" && h !== 12) h += 12
  if (ap === "AM" && h === 12) h = 0
  let total = h*60 + m + mins
  let nh = Math.floor(total/60) % 24
  let nm = total % 60
  let nap = nh >= 12 ? "PM" : "AM"
  let dh = nh % 12 === 0 ? 12 : nh % 12
  return `${dh}:${String(nm).padStart(2,"0")} ${nap}`
}
function extractCourtNumbers(row) {
  const nums = []
  row.forEach(cell => {
    const n = parseInt(String(cell||"").trim())
    if (!isNaN(n) && n >=1 && n <= 20) nums.push(n)
  })
  return nums
}
