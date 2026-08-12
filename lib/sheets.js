// lib/sheets.js - Google Sheets adapter for Courtz App
// Supports: 1) Apps Script Web App (recommended) 2) Service Account 3) Local development fallback

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
  if (!res.ok || !json.success) throw new Error(json.error || `Sheets WebApp error (HTTP ${res.status})`)
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

function mergeReservations(a,b){
  const out = { ...a }
  for (const [k, slots] of Object.entries(b)){
    if (!out[k]) out[k] = {}
    for (const [slot, names] of Object.entries(slots)){
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

// All data shown on the booking screen is read together. The Apps Script exposes
// getAll, so one request provides both reservations and the roster. The short
// cache keeps normal sheet edits visible almost immediately.
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
        const json = await fetchFromWebApp("getAll")
        if (json.reservations) {
          const rosterRows = json.roster || []
          const roster = rosterRows.map(r => r?.Name || r?.name || r).filter(Boolean)
          return cacheSchedule({
            reservations: normalizeReservations(json.reservations),
            roster,
            source: "webapp",
            scriptVersion: json.version || null,
            connected: true,
          })
        }
      } catch (e) {
        console.warn("WebApp schedule read failed", e.message)
      }
    }

    const { reservations, source } = await readReservationsUncached()
    const roster = await getRosterUncached()
    return cacheSchedule({
      reservations,
      roster: roster || [],
      source,
      scriptVersion: null,
      connected: source === "service-account",
    })
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
      const gridSheets = titles.filter(t => ["Barnes TC","Peninsula Tennis Club","Point Loma Nazarene College","Pacific Beach TC","Balboa Tennis","USD"].includes(t))
      if (gridSheets.length) {
        let all = {}
        for (const t of gridSheets) {
          const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${t}!A1:ZZ500` })
          const parsed = parseGridValues(res.data.values, t)
          all = mergeReservations(all, parsed.reservations)
        }
        if (Object.keys(all).length) return { reservations: normalizeReservations(all), source: "service-account" }
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

export async function toggleReservation({ location, date, courtId, slot, name }) {
  if (WEBAPP_URL) {
    // The UI applies the change immediately, so do not require a second full-sheet
    // read before responding. The Apps Script may return reservations (older
    // deployments do); deliberately ignore that large payload.
    const payload = { action: "toggleReservation", location, date, courtId: String(courtId), slot, name }
    try {
      await fetchFromWebApp(null, payload)
    } catch (error) {
      // A few cells in the copied sheet contain August 2026 dates with an old
      // hidden year of 2001. Apps Script v1.2 fixes those cells automatically;
      // this one-time compatibility retry also keeps the currently deployed
      // v1.1 script usable until it is updated.
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
    // Grid write via Sheets API: find cell and toggle
    try {
      const sheetName = locationToSheet(location)
      const gridValues = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1:ZZ500` })).data.values
      const pos = findGridPosition(gridValues, date, courtId, slot, name)
      if (pos) {
        if (pos.exists) {
          await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: `${sheetName}!${pos.a1}` })
        } else {
          await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!${pos.a1}`, valueInputOption: "RAW", requestBody: { values: [[name]] } })
        }
        invalidateScheduleCache()
        return readReservations()
      }
    } catch (e) { console.warn("Grid toggle failed", e.message) }
    // fallback to generic Reservations tab logic
    const current = await readReservations()
    const key = `${location}|${date}|${courtId}`
    const cur = { ...(current[key] || {}) }
    const arr = Array.isArray(cur[slot]) ? [...cur[slot]] : []
    const idx = arr.indexOf(name)
    if (idx !== -1) { arr.splice(idx,1); if(arr.length) cur[slot]=arr; else delete cur[slot] } else { arr.push(name); cur[slot]=arr }
    if (Object.keys(cur).length) current[key]=cur; else delete current[key]
    await writeReservations(current)
    invalidateScheduleCache()
    return current
  }
  const { toggleReservation: localToggle } = await import('./reservations_local.js')
  const result = await localToggle({ location, date, courtId, slot, name })
  invalidateScheduleCache()
  return result
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
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Reservations!A1:E1", valueInputOption: "RAW", requestBody: { values: [["location","date","courtId","slot","name"], ...rows] } })
  return data
}

// Helpers
function locationToSheet(location){
  if (location.includes("Barnes")) return "Barnes TC"
  if (location.includes("Peninsula")) return "Peninsula Tennis Club"
  if (location.includes("Point Loma")) return "Point Loma Nazarene College"
  return location
}
function findGridPosition(values, date, courtId, slot, name){
  // Simplified: find date row, court col, time rows
  let dateRow = -1, courtCol = -1, timeRow = -1
  const targetDate = String(date) // YYYY-MM-DD
  for (let r=0;r<values.length;r++){
    const parsed = parseSheetDate(values[r][0])
    if (parsed === targetDate) { dateRow = r; break }
  }
  if (dateRow===-1) return null
  // find court header within next 3 rows
  for (let r=dateRow+1; r<Math.min(dateRow+5, values.length); r++){
    const row = values[r]
    row.forEach((c, idx)=>{ if (String(c).trim()===String(courtId)) courtCol = idx })
    if (courtCol!==-1) break
  }
  if (courtCol===-1) return null
  // find time row after dateRow
  const startLabel = slot.split("–")[0] || slot.split("-")[0]
  for (let r=dateRow+1; r<values.length; r++){
    const first = String(values[r][0]||"").trim()
    // stop at next date
    if (parseSheetDate(values[r][0]) && r!==dateRow) break
    if (first.toUpperCase() === startLabel.trim().toUpperCase()){
      timeRow = r
      // check both rows for existing name
      const cell1 = String(values[r][courtCol]||"").trim()
      const cell2 = String((values[r+1]||[])[courtCol]||"").trim()
      if (cell1 === name) return { exists: true, a1: `${colToLetter(courtCol+1)}${r+1}` }
      if (cell2 === name) return { exists: true, a1: `${colToLetter(courtCol+1)}${r+2}` }
      if (!cell1) return { exists: false, a1: `${colToLetter(courtCol+1)}${r+1}` }
      if (!cell2) return { exists: false, a1: `${colToLetter(courtCol+1)}${r+2}` }
      return null // slot full
    }
  }
  return null
}
function colToLetter(col){ let s=""; while(col>0){let m=(col-1)%26; s=String.fromCharCode(65+m)+s; col=Math.floor((col-1)/26)} return s }

function normalizeReservations(data){
  const next={}
  for(const [rawKey,slots] of Object.entries(data||{})){
    if(!slots || typeof slots!=="object") continue

    // Some copied date cells say 2001 even though this is the 2026 event. Show
    // those reservations on the correct tournament day. Merge rather than
    // overwrite in case a day contains both correctly and incorrectly dated rows.
    const key=rawKey.replace(/\|2001-(\d{2}-\d{2})\|/, "|2026-$1|")
    if(!next[key]) next[key]={}
    for(const [slot,val] of Object.entries(slots)){
      if(val==null) continue
      const names=(Array.isArray(val)?val:[val]).map(String).map(name=>name.trim()).filter(Boolean)
      if(!names.length) continue
      if(!next[key][slot]) next[key][slot]=[]
      names.forEach(name=>{ if(!next[key][slot].includes(name)) next[key][slot].push(name) })
    }
    if(!Object.keys(next[key]).length) delete next[key]
  }
  return next
}
function rowsToReservations(values){
  if(!values||values.length<2) return {}
  const headers=values[0].map(h=>String(h).toLowerCase())
  const li=headers.indexOf("location"),di=headers.indexOf("date"),ci=headers.indexOf("courtid")!==-1?headers.indexOf("courtid"):headers.indexOf("court"),si=headers.indexOf("slot"),ni=headers.indexOf("name")!==-1?headers.indexOf("name"):headers.indexOf("player")
  const out={}
  for(let i=1;i<values.length;i++){ const r=values[i]; const location=r[li],date=r[di],courtId=r[ci],slot=r[si],name=r[ni]; if(!location||!date||!courtId||!slot||!name) continue; const key=`${location}|${date}|${courtId}`; if(!out[key]) out[key]={}; if(!out[key][slot]) out[key][slot]=[]; if(!out[key][slot].includes(name)) out[key][slot].push(name) }
  return out
}
function reservationsToRows(data){
  const rows=[]
  for(const [key,slots] of Object.entries(data)){ const [location,date,courtId]=key.split("|"); for(const [slot,names] of Object.entries(slots)){ for(const name of names) rows.push([location,date,courtId,slot,name]) } }
  return rows
}

// Grid parser (duplicated from sheets-grid-parser for self-contained file)
function parseGridValues(values, sheetName){
  const reservations={}
  const locationMap={"Barnes TC":"Barnes Tennis Center","Peninsula Tennis Club":"Peninsula Tennis Club","Point Loma Nazarene College":"Point Loma Nazarene College","Pacific Beach TC":"Pacific Beach Tennis Club","Balboa Tennis":"Balboa Tennis Center","USD":"USD"}
  const location=locationMap[sheetName]||sheetName
  let currentDate=null, courtColumns={}
  for(let r=0;r<values.length;r++){
    const row=values[r]
    if(!row||row.every(c=>!String(c||"").trim() && !(c instanceof Date))) continue
    // Court header detection (before date)
    const hasCourts = row.some((c,i)=> i>0 && Number.isInteger(Number(c)) && Number(c)>0 && Number(c)<30)
    const isCourtHeader = hasCourts && (String(row[0]).trim()==="" || String(row[0]).toLowerCase()==="court")
    if(isCourtHeader){
      courtColumns={}
      row.forEach((c,i)=>{ const n=parseInt(String(c).trim()); if(!isNaN(n)&&n>0) courtColumns[n]=i })
      continue
    }
    const maybeDate=parseSheetDate(row[0])
    if(maybeDate && !isTimeString(row[0])){
      currentDate=maybeDate
      continue
    }
    if(isTimeString(row[0]) && currentDate && Object.keys(courtColumns).length){
      const timeLabel=normalizeTime(row[0])
      const secondRow=values[r+1]||[]
      const secondIsTime = isTimeString(secondRow[0])
      const slot30=`${timeLabel}–${addMinutes(timeLabel,30)}`
      for(const [courtNum,colIdx] of Object.entries(courtColumns)){
        const names=[]
        const cell1=row[colIdx]
        if(cell1 && String(cell1).trim()) names.push(String(cell1).trim())
        if(!secondIsTime){
          const cell2=secondRow[colIdx]
          if(cell2 && String(cell2).trim()) names.push(String(cell2).trim())
        }
        if(names.length){
          const key=`${location}|${currentDate}|${courtNum}`
          if(!reservations[key]) reservations[key]={}
          if(!reservations[key][slot30]) reservations[key][slot30]=[]
          names.forEach(n=>{ if(!reservations[key][slot30].includes(n)) reservations[key][slot30].push(n) })
        }
      }
    }
  }
  return { reservations }
}
function parseSheetDate(cell){
  if(cell instanceof Date && !isNaN(cell)) {
    if(cell.getFullYear()===1899) return null
    if(cell.getFullYear()===2001) {
      return `2026-${String(cell.getMonth()+1).padStart(2,"0")}-${String(cell.getDate()).padStart(2,"0")}`
    }
    return cell.toISOString().slice(0,10)
  }
  if(cell==null||cell==="") return null
  let s=String(cell).trim()
  const months={jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"}
  const m=s.match(/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Za-z]+)\s+(\d{1,2})/i)
  if(m){ const mon=months[m[1].toLowerCase().slice(0,3)]; const day=String(m[2]).padStart(2,"0"); return `2026-${mon}-${day}` }
  const iso=s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if(iso) return `${iso[1]==="2001"?"2026":iso[1]}-${iso[2]}-${iso[3]}`
  const d=new Date(s)
  if(!isNaN(d.getTime()) && s.length>6 && d.getFullYear()>2000) {
    if(d.getFullYear()===2001) return `2026-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
    return d.toISOString().slice(0,10)
  }
  return null
}
function isTimeString(s){ if(s instanceof Date && s.getFullYear()===1899) return true; return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(String(s).trim()) }
function normalizeTime(s){ if(s instanceof Date && s.getFullYear()===1899){ let h=s.getHours(), m=s.getMinutes(); let ap=h>=12?"PM":"AM", dh=h%12===0?12:h%12; return `${dh}:${String(m).padStart(2,"0")} ${ap}` } let t=String(s).trim().toUpperCase(); t=t.replace(/(\d)(AM|PM)/,"$1 $2"); return t }
function addMinutes(timeStr, mins){
  const [time,ap]=timeStr.split(" ")
  let [h,m]=time.split(":").map(Number)
  if(ap==="PM" && h!==12) h+=12
  if(ap==="AM" && h===12) h=0
  let total=h*60+m+mins
  let nh=Math.floor(total/60)%24, nm=total%60
  let nap=nh>=12?"PM":"AM", dh=nh%12===0?12:nh%12
  return `${dh}:${String(nm).padStart(2,"0")} ${nap}`
}
