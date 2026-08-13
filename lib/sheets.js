// lib/sheets.js - Google Sheets adapter for Courtz App
// Supports: 1) Apps Script Web App (recommended) 2) Service Account 3) Local development fallback
//
// The Apps Script returns a full "schedule": reservations plus every date and
// every court found in the court-location tabs (empty dates/courts included).
// When talking to an older deployment that only returns reservations, the dates
// and courts are derived from the reservation keys instead.

import { parseGridValues, findSlotCellRanges, COURT_TABS } from './sheets-grid-parser.js'
import { laNow, addDaysToDateKey } from './booking-rules.js'

const SHEET_ID = process.env.GOOGLE_SHEETS_ID || "1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je"

// This is the Apps Script URL for the TEST COPY of the tournament sheet.
// Keeping it as the server-side default means the app is connected immediately
// after deployment. SHEETS_WEBAPP_URL can still override it when it is time to
// point Courtz at the real tournament sheet.
const DEFAULT_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzlHIg__YqQdq9ohWvFdu9wCZZ27S5XPTYeBCV3y9IdDx1AZmZjs7vaV3rcZVz2lFaW6g/exec"
const WEBAPP_URL = process.env.SHEETS_WEBAPP_URL === undefined
  ? DEFAULT_WEBAPP_URL
  : process.env.SHEETS_WEBAPP_URL.trim()

async function fetchFromWebApp(action, postData) {
  if (!WEBAPP_URL) return null
  const separator = WEBAPP_URL.indexOf("?") === -1 ? "?" : "&"
  // A timestamp prevents Google or a hosting layer from handing back an older
  // schedule after someone edited the sheet directly.
  const url = postData
    ? WEBAPP_URL
    : `${WEBAPP_URL}${separator}action=${encodeURIComponent(action)}&_=${Date.now()}`
  const opts = postData
    ? {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8", Accept: "application/json" },
        body: JSON.stringify(postData),
        cache: "no-store",
      }
    : { headers: { Accept: "application/json" }, cache: "no-store" }
  const res = await fetch(url, opts)
  // A misconfigured deployment (or one not shared with "Anyone") redirects to a
  // Google login/error page. res.json() would fail with an opaque message, so
  // detect non-JSON here and explain the likely cause instead.
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Sheets WebApp returned non-JSON (HTTP ${res.status}). The Apps Script URL is wrong or the web app is not deployed with access "Anyone".`)
  }
  if (!res.ok || !json.success) {
    const error = new Error(json.error || `Sheets WebApp error (HTTP ${res.status})`)
    error.code = json.code || null
    throw error
  }
  return json
}

let sheetsClient = null
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) return null
  const { google } = await import('googleapis')
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  sheetsClient = google.sheets({ version: 'v4', auth })
  return sheetsClient
}

function mergeReservations(a, b) {
  const out = { ...a }
  for (const [k, slots] of Object.entries(b)) {
    if (!out[k]) out[k] = {}
    for (const [slot, names] of Object.entries(slots)) {
      if (!out[k][slot]) out[k][slot] = []
      names.forEach(n => { if (!out[k][slot].includes(n)) out[k][slot].push(n) })
    }
  }
  return out
}

const SCHEDULE_CACHE_TTL_MS = 15_000
let scheduleCache = null
let scheduleCacheExpiresAt = 0
let scheduleLoadInFlight = null

function cacheSchedule(schedule) {
  scheduleCache = schedule
  scheduleCacheExpiresAt = Date.now() + SCHEDULE_CACHE_TTL_MS
  return schedule
}

function invalidateScheduleCache() {
  scheduleCache = null
  scheduleCacheExpiresAt = 0
}

// Locations fall back to the ones visible in the data, then to the three venues
// the app has always known about (pre-v2.0 deployments only report data for
// Barnes, Peninsula and PLNU).
const FALLBACK_LOCATIONS = ['Barnes Tennis Center', 'Peninsula Tennis Club', 'Point Loma Nazarene College']

function deriveLocations(reservations, courtsByDate) {
  const set = new Set()
  for (const [d, locMap] of Object.entries(courtsByDate || {})) {
    for (const loc of Object.keys(locMap)) set.add(loc)
  }
  for (const rawKey of Object.keys(reservations || {})) {
    const [location] = rawKey.split('|')
    if (location) set.add(location)
  }
  const derived = [...set]
  if (derived.length) return derived
  return FALLBACK_LOCATIONS
}

// Derives a usable days/courts view when the backend did not provide one (older
// Apps Script deployments). Every date mentioned by a reservation key is kept,
// and a window around today keeps the scheduler usable.
function deriveDaysAndCourts(reservations) {
  const dates = new Set()
  const courtsByDate = {}
  for (const rawKey of Object.keys(reservations || {})) {
    const [location, date, courtId] = rawKey.split('|')
    if (!date) continue
    dates.add(date)
    if (location && courtId) {
      if (!courtsByDate[date]) courtsByDate[date] = {}
      if (!courtsByDate[date][location]) courtsByDate[date][location] = []
      if (!courtsByDate[date][location].includes(Number(courtId))) courtsByDate[date][location].push(Number(courtId))
    }
  }
  // Window around today so the scheduler works even before a v2.0 redeploy.
  // "Today" is America/Los_Angeles, not the server's own timezone: on a UTC
  // host the old server-local window started a day late every evening.
  const todayKey = laNow().dateKey
  for (let i = 0; i < 14; i++) dates.add(addDaysToDateKey(todayKey, i))
  return { days: [...dates].sort(), courtsByDate }
}

// Builds the schedule object returned when the Apps Script WebApp is not
// available (service-account or local-dev reads). The service-account grid
// read reports the sheet's real days and courts (empty ones included, such as
// Barnes Court 6); only the flat "Reservations" tab and the local fallback
// need them derived from reservation keys instead. (Previously the grid
// days/courts were silently dropped here, which is why empty courts vanished
// in service-account mode. Exported so the composition is unit-testable.)
export function composeFallbackSchedule({ reservations, roster, source, gridDays, gridCourtsByDate }) {
  const derived = deriveDaysAndCourts(reservations)
  const days = Array.isArray(gridDays) && gridDays.length ? [...new Set(gridDays)].sort() : derived.days
  const courtsByDate =
    gridCourtsByDate && Object.keys(gridCourtsByDate).length ? gridCourtsByDate : derived.courtsByDate
  return {
    reservations,
    roster: roster || [],
    days,
    courtsByDate,
    locations: deriveLocations(reservations, courtsByDate),
    source,
    scriptVersion: null,
    connected: source === "service-account",
  }
}

// All data shown on the booking screen is read together. The Apps Script exposes
// getSchedule, so one request provides reservations, the roster, every date and
// every court. The short cache keeps normal sheet edits visible almost
// immediately.
//
// The returned `source` tells the caller where the data came from so the UI can
// warn when the app silently fell back to local storage (in which case existing
// reservations look "missing" and new bookings never reach the sheet).
// `connected` is true only for sources that can also WRITE to Google Sheets.
export async function getSchedule({ forceRefresh = false } = {}) {
  if (forceRefresh) invalidateScheduleCache()
  if (scheduleCache && Date.now() < scheduleCacheExpiresAt) return scheduleCache
  if (scheduleLoadInFlight) return scheduleLoadInFlight

  scheduleLoadInFlight = (async () => {
    if (WEBAPP_URL) {
      try {
        const json = await fetchFromWebApp("getSchedule")
        const payload = json.data || json
        if (payload.reservations) {
          const rosterRows = payload.roster || []
          const roster = rosterRows.map(r => r?.Name || r?.name || r).filter(Boolean)
          const reservations = normalizeReservations(payload.reservations)
          let days = Array.isArray(payload.days) ? payload.days : null
          let courtsByDate = payload.courtsByDate || null
          if (!days || !courtsByDate) {
            const derived = deriveDaysAndCourts(reservations)
            days = days || derived.days
            courtsByDate = courtsByDate || derived.courtsByDate
          }
          return cacheSchedule({
            reservations,
            roster,
            days: [...new Set(days)].sort(),
            courtsByDate,
            locations: Array.isArray(payload.locations) && payload.locations.length ? payload.locations : deriveLocations(reservations, courtsByDate),
            practiceSessions: payload.practiceSessions || null,
            defaultPracticeLocations: Array.isArray(payload.defaultPracticeLocations) && payload.defaultPracticeLocations.length
              ? payload.defaultPracticeLocations
              : null,
            source: "webapp",
            scriptVersion: json.version || null,
            connected: true,
          })
        }
      } catch (e) {
        console.warn("WebApp schedule read failed", e.message)
      }
      // Older deployments only expose getAll (reservations + roster).
      try {
        const json = await fetchFromWebApp("getAll")
        if (json.reservations) {
          const rosterRows = json.roster || []
          const roster = rosterRows.map(r => r?.Name || r?.name || r).filter(Boolean)
          const reservations = normalizeReservations(json.reservations)
          const derived = deriveDaysAndCourts(reservations)
          return cacheSchedule({
            reservations,
            roster,
            days: derived.days,
            courtsByDate: derived.courtsByDate,
            locations: deriveLocations(reservations, derived.courtsByDate),
            source: "webapp",
            scriptVersion: json.version || null,
            connected: true,
          })
        }
      } catch (e) {
        console.warn("WebApp legacy schedule read failed", e.message)
      }
    }

    const { reservations, source, days: gridDays, courtsByDate: gridCourtsByDate } = await readReservationsUncached()
    const roster = await getRosterUncached()
    return cacheSchedule(
      composeFallbackSchedule({ reservations, roster, source, gridDays, gridCourtsByDate })
    )
  })()

  try {
    return await scheduleLoadInFlight
  } finally {
    scheduleLoadInFlight = null
  }
}

export async function readReservations() {
  return (await getSchedule()).reservations
}

async function readReservationsUncached() {
  const sheets = await getSheetsClient()
  if (sheets) {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID })
      const titles = meta.data.sheets.map(s => s.properties.title)
      // Try grid parsing via Sheets API values
      const gridSheets = titles.filter(t => COURT_TABS.includes(t))
      if (gridSheets.length) {
        let all = {}
        let days = []
        let courtsByDate = {}
        for (const t of gridSheets) {
          const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${t}!A1:ZZ1000` })
          const parsed = parseGridValues(res.data.values, t)
          all = mergeReservations(all, parsed.reservations)
          days = [...new Set([...days, ...parsed.dates])]
          for (const [d, locMap] of Object.entries(parsed.courtsByDate)) {
            if (!courtsByDate[d]) courtsByDate[d] = {}
            for (const [loc, courts] of Object.entries(locMap)) {
              if (!courtsByDate[d][loc]) courtsByDate[d][loc] = []
              courts.forEach(c => { if (!courtsByDate[d][loc].includes(c)) courtsByDate[d][loc].push(c) })
            }
          }
        }
        if (Object.keys(all).length || days.length) {
          return { reservations: normalizeReservations(all), source: "service-account", days: [...new Set(days)].sort(), courtsByDate }
        }
      }
      if (titles.includes("Reservations")) {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Reservations!A1:Z5000" })
        return { reservations: rowsToReservations(res.data.values), source: "service-account" }
      }
    } catch (e) { console.warn("Sheets API read failed", e.message) }
  }
  // Fallback local file. Data here is ephemeral on serverless hosts and is NOT
  // the sheet, so the API reports this source and the UI shows a warning.
  const { readReservations: localRead } = await import('./reservations_local.js')
  return { reservations: await localRead(), source: "local" }
}

export async function getRoster() {
  return (await getSchedule()).roster
}

async function getRosterUncached() {
  if (WEBAPP_URL) {
    try {
      const json = await fetchFromWebApp("getRoster")
      const rows = json.data || json.roster || []
      const names = rows.map(r => r.Name || r.name || Object.values(r)[0]).filter(Boolean)
      if (names.length) return names
    } catch {}
  }
  const sheets = await getSheetsClient()
  if (sheets) {
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `Players!A1:A1000` })
      const vals = res.data.values
      if (vals && vals.length > 1) return vals.slice(1).map(r => r[0]).filter(Boolean)
    } catch {}
  }
  return null
}

// --- Writes -----------------------------------------------------------------

// Books a whole group atomically: every name is saved to every 30-minute part
// of the booking, or the Apps Script writes nothing at all. `staffApproved`
// bypasses only the close-timing warning; `practiceLocations` tells the v2.2
// backend which locations count toward the practice-session limit.
export async function bookGroup({ location, date, courtId, slots, names, staffApproved = false, staffCode = null, practiceLocations = null }) {
  const payload = { action: "bookGroup", location, date, courtId: String(courtId), slots, names, staffApproved: Boolean(staffApproved), staffCode, practiceLocations }
  if (WEBAPP_URL) {
    await fetchFromWebApp(null, payload)
    invalidateScheduleCache()
    return null
  }
  const sheets = await getSheetsClient()
  if (sheets) {
    try {
      await writeGroupToGrid(sheets, { location, date, courtId, slots, names })
      invalidateScheduleCache()
      return readReservations()
    } catch (e) {
      console.warn("Grid group book failed", e.message)
      throw e
    }
  }
  const { toggleReservation: localToggle } = await import('./reservations_local.js')
  const results = []
  for (const slot of slots) {
    for (const name of names) {
      results.push(await localToggle({ location, date, courtId, slot, name }))
    }
  }
  invalidateScheduleCache()
  return results[results.length - 1]
}

// Cancels a whole group atomically from every 30-minute part of the booking.
export async function cancelGroup({ location, date, courtId, slots, names, staffApproved = false, practiceLocations = null }) {
  const payload = { action: "cancelGroup", location, date, courtId: String(courtId), slots, names, staffApproved: Boolean(staffApproved), practiceLocations }
  if (WEBAPP_URL) {
    await fetchFromWebApp(null, payload)
    invalidateScheduleCache()
    return null
  }
  const sheets = await getSheetsClient()
  if (sheets) {
    try {
      await writeGroupToGrid(sheets, { location, date, courtId, slots, names, cancel: true })
      invalidateScheduleCache()
      return readReservations()
    } catch (e) {
      console.warn("Grid group cancel failed", e.message)
      throw e
    }
  }
  const { toggleReservation: localToggle } = await import('./reservations_local.js')
  let result = null
  for (const slot of slots) {
    for (const name of names) {
      result = await localToggle({ location, date, courtId, slot, name })
    }
  }
  invalidateScheduleCache()
  return result
}

export async function toggleReservation({ location, date, courtId, slot, name, staffApproved = false, staffCode = null, practiceLocations = null }) {
  if (WEBAPP_URL) {
    // The UI applies the change immediately, so do not require a second full-sheet
    // read before responding. The Apps Script may return reservations (older
    // deployments do); deliberately ignore that large payload.
    const payload = { action: "toggleReservation", location, date, courtId: String(courtId), slot, name, staffApproved: Boolean(staffApproved), staffCode, practiceLocations }
    try {
      await fetchFromWebApp(null, payload)
    } catch (error) {
      // A few cells in the copied sheet contain August 2026 dates with an old
      // hidden year of 2001. Apps Script v2.0 fixes those cells automatically;
      // this one-time compatibility retry also keeps older deployments usable.
      const canRetryLegacyDate =
        /^2026-/.test(String(date)) && /Date not found in sheet/i.test(error.message)
      if (!canRetryLegacyDate) throw error
      await fetchFromWebApp(null, { ...payload, date: String(date).replace(/^2026-/, "2001-") })
    }
    invalidateScheduleCache()
    return null
  }
  const sheets = await getSheetsClient()
  if (sheets) {
    try {
      await writeGroupToGrid(sheets, { location, date, courtId, slots: [slot], names: [name] })
      invalidateScheduleCache()
      return readReservations()
    } catch (e) {
      console.warn("Grid toggle failed", e.message)
    }
    // fallback to generic Reservations tab logic
    const current = await readReservations()
    const key = `${location}|${date}|${courtId}`
    const cur = { ...(current[key] || {}) }
    const arr = Array.isArray(cur[slot]) ? [...cur[slot]] : []
    const idx = arr.indexOf(name)
    if (idx !== -1) { arr.splice(idx, 1); if (arr.length) cur[slot] = arr; else delete cur[slot] } else { arr.push(name); cur[slot] = arr }
    if (Object.keys(cur).length) current[key] = cur; else delete current[key]
    await writeReservations(current)
    invalidateScheduleCache()
    return current
  }
  const { toggleReservation: localToggle } = await import('./reservations_local.js')
  const result = await localToggle({ location, date, courtId, slot, name })
  invalidateScheduleCache()
  return result
}

// Service-account path: write a group into the grid using the same span-aware
// cell discovery as the parser. `cancel` clears matching names instead of
// writing them. This path is not transactional per-cell like Apps Script's
// LockService version, so it re-checks that every target cell is free before
// writing anything.
async function writeGroupToGrid(sheets, { location, date, courtId, slots, names, cancel = false }) {
  const sheetName = locationToSheet(location)
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:ZZ1000` })
  const values = res.data.values || []
  const ranges = findSlotCellRanges(values, date, courtId, slots)
  if (!ranges) throw new Error(`Date/court/time not found in sheet: ${date} Court ${courtId} on ${sheetName}`)

  const cleanNames = [...new Set(names.map(n => String(n).trim()).filter(Boolean))]
  const cellsPerSlot = ranges.length / slots.length

  if (cancel) {
    const toClear = ranges.filter(r => r.value !== "" && cleanNames.includes(r.value))
    if (!toClear.length) throw new Error("No booking found to cancel")
    for (const cell of toClear) {
      await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${sheetName}!${cell.a1}` })
    }
    return
  }

  if (cellsPerSlot < cleanNames.length) {
    throw new Error(`Court ${courtId} has only ${cellsPerSlot} cells per 30-minute part for ${cleanNames.length} player(s)`)
  }
  const busy = ranges.filter(r => r.value !== "")
  if (busy.length) {
    throw new Error(`Slot already booked on ${sheetName} ${date} Court ${courtId} (by ${busy.map(r => r.value).join(', ')})`)
  }

  // Assign each player one cell per slot, then write everything.
  const writes = []
  for (let si = 0; si < slots.length; si++) {
    for (let ni = 0; ni < cleanNames.length; ni++) {
      const cell = ranges[si * cellsPerSlot + ni]
      writes.push({ a1: cell.a1, name: cleanNames[ni] })
    }
  }
  for (const w of writes) {
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!${w.a1}`, valueInputOption: "RAW", requestBody: { values: [[w.name]] } })
  }
}

export async function writeReservations(data) {
  if (WEBAPP_URL) return data
  const sheets = await getSheetsClient()
  if (!sheets) {
    const { writeReservations: localWrite } = await import('./reservations_local.js')
    return localWrite(data)
  }
  const rows = reservationsToRows(data)
  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: "Reservations!A1:Z1000" })
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Reservations!A1:E1", valueInputOption: "RAW", requestBody: { values: [["location", "date", "courtId", "slot", "name"], ...rows] } })
  return data
}

// Helpers
function locationToSheet(location) {
  if (location.includes("Barnes")) return "Barnes TC"
  if (location.includes("Peninsula")) return "Peninsula Tennis Club"
  if (location.includes("Point Loma")) return "Point Loma Nazarene College"
  if (location.includes("Pacific")) return "Pacific Beach TC"
  if (location.includes("Balboa")) return "Balboa Tennis"
  if (location.includes("USD")) return "USD"
  return location
}

function normalizeReservations(data) {
  const next = {}
  for (const [rawKey, slots] of Object.entries(data || {})) {
    if (!slots || typeof slots !== "object") continue

    // Some copied date cells say 2001 even though this is the 2026 event. Show
    // those reservations on the correct tournament day. Merge rather than
    // overwrite in case a day contains both correctly and incorrectly dated rows.
    const key = rawKey.replace(/\|2001-(\d{2}-\d{2})\|/, "|2026-$1|")
    if (!next[key]) next[key] = {}
    for (const [slot, val] of Object.entries(slots)) {
      if (val == null) continue
      const names = (Array.isArray(val) ? val : [val]).map(String).map(name => name.trim()).filter(Boolean)
      if (!names.length) continue
      if (!next[key][slot]) next[key][slot] = []
      names.forEach(name => { if (!next[key][slot].includes(name)) next[key][slot].push(name) })
    }
    if (!Object.keys(next[key]).length) delete next[key]
  }
  return next
}

function rowsToReservations(values) {
  if (!values || values.length < 2) return {}
  const headers = values[0].map(h => String(h).toLowerCase())
  const li = headers.indexOf("location"), di = headers.indexOf("date")
  const ci = headers.indexOf("courtid") !== -1 ? headers.indexOf("courtid") : headers.indexOf("court")
  const si = headers.indexOf("slot")
  const ni = headers.indexOf("name") !== -1 ? headers.indexOf("name") : headers.indexOf("player")
  const out = {}
  for (let i = 1; i < values.length; i++) {
    const r = values[i]
    const location = r[li], date = r[di], courtId = r[ci], slot = r[si], name = r[ni]
    if (!location || !date || !courtId || !slot || !name) continue
    const key = `${location}|${date}|${courtId}`
    if (!out[key]) out[key] = {}
    if (!out[key][slot]) out[key][slot] = []
    if (!out[key][slot].includes(name)) out[key][slot].push(name)
  }
  return out
}

function reservationsToRows(data) {
  const rows = []
  for (const [key, slots] of Object.entries(data)) {
    const [location, date, courtId] = key.split("|")
    for (const [slot, names] of Object.entries(slots)) {
      for (const name of names) rows.push([location, date, courtId, slot, name])
    }
  }
  return rows
}
