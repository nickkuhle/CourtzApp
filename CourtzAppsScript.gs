// Courtz App - Google Sheets Backend (GRID VERSION for actual sheet)
// SHEET_ID: 1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je  (TEST COPY - do not point at the real sheet)
// Bump SCRIPT_VERSION on every edit so the app (and you) can verify which
// deployment is actually live via WEBAPP_URL?action=ping.
const SCRIPT_VERSION = "2.1";
const SHEET_ID = "1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je";
const DEFAULT_TOURNAMENT_YEAR = "2026";
const TIME_ZONE = "America/Los_Angeles"; // San Diego: booking window always uses this zone
const LOCATION_MAP = {
  "Barnes TC": "Barnes Tennis Center",
  "Peninsula Tennis Club": "Peninsula Tennis Club",
  "Point Loma Nazarene College": "Point Loma Nazarene College",
  "Pacific Beach TC": "Pacific Beach Tennis Club",
  "Balboa Tennis": "Balboa Tennis Center",
  "USD": "USD"
};
// Sites shown by default in the app. Other grid tabs (match-play sites, new
// tabs the desk adds to the Sheet) are discovered automatically and offered
// through the app's "+" button.
const PRACTICE_DEFAULT_LOCATIONS = ["Barnes Tennis Center", "Peninsula Tennis Club", "Point Loma Nazarene College"];
const COURT_TABS = Object.keys(LOCATION_MAP);
const MONTHS = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e.parameter.action || "getSchedule";
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
    if (action === "getSchedule") {
      const result = readFullSchedule(ss);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, data: result });
    }
    if (action === "getAll" || action === "getReservations") {
      // Backwards-compatible payload used by older app builds.
      const roster = getRosterData(ss).map(r => r.Name || r.name).filter(Boolean);
      const reservations = getAllReservations(ss);
      return jsonResponse({ success: true, version: SCRIPT_VERSION, roster: roster, reservations: reservations });
    }
    if (action === "dumpGrid") {
      // Debug aid: ?action=dumpGrid&sheet=<Tab Name> returns the raw grid of one
      // tab so a layout problem can be inspected after a redeploy.
      const sheetName = e.parameter.sheet;
      const tabs = ss.getSheets();
      const sh = sheetName ? tabs.find(t => t.getName().toLowerCase() === String(sheetName).toLowerCase()) : null;
      if (sheetName && !sh) return jsonResponse({ success: false, version: SCRIPT_VERSION, error: "Tab not found: " + sheetName, tabs: tabs.map(t => t.getName()) });
      const target = sh || tabs[0];
      const values = target.getDataRange().getValues();
      return jsonResponse({ success: true, version: SCRIPT_VERSION, sheet: target.getName(), values: values });
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
    // Serialise writes so two admins cannot claim the same open cell at once.
    // All booking-window and session-limit rules are rechecked INSIDE the lock
    // against fresh sheet data, so stale browser data cannot bypass them.
    const lock = LockService.getDocumentLock();
    lock.waitLock(15000);
    try {
      if (data.action === "bookGroup") {
        validateBookingWindowInGAS(data);
        validateSessionRulesInGAS(ss, data);
        bookGroup(ss, data); // data: {location, date, courtId, slots: [], names: [], staffApproved, activeLocations}
        return jsonResponse({ success: true, version: SCRIPT_VERSION, action: "bookGroup" });
      }
      if (data.action === "cancelGroup") {
        validateBookingWindowInGAS(data);
        cancelGroup(ss, data); // data: {location, date, courtId, slots: [], names: []}
        return jsonResponse({ success: true, version: SCRIPT_VERSION, action: "cancelGroup" });
      }
      if (data.action === "toggleReservation") {
        // Single-player toggle kept for older app builds.
        validateBookingWindowInGAS({ date: data.date, slots: [data.slot] });
        toggleGridReservation(ss, data); // data: {location, date, courtId, slot, name}
        return jsonResponse({ success: true, version: SCRIPT_VERSION, action: "toggleReservation" });
      }
    } finally {
      lock.releaseLock();
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
  return values.slice(1).filter(r => String(r[0]).trim() !== "").map((r, idx) => ({ _rowIndex: idx + 2, Name: String(r[0]).trim() }));
}

// --- SCHEDULE ---
// Reads every court-location tab and returns reservations plus the full list of
// dates and courts found in the sheet (including dates/courts with no bookings).
// Tabs are discovered dynamically: any tab (other than "Players") that contains
// the date/court grid layout is treated as a court-location tab, so newly added
// Sheet tabs show up in the app's "+" menu automatically.
function readFullSchedule(ss) {
  const all = {};
  const datesSet = {};
  const courtsByDate = {};
  const locations = [];
  const knownOrder = Object.keys(LOCATION_MAP);
  const extraTabs = [];

  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (/^players$/i.test(name.trim())) return; // roster tab, not a court grid
    const values = sh.getDataRange().getValues();
    const parsed = parseGridValues(values, name);
    // Only tabs that actually contain grid sections count as court tabs.
    if (!parsed.dates.length && !Object.keys(parsed.reservations).length) return;
    const location = LOCATION_MAP[name] || name;

    if (knownOrder.indexOf(name) === -1) extraTabs.push(name);
    if (locations.indexOf(location) === -1) locations.push(location);

    // Merge reservations
    for (const k in parsed.reservations) {
      if (!all[k]) all[k] = {};
      for (const slot in parsed.reservations[k]) {
        if (!all[k][slot]) all[k][slot] = [];
        parsed.reservations[k][slot].forEach(n => { if (all[k][slot].indexOf(n) === -1) all[k][slot].push(n); });
      }
    }
    // Merge dates
    parsed.dates.forEach(d => { datesSet[d] = true; });
    // Merge courts per date
    for (const d in parsed.courtsByDate) {
      if (!courtsByDate[d]) courtsByDate[d] = {};
      if (!courtsByDate[d][location]) courtsByDate[d][location] = [];
      parsed.courtsByDate[d][location].forEach(c => {
        if (courtsByDate[d][location].indexOf(c) === -1) courtsByDate[d][location].push(c);
      });
    }
  });

  // Keep the familiar order: known tabs first (in LOCATION_MAP order), then any
  // newly discovered tabs sorted alphabetically.
  const ordered = [];
  knownOrder.forEach(tab => {
    const location = LOCATION_MAP[tab];
    if (locations.indexOf(location) !== -1 && ordered.indexOf(location) === -1) ordered.push(location);
  });
  extraTabs.sort().forEach(tab => {
    if (ordered.indexOf(tab) === -1) ordered.push(tab);
  });

  const roster = getRosterData(ss).map(r => r.Name || r.name).filter(Boolean);
  const days = Object.keys(datesSet).sort();
  return {
    roster: roster,
    reservations: all,
    days: days,
    courtsByDate: courtsByDate,
    locations: ordered
  };
}

// Backwards-compatible reservations-only read. Discovers grid tabs the same
// dynamic way readFullSchedule does.
function getAllReservations(ss) {
  const all = {};
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    if (/^players$/i.test(name.trim())) return;
    const values = sh.getDataRange().getValues();
    const parsed = parseGridValues(values, name);
    for (const k in parsed.reservations) {
      if (!all[k]) all[k] = {};
      for (const slot in parsed.reservations[k]) {
        if (!all[k][slot]) all[k][slot] = [];
        parsed.reservations[k][slot].forEach(n => { if (all[k][slot].indexOf(n) === -1) all[k][slot].push(n); });
      }
    }
  });
  return all;
}

// --- GRID PARSER (mirrors lib/sheets-grid-parser.js - keep in sync) ---
// One date section looks like:
//   ["Mon Aug 10", "", ...]                       <- date row
//   ["", 4, "", 5, "", 6, "", ...]                <- court header (each court may span multiple columns)
//   ["8:00 AM", "Name", "Name", ...]              <- 30-min slot row
//   ["", "Name", ...]                             <- continuation row of the same slot
function parseGridValues(values, sheetName) {
  const reservations = {};
  const location = LOCATION_MAP[sheetName] || sheetName;
  const sections = [];
  const datesSeen = {};
  let current = null;
  let pendingHeader = null;

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (!row) continue;
    let hasContent = false;
    for (let c = 0; c < row.length; c++) { if (cellText(row[c]) !== "") { hasContent = true; break; } }
    if (!hasContent) continue;

    const firstRaw = row[0];
    const date = parseSheetDate(firstRaw);
    const firstIsTime = isTimeString(firstRaw);

    if (date && !firstIsTime) {
      // New date section
      if (!current || current.date !== date) {
        current = { date: date, row: r, headerRow: -1, courts: pendingHeader ? computeCourtSpans(pendingHeader.nums) : [] };
        if (pendingHeader) { current.headerRow = pendingHeader.row; pendingHeader = null; }
        sections.push(current);
        datesSeen[date] = true;
      }
      // Some layouts put the courts on the same row as the date
      const inlineNums = detectCourtNumbers(row);
      if (inlineNums.length) {
        current.courts = computeCourtSpans(inlineNums);
        current.headerRow = r;
      }
      continue;
    }

    if (isCourtHeaderRow(row)) {
      const nums = detectCourtNumbers(row);
      if (current) {
        current.courts = computeCourtSpans(nums);
        current.headerRow = r;
      } else {
        pendingHeader = { nums: nums, row: r };
      }
      continue;
    }

    if (firstIsTime && current && current.courts.length) {
      const timeLabel = normalizeTime(firstRaw);
      const slot30 = timeLabel + "\u2013" + addMinutes(timeLabel, 30);
      const secondRow = values[r + 1];
      const secondIsTime = secondRow ? isTimeString(secondRow[0]) : false;
      const secondIsDate = secondRow ? (parseSheetDate(secondRow[0]) && !isTimeString(secondRow[0])) : false;
      const twoRowSlot = secondRow ? !secondIsTime && !secondIsDate : false;

      for (let ci = 0; ci < current.courts.length; ci++) {
        const c = current.courts[ci];
        const names = [];
        for (let cj = 0; cj < c.cols.length; cj++) {
          const v = cellText(row[c.cols[cj]]);
          if (v) pushName(names, v);
        }
        if (twoRowSlot) {
          for (let cj = 0; cj < c.cols.length; cj++) {
            const v = cellText(secondRow[c.cols[cj]]);
            if (v) pushName(names, v);
          }
        }
        if (names.length) {
          const key = location + "|" + current.date + "|" + c.court;
          if (!reservations[key]) reservations[key] = {};
          if (!reservations[key][slot30]) reservations[key][slot30] = [];
          for (let ni = 0; ni < names.length; ni++) {
            if (reservations[key][slot30].indexOf(names[ni]) === -1) reservations[key][slot30].push(names[ni]);
          }
        }
      }
    }
  }

  const courtsByDate = {};
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    if (!sec.courts.length) continue;
    if (!courtsByDate[sec.date]) courtsByDate[sec.date] = {};
    if (!courtsByDate[sec.date][location]) courtsByDate[sec.date][location] = [];
    for (let ci = 0; ci < sec.courts.length; ci++) {
      const id = sec.courts[ci].court;
      if (courtsByDate[sec.date][location].indexOf(id) === -1) courtsByDate[sec.date][location].push(id);
    }
  }

  return { reservations: reservations, dates: Object.keys(datesSeen), courtsByDate: courtsByDate, sections: sections };
}

function cellText(cell) {
  if (cell == null) return "";
  if (Object.prototype.toString.call(cell) === "[object Date]" && !isNaN(cell)) return String(cell);
  return String(cell).trim();
}

function pushName(list, raw) {
  // One cell = one player. If several names were pasted into one cell separated
  // by newlines, split on newlines only (commas belong inside "Last, First").
  const parts = String(raw).split(/\r?\n/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p && list.indexOf(p) === -1) list.push(p);
  }
}

function detectCourtNumbers(row) {
  const out = [];
  for (let i = 0; i < row.length; i++) {
    if (i === 0) continue;
    const s = String(row[i] == null ? "" : row[i]).trim();
    if (!s) continue;
    let n = null;
    if (/^\d{1,2}$/.test(s)) n = parseInt(s, 10);
    else if (/^court\s*#?\s*\d{1,2}$/i.test(s)) n = parseInt(s.match(/\d+/)[0], 10);
    if (n != null && n >= 1 && n <= 50) out.push({ n: n, idx: i });
  }
  return out;
}

function isCourtHeaderRow(row) {
  const nums = detectCourtNumbers(row);
  if (!nums.length) return false;
  const first = String(row && row[0] != null ? row[0] : "").trim().toLowerCase();
  if (!first) return true;
  if (first === "court" || first === "courts") return true;
  if (parseSheetDate(row[0])) return true;
  return false;
}

function computeCourtSpans(nums) {
  if (!nums || !nums.length) return [];
  const widths = [];
  for (let i = 0; i < nums.length - 1; i++) widths.push(nums[i + 1].idx - nums[i].idx);
  let standard = 1;
  if (widths.length) {
    const counts = {};
    widths.forEach(w => { counts[w] = (counts[w] || 0) + 1; });
    let bestWidth = 1, bestCount = 0;
    for (const w in counts) {
      const ww = parseInt(w, 10);
      if (counts[w] > bestCount || (counts[w] === bestCount && ww > bestWidth)) {
        bestCount = counts[w];
        bestWidth = ww;
      }
    }
    standard = Math.max(1, bestWidth);
  }
  return nums.map(function (entry, i) {
    const start = entry.idx;
    let end;
    if (i + 1 < nums.length) {
      end = nums[i + 1].idx - 1;
    } else {
      end = start + standard - 1;
    }
    if (end < start) end = start;
    const cols = [];
    for (let c = start; c <= end; c++) cols.push(c);
    return { court: entry.n, cols: cols };
  });
}

// --- DATE / TIME HELPERS ---
function parseSheetDate(cell) {
  if (cell == null || cell === "") return null;
  if (Object.prototype.toString.call(cell) === "[object Date]" && !isNaN(cell)) {
    if (cell.getFullYear() === 1899) return null; // time, not date
    // A few copied cells contain the hidden year 2001 even though their visible
    // month/day belongs to this 2026 tournament.
    if (cell.getFullYear() === 2001) {
      return DEFAULT_TOURNAMENT_YEAR + "-" + ("0" + (cell.getMonth() + 1)).slice(-2) + "-" + ("0" + cell.getDate()).slice(-2);
    }
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  let s = String(cell).trim();
  if (!s) return null;

  // "2026-08-12" (ISO) - checked first so it is never seen as "01-08-13"
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return normYear(m[1]) + "-" + m[2] + "-" + m[3];

  // "Mon Aug 10" / "Monday, August 10" / "Wed Aug 12, 2026"
  m = s.match(/(?:[A-Za-z]{3,9})[\s,/]+([A-Za-z]{3,9})[\s,/]+(\d{1,2})(?:[\s,/]+(\d{2,4}))?/i);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon) {
      const day = ("0" + m[2]).slice(-2);
      const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR;
      return year + "-" + mon + "-" + day;
    }
    const mon2 = MONTHS[m[0].toLowerCase().slice(0, 3)];
    if (mon2) {
      const day = ("0" + m[2]).slice(-2);
      const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR;
      return year + "-" + mon2 + "-" + day;
    }
    return null;
  }
  // "August 12" / "Aug 12" / "August 12, 2026"
  m = s.match(/([A-Za-z]{3,9})[\s,/]+(\d{1,2})(?:[\s,/]+(\d{2,4}))?/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (mon) {
      const day = ("0" + m[2]).slice(-2);
      const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR;
      return year + "-" + mon + "-" + day;
    }
  }
  // "Wed 8/12" / "8/12" / "8/12/2026" / "8/12/26" (never a substring of "2001-08-13")
  m = s.match(/(?:^|[^\d])(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?(?=$|[^\d])/);
  if (m) {
    const mon = ("0" + m[1]).slice(-2);
    const day = ("0" + m[2]).slice(-2);
    const year = m[3] ? normYear(m[3]) : DEFAULT_TOURNAMENT_YEAR;
    if (parseInt(mon, 10) <= 12 && parseInt(day, 10) <= 31) return year + "-" + mon + "-" + day;
  }
  return null;
}

function normYear(y) {
  const n = parseInt(y, 10);
  if (n === 2001) return DEFAULT_TOURNAMENT_YEAR;
  if (n >= 100) return String(n);
  return "20" + ("0" + n).slice(-2);
}

function isTimeString(s) {
  if (s == null || s === "") return false;
  if (Object.prototype.toString.call(s) === "[object Date]" && !isNaN(s)) return s.getFullYear() === 1899;
  const t = String(s).trim();
  if (!t) return false;
  return /^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(t);
}

function normalizeTime(s) {
  if (Object.prototype.toString.call(s) === "[object Date]" && !isNaN(s) && s.getFullYear() === 1899) {
    let h = s.getHours(), m = s.getMinutes();
    let ap = h >= 12 ? "PM" : "AM", dh = h % 12 === 0 ? 12 : h % 12;
    return dh + ":" + (m < 10 ? "0" + m : m) + " " + ap;
  }
  let t = String(s).trim().toUpperCase();
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    let h = parseInt(t.split(":")[0], 10), m = parseInt(t.split(":")[1], 10);
    let ap = h >= 12 ? "PM" : "AM", dh = h % 12 === 0 ? 12 : h % 12;
    return dh + ":" + (m < 10 ? "0" + m : m) + " " + ap;
  }
  t = t.replace(/(\d)(AM|PM)/, "$1 $2");
  return t;
}

function timeToMinutes(timeStr) {
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return NaN;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function addMinutes(timeStr, mins) {
  const base = timeToMinutes(timeStr);
  if (isNaN(base)) return timeStr;
  const total = base + mins;
  let nh = Math.floor(total / 60) % 24, nm = total % 60;
  let nap = nh >= 12 ? "PM" : "AM", dh = nh % 12 === 0 ? 12 : nh % 12;
  return dh + ":" + (nm < 10 ? "0" + nm : nm) + " " + nap;
}

function slotStartLabel(slot) {
  return String(slot).split(/[\u2013-]/)[0].trim();
}

function slotEndLabel(slot) {
  const parts = String(slot).split(/[\u2013-]/);
  return parts.length > 1 ? parts[1].trim() : "";
}

// --- BOOKING WINDOW (America/Los_Angeles) ----------------------------------
// Reservations may only be booked or changed for TODAY and TOMORROW in
// America/Los_Angeles time regardless of the script/sheet/device timezone.
// Ended 30-minute slots cannot be booked or canceled; the CURRENT 30-minute
// slot stays available until its end time (at 1:15 PM, 1:00-1:30 PM is still
// bookable while 12:30-1:00 PM is not). Mirrors lib/booking-window.js.

function laDateKeyOffsetDays(offsetDays) {
  // Compute "today in LA" first, then step over calendar dates at UTC noon
  // (noon UTC always falls inside the same LA calendar date, so this is safe
  // across DST transitions where a day is 23 or 25 hours long).
  const today = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
  if (offsetDays === 0) return today;
  const parts = today.split("-").map(Number);
  const target = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + offsetDays, 12));
  return Utilities.formatDate(target, TIME_ZONE, "yyyy-MM-dd");
}

function laMinutesNow() {
  const t = Utilities.formatDate(new Date(), TIME_ZONE, "HH:mm");
  const parts = t.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function slotRangeParts(slot) {
  const start = timeToMinutes(slotStartLabel(slot));
  const end = timeToMinutes(slotEndLabel(slot));
  if (isNaN(start) || isNaN(end)) return null;
  return { start: start, end: end };
}

function validateBookingWindowInGAS(data) {
  const dateKey = String(data.date);
  const today = laDateKeyOffsetDays(0);
  const tomorrow = laDateKeyOffsetDays(1);
  if (dateKey !== today && dateKey !== tomorrow) {
    throw new Error("This day is view only. Reservations can only be booked or changed for " + today + " or " + tomorrow + " (America/Los_Angeles).");
  }
  const slots = cleanSlots(data.slots || []);
  if (!slots.length && data.slot) slots.push(data.slot);
  const nowMinutes = laMinutesNow();
  const completed = [];
  for (let i = 0; i < slots.length; i++) {
    const range = slotRangeParts(slots[i]);
    if (!range) throw new Error("Invalid time slot: " + slots[i]);
    // Only today's slots can have ended; tomorrow is always open.
    if (dateKey === today && nowMinutes >= range.end) completed.push(slots[i]);
  }
  if (completed.length) {
    throw new Error("These times have already ended: " + completed.join(", ") + ". Ended time slots cannot be booked or canceled; the current 30-minute slot stays available until it ends.");
  }
  return { today: today, tomorrow: tomorrow, nowMinutes: nowMinutes };
}

// --- PLAYER SESSION LIMIT + STAFF APPROVAL ---------------------------------
// Max TWO practice sessions per player per day across all active practice
// locations. Barnes: every occupied 30-minute slot is one session. Other
// locations: for the same player + date + location + court, two immediately
// consecutive 30-minute slots combine into ONE 60-minute session (a session
// holds at most two slots). Proximity warnings compare SESSION STARTS - never
// the internal halves of a 60-minute session. Mirrors lib/session-rules.js.

function groupPartsIntoSessions(parts) {
  const byCourt = {};
  parts.forEach(p => {
    const k = String(p.location) + "|" + String(p.court);
    if (!byCourt[k]) byCourt[k] = [];
    byCourt[k].push(p);
  });
  const sessions = [];
  for (const k in byCourt) {
    const sorted = byCourt[k].sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });
    // Barnes never merges consecutive slots: every 30-minute reservation there
    // is one session of its own.
    const isBarnes = sorted.length > 0 && /barnes/i.test(String(sorted[0].location || ""));
    let current = null;
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      if (current && !isBarnes && current.parts.length < 2 && current.end === p.start) {
        current.parts.push(p);
        current.end = p.end;
      } else {
        current = { start: p.start, end: p.end, parts: [p], location: p.location, court: p.court };
        sessions.push(current);
      }
    }
  }
  return sessions;
}

function sessionsClose(a, b) {
  if (Math.abs(a.start - b.start) < 60) return true; // starts within one hour
  if (a.start === b.end || a.end === b.start) return true; // back-to-back
  return false;
}

// Rechecks the session rules against FRESH sheet data (read inside the write
// lock). `data.staffApproved` bypasses only the proximity warning; the hard
// maximum of two sessions per player per day is never bypassed.
function validateSessionRulesInGAS(ss, data) {
  const names = cleanNames(data.names);
  const slots = cleanSlots(data.slots);
  if (!names.length || !slots.length) return; // bookGroup itself throws on this

  // Active practice locations: the three defaults plus whatever the app's desk
  // deliberately added (and the location being booked right now).
  const active = PRACTICE_DEFAULT_LOCATIONS.slice();
  (data.activeLocations || []).forEach(l => {
    const v = String(l).trim();
    if (v && active.indexOf(v) === -1) active.push(v);
  });
  if (active.indexOf(data.location) === -1) active.push(data.location);

  const dateKey = String(data.date);
  const schedule = readFullSchedule(ss); // fresh, inside the write lock
  const reservations = schedule.reservations || {};

  const proposedParts = [];
  for (let i = 0; i < slots.length; i++) {
    const range = slotRangeParts(slots[i]);
    if (range) proposedParts.push({ start: range.start, end: range.end, location: data.location, court: String(data.courtId) });
  }

  const overLimit = [];
  const warnings = [];
  for (let ni = 0; ni < names.length; ni++) {
    const name = names[ni];
    const existingParts = [];
    for (const key in reservations) {
      const parts = key.split("|");
      const location = parts[0];
      if (active.indexOf(location) === -1) continue; // hidden sites don't count unless added
      if (parts[1] !== dateKey) continue;
      const court = parts[2];
      const slotsMap = reservations[key];
      for (const slotLabel in slotsMap) {
        const players = slotsMap[slotLabel] || [];
        if (players.indexOf(name) === -1) continue;
        const range = slotRangeParts(slotLabel);
        if (range) existingParts.push({ start: range.start, end: range.end, location: location, court: court });
      }
    }
    // Hard limit: count the grouped sessions of the COMBINED state.
    const combined = groupPartsIntoSessions(existingParts.concat(proposedParts));
    if (combined.length > 2) overLimit.push(name);
    // Proximity: compare each proposed session's start against every other
    // session's start/end - never against the internal halves of one session.
    const existingSessions = groupPartsIntoSessions(existingParts);
    const proposedSessions = groupPartsIntoSessions(proposedParts);
    const seen = [];
    for (let pi = 0; pi < proposedSessions.length; pi++) {
      const proposed = proposedSessions[pi];
      for (let ei = 0; ei < existingSessions.length; ei++) {
        if (sessionsClose(proposed, existingSessions[ei])) warnings.push({ player: name });
      }
      for (let si = 0; si < seen.length; si++) {
        if (sessionsClose(proposed, seen[si])) warnings.push({ player: name });
      }
      seen.push(proposed);
    }
  }

  if (overLimit.length) {
    throw new Error(overLimit.join(", ") + (overLimit.length === 1 ? " has" : " have") + " already reached the maximum of 2 practice sessions for " + dateKey + ". The limit cannot be bypassed.");
  }
  if (warnings.length && data.staffApproved !== true) {
    const who = [];
    warnings.forEach(w => { if (who.indexOf(w.player) === -1) who.push(w.player); });
    throw new Error("STAFF_APPROVAL_REQUIRED: Tournament staff approval is required for " + who.join(", ") + ". This booking places a practice session back-to-back with another session, or its start time is within one hour of another session's start time. Continue only if tournament staff have approved it.");
  }
}

// --- WRITES ---
// Finds the section/court/time cells for one booking on the (already-read)
// grid `values`. Returns { section, court, cells: [{row, col, value}] } or null.
function locateSlotCells(values, date, courtId, startNorm) {
  const targetDate = String(date);
  const parsed = parseGridValues(values, "");
  let section = null;
  for (let i = 0; i < parsed.sections.length; i++) {
    if (parsed.sections[i].date === targetDate) { section = parsed.sections[i]; break; }
  }
  if (!section) return null;
  let court = null;
  for (let i = 0; i < section.courts.length; i++) {
    if (String(section.courts[i].court) === String(courtId)) { court = section.courts[i]; break; }
  }
  if (!court) return null;

  let sectionEnd = values.length;
  for (let i = 0; i < parsed.sections.length; i++) {
    const sec = parsed.sections[i];
    if (sec.date !== targetDate && sec.row > section.row) { sectionEnd = sec.row; break; }
  }

  let timeRow = -1;
  for (let r = Math.max(section.row + 1, 0); r < sectionEnd; r++) {
    if (isTimeString(values[r][0]) && normalizeTime(values[r][0]) === startNorm) { timeRow = r; break; }
  }
  if (timeRow === -1) return null;

  const rows = [timeRow];
  const next = values[timeRow + 1];
  const nextIsTime = next ? isTimeString(next[0]) : false;
  const nextIsDate = next ? (parseSheetDate(next[0]) && !isTimeString(next[0])) : false;
  if (next && !nextIsTime && !nextIsDate) rows.push(timeRow + 1);

  const cells = [];
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < court.cols.length; ci++) {
      const col = court.cols[ci];
      cells.push({ row: rows[ri], col: col, value: values[rows[ri]] ? cellText(values[rows[ri]][col]) : "" });
    }
  }
  return { section: section, court: court, cells: cells };
}

function locationToSheet(location) {
  if (location.indexOf("Barnes") !== -1) return "Barnes TC";
  if (location.indexOf("Peninsula") !== -1) return "Peninsula Tennis Club";
  if (location.indexOf("Point Loma") !== -1) return "Point Loma Nazarene College";
  if (location.indexOf("Pacific") !== -1) return "Pacific Beach TC";
  if (location.indexOf("Balboa") !== -1) return "Balboa Tennis";
  if (location.indexOf("USD") !== -1) return "USD";
  return location;
}

function cleanNames(names) {
  const out = [];
  (names || []).forEach(n => {
    const v = String(n).trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  });
  return out;
}

function cleanSlots(slots) {
  const out = [];
  (slots || []).forEach(s => {
    const v = String(s).trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  });
  return out;
}

// Atomic group booking: every name is written to every requested 30-minute part,
// or nothing is written at all (on any conflict/error the partial cells are
// cleared again).
function bookGroup(ss, data) {
  const sheetName = locationToSheet(data.location);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Sheet not found: " + sheetName);
  const values = sh.getDataRange().getValues();
  const names = cleanNames(data.names);
  const slots = cleanSlots(data.slots);
  if (!names.length) throw new Error("No players given");
  if (!slots.length) throw new Error("No time slots given");

  // Verify every part is fully open and plan the writes.
  const plan = []; // {row, col, name}
  const perSlotCapacity = [];
  for (let si = 0; si < slots.length; si++) {
    const startNorm = normalizeTime(slotStartLabel(slots[si]));
    const found = locateSlotCells(values, String(data.date), data.courtId, startNorm);
    if (!found) throw new Error("Time slot not found: " + slots[si] + " on " + sheetName + " " + data.date);
    const filled = found.cells.filter(c => c.value !== "");
    if (filled.length) {
      throw new Error("Slot already booked on " + sheetName + " " + data.date + " Court " + data.courtId + " " + slots[si] + " (by " + filled.map(c => c.value).join(", ") + ")");
    }
    if (found.cells.length < names.length) {
      throw new Error("Court " + data.courtId + " has only " + found.cells.length + " cells for " + slots.length + " player(s) at " + slots[si]);
    }
    perSlotCapacity.push(found.cells.length);
    // Assign one cell per player, filling the slot's cells in order.
    for (let ni = 0; ni < names.length; ni++) {
      const cell = found.cells[ni % found.cells.length];
      plan.push({ row: cell.row, col: cell.col, name: names[ni], slot: slots[si] });
    }
  }

  // Write everything, rolling back on failure so half a group is never saved.
  const written = [];
  try {
    for (let i = 0; i < plan.length; i++) {
      sh.getRange(plan[i].row + 1, plan[i].col + 1).setValue(plan[i].name);
      written.push({ row: plan[i].row, col: plan[i].col });
    }
  } catch (err) {
    for (let i = 0; i < written.length; i++) {
      try { sh.getRange(written[i].row + 1, written[i].col + 1).clearContent(); } catch (e) {}
    }
    throw new Error("Booking failed and was rolled back: " + err.toString());
  }
  return true;
}

// Atomic group cancellation: every requested name is removed from every
// requested 30-minute part. Fails (without changing anything) if none of the
// names is found at all.
function cancelGroup(ss, data) {
  const sheetName = locationToSheet(data.location);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Sheet not found: " + sheetName);
  const values = sh.getDataRange().getValues();
  const names = cleanNames(data.names);
  const slots = cleanSlots(data.slots);
  if (!names.length) throw new Error("No players given");
  if (!slots.length) throw new Error("No time slots given");

  let foundAny = false;
  const toClear = [];
  for (let si = 0; si < slots.length; si++) {
    const startNorm = normalizeTime(slotStartLabel(slots[si]));
    const found = locateSlotCells(values, String(data.date), data.courtId, startNorm);
    if (!found) continue; // slot missing on this date -> nothing to remove
    for (let ci = 0; ci < found.cells.length; ci++) {
      const cell = found.cells[ci];
      if (cell.value !== "" && names.indexOf(cell.value) !== -1) {
        toClear.push({ row: cell.row, col: cell.col });
        foundAny = true;
      }
    }
  }
  if (!foundAny) {
    throw new Error("No booking found to cancel on " + sheetName + " " + data.date + " Court " + data.courtId);
  }
  for (let i = 0; i < toClear.length; i++) {
    sh.getRange(toClear[i].row + 1, toClear[i].col + 1).clearContent();
  }
  return true;
}

// Single-name toggle kept for older app builds (span-aware).
function toggleGridReservation(ss, data) {
  const sheetName = locationToSheet(data.location);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Sheet not found: " + sheetName);
  const values = sh.getDataRange().getValues();
  const startNorm = normalizeTime(slotStartLabel(String(data.slot)));
  const name = String(data.name).trim();
  const found = locateSlotCells(values, String(data.date), data.courtId, startNorm);
  if (!found) throw new Error("Time slot not found: " + data.slot + " on " + sheetName + " " + data.date);

  // If the name already exists somewhere in this court's cells, remove it.
  let wrote = false;
  for (let i = 0; i < found.cells.length; i++) {
    if (found.cells[i].value === name) {
      sh.getRange(found.cells[i].row + 1, found.cells[i].col + 1).clearContent();
      return true;
    }
  }
  // Otherwise write into the first empty cell of this court's span.
  for (let i = 0; i < found.cells.length; i++) {
    if (found.cells[i].value === "") {
      sh.getRange(found.cells[i].row + 1, found.cells[i].col + 1).setValue(name);
      wrote = true;
      break;
    }
  }
  if (!wrote) throw new Error("Slot full at " + sheetName + " " + data.date + " Court " + data.courtId + " " + data.slot);
  return true;
}
