// Courtz App - Google Sheets Backend (GRID VERSION for actual sheet)
// SHEET_ID: 1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je
// Bump SCRIPT_VERSION on every edit so the app (and you) can verify which
// deployment is actually live via WEBAPP_URL?action=ping.
const SCRIPT_VERSION = "1.2";
const SHEET_ID = "1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je";
const LOCATION_MAP = {
  "Barnes TC": "Barnes Tennis Center",
  "Peninsula Tennis Club": "Peninsula Tennis Club",
  "Point Loma Nazarene College": "Point Loma Nazarene College",
  "Pacific Beach TC": "Pacific Beach Tennis Club",
  "Balboa Tennis": "Balboa Tennis Center",
  "USD": "USD"
};

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e.parameter.action || "getAll";
  const ss = SpreadsheetApp.openById(SHEET_ID);
  try {
    if (action === "ping") {
      // Health check: open your WEBAPP_URL?action=ping in a browser. You should
      // see JSON with this version; a Google login or error page means the
      // deployment is not shared with "Anyone".
      return jsonResponse({ success: true, version: SCRIPT_VERSION, tabs: ss.getSheets().map(s => s.getName()) });
    }
    if (action === "listTabs") {
      const tabs = ss.getSheets().map(s => s.getName());
      return jsonResponse({ success: true, version: SCRIPT_VERSION, tabs: tabs });
    }
    if (action === "getRoster") {
      const roster = getRosterData(ss);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, data: roster });
    }
    if (action === "getAll" || action === "getReservations") {
      const roster = getRosterData(ss).map(r => r.Name || r.name).filter(Boolean);
      const reservations = getAllReservations(ss);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, roster: roster, reservations: reservations });
    }
    return jsonResponse({ success: false, version: SCRIPT_VERSION, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ success: false, version: SCRIPT_VERSION, error: err.toString(), stack: err.stack });
  }
}

function doPost(e) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === "toggleReservation") {
      // Serialise writes so two admins cannot claim the same open cell at once.
      const lock = LockService.getDocumentLock();
      lock.waitLock(10000);
      try {
        toggleGridReservation(ss, data); // data: {location, date, courtId, slot, name}
      } finally {
        lock.releaseLock();
      }
      // Do not re-parse every tab after a one-cell update. The app updates this
      // slot optimistically; its next read supplies the complete fresh schedule.
      return jsonResponse({ success: true, version: SCRIPT_VERSION });
    }
    return jsonResponse({ success: false, version: SCRIPT_VERSION, error: "Unknown POST action" });
  } catch (err) {
    return jsonResponse({ success: false, version: SCRIPT_VERSION, error: err.toString(), stack: err.stack });
  }
}

// --- ROSTER ---
function getRosterData(ss) {
  const sheet = ss.getSheetByName("Players") || ss.getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  // First row is header "Name"
  return values.slice(1).filter(r => String(r[0]).trim() !== "").map((r, idx) => ({ _rowIndex: idx+2, Name: String(r[0]).trim() }));
}

// --- GRID PARSER ---
function getAllReservations(ss) {
  const all = {};
  const sheetNames = ["Barnes TC","Peninsula Tennis Club","Point Loma Nazarene College","Pacific Beach TC","Balboa Tennis","USD"];
  sheetNames.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const values = sh.getDataRange().getValues();
    const parsed = parseGridValues(values, name);
    for (const k in parsed) {
      if (!all[k]) all[k] = {};
      for (const slot in parsed[k]) {
        if (!all[k][slot]) all[k][slot] = [];
        parsed[k][slot].forEach(n => { if (all[k][slot].indexOf(n)===-1) all[k][slot].push(n); });
      }
    }
  });
  return all;
}

function parseGridValues(values, sheetName) {
  const reservations = {};
  const location = LOCATION_MAP[sheetName] || sheetName;
  let currentDate = null;
  let courtColumns = {};
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (!row || row.every(c => String(c||"").trim() === "" && Object.prototype.toString.call(c)!=="[object Date]")) continue;
    // Detect court header BEFORE date - store whenever we see it
    const hasCourts = row.some((c,i)=> i>0 && !isNaN(parseInt(String(c).trim())) && parseInt(String(c).trim())>0);
    const isCourtHeader = hasCourts && (String(row[0]).trim()==="" || String(row[0]).toLowerCase()==="court");
    if (isCourtHeader) {
      courtColumns = {};
      row.forEach((c,i)=>{ const n=parseInt(String(c).trim()); if(!isNaN(n)&&n>0&&n<30) courtColumns[n]=i; });
      continue;
    }
    const maybeDate = parseSheetDate(row[0]);
    const firstStr = String(row[0]||"").trim();
    // Use maybeDate but ensure it's not a time Date (1899)
    if (maybeDate && !isTimeString(row[0])) {
      currentDate = maybeDate;
      continue;
    }
    if (isTimeString(row[0]) && currentDate && Object.keys(courtColumns).length) {
      const timeLabel = normalizeTime(row[0]);
      const secondRow = values[r+1] || [];
      const isSecondRowTime = isTimeString(String(secondRow[0]||"").trim());
      const slot30 = timeLabel + "–" + addMinutes(timeLabel, 30);
      for (const courtNum in courtColumns) {
        const colIdx = courtColumns[courtNum];
        const names = [];
        const cell1 = String(row[colIdx]||"").trim();
        if (cell1) names.push(cell1);
        if (!isSecondRowTime) {
          const cell2 = String(secondRow[colIdx]||"").trim();
          if (cell2) names.push(cell2);
        }
        if (names.length) {
          const key = location + "|" + currentDate + "|" + courtNum;
          if (!reservations[key]) reservations[key] = {};
          if (!reservations[key][slot30]) reservations[key][slot30] = [];
          names.forEach(n => { if (reservations[key][slot30].indexOf(n)===-1) reservations[key][slot30].push(n); });
        }
      }
    }
  }
  return reservations;
}

function toggleGridReservation(ss, data) {
  // data: {location, date, courtId, slot, name}
  const sheetName = locationToSheet(data.location);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Sheet not found: " + sheetName);
  const values = sh.getDataRange().getValues();
  const targetDate = String(data.date).trim(); // YYYY-MM-DD
  const courtId = String(data.courtId).trim();
  const startLabel = String(data.slot).split("–")[0].split("-")[0].trim();
  const startNorm = normalizeTime(startLabel);
  const name = String(data.name).trim();

  // Find date row
  let dateRow = -1;
  for (let r=0; r<values.length; r++) {
    const parsed = parseSheetDate(values[r][0]);
    if (parsed === targetDate) { dateRow = r; break; }
  }
  if (dateRow === -1) throw new Error("Date not found in sheet: " + targetDate + " on " + sheetName);
  // Find court column - search backwards (header is BEFORE date) and forwards
  let courtCol = -1;
  let courtHeaderRow = -1;
  // Search backwards up to 5 rows before date
  for (let r=dateRow-1; r>=Math.max(0,dateRow-5); r--) {
    const row = values[r];
    for (let c=0; c<row.length; c++) {
      if (String(row[c]).trim() === courtId) { courtCol = c; courtHeaderRow = r; break; }
    }
    if (courtCol !== -1) break;
  }
  // If not found backwards, search forwards
  if (courtCol === -1) {
    for (let r=dateRow+1; r<Math.min(dateRow+5, values.length); r++) {
      const row = values[r];
      for (let c=0; c<row.length; c++) {
        if (String(row[c]).trim() === courtId) { courtCol = c; courtHeaderRow = r; break; }
      }
      if (courtCol !== -1) break;
    }
  }
  if (courtCol === -1) throw new Error("Court " + courtId + " not found on " + sheetName + " for date " + targetDate);
  // Find time row
  // Find time row - start after dateRow (not courtHeaderRow, which is before date)
  for (let r=dateRow+1; r<values.length; r++) {
    const rawFirst = values[r][0];
    const parsedDate = parseSheetDate(rawFirst);
    if (parsedDate && r !== dateRow) break; // next date section
    if (isTimeString(rawFirst) && normalizeTime(rawFirst) === startNorm) {
      const cell1 = String(values[r][courtCol]||"").trim();
      const secondRow = values[r+1] || [];
      const isSecondRowTime = isTimeString(secondRow[0]);
      const cell2 = !isSecondRowTime ? String(secondRow[courtCol]||"").trim() : null;

      // If name already exists, delete it
      if (cell1 === name) {
        sh.getRange(r+1, courtCol+1).clearContent();
        return true;
      }
      if (cell2 === name) {
        sh.getRange(r+2, courtCol+1).clearContent();
        return true;
      }
      // Otherwise add to first empty
      if (!cell1) {
        sh.getRange(r+1, courtCol+1).setValue(name);
        return true;
      }
      if (cell2 !== null && !cell2) {
        sh.getRange(r+2, courtCol+1).setValue(name);
        return true;
      }
      throw new Error("Slot full at " + sheetName + " " + targetDate + " Court " + courtId + " " + data.slot);
    }
  }
  throw new Error("Time slot not found: " + startNorm + " on " + sheetName + " " + targetDate);
}

function locationToSheet(location){
  if (location.indexOf("Barnes") !== -1) return "Barnes TC";
  if (location.indexOf("Peninsula") !== -1) return "Peninsula Tennis Club";
  if (location.indexOf("Point Loma") !== -1) return "Point Loma Nazarene College";
  if (location.indexOf("Pacific") !== -1) return "Pacific Beach TC";
  if (location.indexOf("Balboa") !== -1) return "Balboa Tennis";
  if (location.indexOf("USD") !== -1) return "USD";
  return location;
}
function parseSheetDate(cell){
  if (cell==null || cell==="") return null;
  if (Object.prototype.toString.call(cell) === "[object Date]" && !isNaN(cell)) {
    if (cell.getFullYear() === 1899) return null; // time, not date
    // A few copied cells contain the hidden year 2001 even though their visible
    // month/day belongs to this 2026 tournament.
    if (cell.getFullYear() === 2001) {
      return "2026-" + ("0" + (cell.getMonth()+1)).slice(-2) + "-" + ("0" + cell.getDate()).slice(-2);
    }
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  let s = String(cell).trim();
  const months={jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
  const m=s.match(/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Za-z]+)\s+(\d{1,2})/i);
  if(m){ const mon=months[m[1].toLowerCase().slice(0,3)]; const day=("0"+m[2]).slice(-2); return "2026-"+mon+"-"+day; }
  const iso=s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(iso) return (iso[1] === "2001" ? "2026" : iso[1]) + "-" + iso[2] + "-" + iso[3];
  const mdY=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(mdY) return (mdY[3] === "2001" ? "2026" : mdY[3]) + "-" + ("0"+mdY[1]).slice(-2) + "-" + ("0"+mdY[2]).slice(-2);
  const d=new Date(s);
  if(!isNaN(d.getTime()) && s.length>6 && d.getFullYear()>2000) {
    if(d.getFullYear() === 2001) return "2026-" + ("0"+(d.getMonth()+1)).slice(-2) + "-" + ("0"+d.getDate()).slice(-2);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return null;
}
function isTimeString(s){ if(Object.prototype.toString.call(s)==="[object Date]" && s.getFullYear()===1899) return true; return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(String(s).trim()); }
function normalizeTime(s){ if(Object.prototype.toString.call(s)==="[object Date]" && s.getFullYear()===1899){ let h=s.getHours(), m=s.getMinutes(); let ap=h>=12?"PM":"AM", dh=h%12===0?12:h%12; return dh+":"+(m<10?"0"+m:m)+" "+ap; } let t=String(s).trim().toUpperCase(); t=t.replace(/(\d)(AM|PM)/,"$1 $2"); return t; }
function addMinutes(timeStr, mins){
  const parts=timeStr.split(" ");
  let h=parseInt(parts[0].split(":")[0]), m=parseInt(parts[0].split(":")[1]), ap=parts[1];
  if(ap==="PM" && h!==12) h+=12;
  if(ap==="AM" && h===12) h=0;
  let total=h*60+m+mins;
  let nh=Math.floor(total/60)%24, nm=total%60;
  let nap=nh>=12?"PM":"AM", dh=nh%12===0?12:nh%12;
  return dh+":"+("0"+nm).slice(-2)+" "+nap;
}
