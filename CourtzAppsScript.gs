// Courtz App - Google Sheets Backend (GRID VERSION for actual sheet)
// SHEET_ID: 1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je  (TEST COPY - do not point at the real sheet)
// Bump SCRIPT_VERSION on every edit so the app (and you) can verify which
// deployment is actually live via WEBAPP_URL?action=ping.
// 2.1.1: the 2-session-per-day limit now compares LOCATION as well as court
// and start time, so a same-numbered court at another venue can no longer be
// used to dodge the maximum.
const SCRIPT_VERSION = "2.1.1";
const SHEET_ID = "1U3TcsbIhQ9lxeo0_LtHYTldIqbkWg2Je";
const DEFAULT_TOURNAMENT_YEAR = "2026";
const LOCATION_MAP = {
  "Barnes TC": "Barnes Tennis Center",
  "Peninsula Tennis Club": "Peninsula Tennis Club",
  "Point Loma Nazarene College": "Point Loma Nazarene College",
  "Pacific Beach TC": "Pacific Beach Tennis Club",
  "Balboa Tennis": "Balboa Tennis Center",
  "USD": "USD"
};
const COURT_TABS = Object.keys(LOCATION_MAP);
// The three practice sites shown by default. USD, Balboa and Pacific Beach are
// match-play sites: they stay hidden in the app unless the desk adds them
// deliberately, and their reservations never count toward the practice-session
// limit unless they have been added.
const PRACTICE_DEFAULTS = ["Barnes Tennis Center", "Peninsula Tennis Club", "Point Loma Nazarene College"];
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
    const lock = LockService.getDocumentLock();
    lock.waitLock(15000);
    try {
      if (data.action === "bookGroup") {
        // data: {location, date, courtId, slots: [], names: [], staffApproved?, practiceLocations?}
        validateBookingForWrite(ss, "book", data, data.slots, data.names);
        bookGroup(ss, data);
        return jsonResponse({ success: true, version: SCRIPT_VERSION, action: "bookGroup" });
      }
      if (data.action === "cancelGroup") {
        // data: {location, date, courtId, slots: [], names: []}
        validateBookingForWrite(ss, "cancel", data, data.slots, data.names);
        cancelGroup(ss, data);
        return jsonResponse({ success: true, version: SCRIPT_VERSION, action: "cancelGroup" });
      }
      if (data.action === "toggleReservation") {
        // Single-player toggle kept for older app builds. A toggle can be
        // either a booking or a cancellation, so only the booking-window rules
        // (date + ended slots) are applied.
        // data: {location, date, courtId, slot, name, staffApproved?, practiceLocations?}
        validateBookingForWrite(ss, "cancel", data, [data.slot], [data.name]);
        toggleGridReservation(ss, data);
        return jsonResponse({ success: true, version: SCRIPT_VERSION, action: "toggleReservation" });
      }
    } finally {
      lock.releaseLock();
    }
    return jsonResponse({ success: false, version: SCRIPT_VERSION, error: "Unknown POST action" });
  } catch (err) {
    if (err && err.isRulesError) {
      return jsonResponse({ success: false, version: SCRIPT_VERSION, error: err.message, code: err.code });
    }
    return jsonResponse({ success: false, version: SCRIPT_VERSION, error: err.toString(), stack: err.stack });
  }
}

// Re-checks the booking-window and session rules INSIDE the write lock, on the
// reservations currently stored in the Sheet, so stale browser data can never
// bypass them. Mirrors validateBooking in lib/booking-rules.js.
function validateBookingForWrite(ss, action, data, slots, names) {
  const reservations = getAllReservations(ss);
  const validation = validateBookingGS({
    action: action,
    location: data.location,
    date: String(data.date),
    courtId: data.courtId,
    slots: slots,
    names: names,
    staffApproved: Boolean(data.staffApproved),
    reservations: reservations,
    practiceLocations: data.practiceLocations
  });
  if (!validation.ok) {
    throw rulesError(validation.error, validation.isSessionLimitError ? "SESSION_LIMIT" : "BOOKING_RULES");
  }
  if (validation.warnings.length && !data.staffApproved) {
    throw rulesError(
      "This booking is within one hour of another practice session. Tournament staff approval is required to continue.",
      "STAFF_APPROVAL_REQUIRED"
    );
  }
}

function rulesError(message, code) {
  const err = new Error(message);
  err.isRulesError = true;
  err.code = code;
  return err;
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
function readFullSchedule(ss) {
  const all = {};
  const datesSet = {};
  const courtsByDate = {};
  COURT_TABS.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const values = sh.getDataRange().getValues();
    const parsed = parseGridValues(values, name);
    const location = LOCATION_MAP[name] || name;

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

  const roster = getRosterData(ss).map(r => r.Name || r.name).filter(Boolean);
  const days = Object.keys(datesSet).sort();

  // v2.1: 30-minute slots whose end time has already passed (America/Los_Angeles)
  // are view-only, so they are no longer exposed as bookable/cancellable.
  for (const k in all) {
    const dateKey = String(k).split("|")[1];
    for (const slot in all[k]) {
      if (isSlotCompleted(dateKey, slot)) delete all[k][slot];
    }
    if (!Object.keys(all[k]).length) delete all[k];
  }

  // v2.1: per-player practice-session metadata for the three default practice
  // locations, so the UI can show how many sessions a player has used on each
  // day. Hidden match-play sites are deliberately NOT included.
  const practiceSessions = {};
  days.forEach(d => {
    practiceSessions[d] = {};
    PRACTICE_DEFAULTS.forEach(loc => {
      const sessions = existingPlayerSessionsGS(all, d, null, PRACTICE_DEFAULTS);
      practiceSessions[d][loc] = sessions
        .filter(s => s.location === loc)
        .map(s => ({ player: s.player, court: s.court, start: s.start, slots: s.slots }));
    });
  });

  return {
    roster: roster,
    reservations: all,
    days: days,
    courtsByDate: courtsByDate,
    locations: COURT_TABS.map(name => LOCATION_MAP[name] || name),
    practiceSessions: practiceSessions,
    defaultPracticeLocations: PRACTICE_DEFAULTS
  };
}

// Backwards-compatible reservations-only read.
function getAllReservations(ss) {
  const all = {};
  COURT_TABS.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
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

// --- BOOKING RULES (mirrors lib/booking-rules.js - keep in sync) ---
// 1. Bookings/cancellations are only allowed for today and tomorrow in
//    America/Los_Angeles (San Diego), regardless of device/server timezone.
// 2. A 30-minute slot is finished once its END time has passed - the current
//    30-minute slot stays available (at 1:15 PM, 1:00-1:30 PM is still open).
// 3. A player may hold at most TWO practice sessions per day across every
//    active practice location. Barnes: every occupied 30-minute slot is one
//    session. Other locations: for the same player/date/location/court, two
//    immediately consecutive 30-minute slots group into ONE 60-minute session
//    (at most two slots per session). Proximity checks compare session STARTS,
//    never the two internal halves of one 60-minute session.
// 4. A new session back-to-back with another, or starting within one hour of
//    another session's start, needs explicit tournament-staff approval. The
//    staff override bypasses ONLY that warning - never the 2-session maximum.

const LA_RULES = [
  // [startMsUtc inclusive, endMsUtc exclusive, offsetMinutes] (DST-aware 2026)
  [1767225600000, 1772964000000, -480], // 2026-01-01T00:00Z..2026-03-08T10:00Z PST
  [1772964000000, 1793523600000, -420], // 2026-03-08T10:00Z..2026-11-01T09:00Z PDT
  [1793523600000, 1798761600000, -480]  // 2026-11-01T09:00Z..2027-01-01T00:00Z PST
];
const MAX_SESSIONS_PER_DAY = 2;

function laOffsetMinutes(msUtc) {
  if (!isFinite(msUtc)) return -480;
  for (let i = 0; i < LA_RULES.length; i++) {
    if (msUtc >= LA_RULES[i][0] && msUtc < LA_RULES[i][1]) return LA_RULES[i][2];
  }
  return -480;
}

function laNow() {
  const nowMs = Date.now();
  const totalMinutes = Math.floor((nowMs + laOffsetMinutes(nowMs) * 60000) / 60000);
  const d = new Date(totalMinutes * 60000);
  const y = d.getUTCFullYear();
  const m = ("0" + (d.getUTCMonth() + 1)).slice(-2);
  const day = ("0" + d.getUTCDate()).slice(-2);
  return { dateKey: y + "-" + m + "-" + day, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function dateKeyToUtcMinutes(dateKey) {
  const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 60000;
}

function isBookableDay(dateKey) {
  const target = dateKeyToUtcMinutes(dateKey);
  const today = dateKeyToUtcMinutes(laNow().dateKey);
  if (isNaN(target) || isNaN(today)) return false;
  const diff = Math.round((target - today) / (24 * 60));
  return diff === 0 || diff === 1;
}

function isSlotCompleted(dateKey, slotLabel) {
  const start = timeToMinutes(slotStartLabel(slotLabel));
  if (isNaN(start)) return true;
  const end = start + 30;
  const now = laNow();
  if (dateKey < now.dateKey) return true;
  if (dateKey > now.dateKey) return false;
  return end <= now.minutes;
}

function isBarnesLocationGS(location) {
  return /barnes/i.test(String(location || ""));
}

function cleanPracticeLocationsGS(list) {
  if (!Array.isArray(list)) return PRACTICE_DEFAULTS.slice();
  const out = [];
  list.forEach(l => {
    const v = String(l).trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  });
  return out.length ? out : PRACTICE_DEFAULTS.slice();
}

// Groups existing Sheet reservations into the sessions that count toward the
// limit (see the header comment above). Returns
// [{ player, location, court, start, slots }].
function existingPlayerSessionsGS(reservations, dateKey, name, practiceLocations) {
  const active = {};
  cleanPracticeLocationsGS(practiceLocations).forEach(l => { active[l] = true; });
  const groups = [];
  const seen = {};

  for (const key in reservations) {
    const parts = String(key).split("|");
    const location = parts[0], date = parts[1], court = parts[2];
    if (!location || !date || !court) continue;
    if (date !== dateKey) continue;
    if (!active[location]) continue;
    const slots = reservations[key];
    if (!slots || typeof slots !== "object") continue;

    const byPlayer = {};
    for (const slotLabel in slots) {
      const start = timeToMinutes(slotStartLabel(slotLabel));
      if (isNaN(start)) continue;
      const names = Array.isArray(slots[slotLabel]) ? slots[slotLabel] : [slots[slotLabel]];
      names.forEach(raw => {
        const n = String(raw).trim();
        if (!n) return;
        if (!byPlayer[n]) byPlayer[n] = [];
        byPlayer[n].push({ start: start, slotLabel: slotLabel });
      });
    }

    for (const player in byPlayer) {
      if (name && player !== name) continue;
      const sorted = byPlayer[player].slice().sort(function (a, b) { return a.start - b.start; });
      const sessions = [];
      let current = null;
      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        if (isBarnesLocationGS(location)) {
          sessions.push({ location: location, court: court, start: entry.start, slots: [entry.slotLabel] });
          continue;
        }
        if (current && entry.start === current.start + 30 && current.slots.length < 2) {
          current.slots.push(entry.slotLabel);
        } else {
          current = { location: location, court: court, start: entry.start, slots: [entry.slotLabel] };
          sessions.push(current);
        }
      }
      sessions.forEach(function (s) {
        const id = player + "|" + location + "|" + court + "|" + s.start;
        if (seen[id]) return;
        seen[id] = true;
        groups.push({ player: player, location: s.location, court: s.court, start: s.start, slots: s.slots });
      });
    }
  }
  return groups;
}

// The proposed NEW booking as one session (a 60-minute non-Barnes booking is
// ONE session even though it occupies two 30-minute Sheet slots).
function proposedSessionGS(location, date, courtId, slots) {
  const cleaned = [];
  (slots || []).forEach(s => {
    const v = String(s).trim();
    if (v && cleaned.indexOf(v) === -1) cleaned.push(v);
  });
  let start = null;
  for (let i = 0; i < cleaned.length; i++) {
    const sm = timeToMinutes(slotStartLabel(cleaned[i]));
    if (!isNaN(sm)) { start = sm; break; }
  }
  return { location: location, date: date, courtId: String(courtId), slots: cleaned, start: start };
}

function validateBookingGS(opts) {
  const action = opts.action;
  const location = opts.location;
  const date = String(opts.date);
  const courtId = opts.courtId;
  const staffApproved = Boolean(opts.staffApproved);
  const reservations = opts.reservations || {};
  const practiceLocations = opts.practiceLocations;

  const cleanedLocation = String(location || "").trim();
  const cleanedNames = [];
  (opts.names || []).forEach(n => {
    const v = String(n).trim();
    if (v && cleanedNames.indexOf(v) === -1) cleanedNames.push(v);
  });
  const cleanedSlots = [];
  (opts.slots || []).forEach(s => {
    const v = String(s).trim();
    if (v && cleanedSlots.indexOf(v) === -1) cleanedSlots.push(v);
  });

  if (!cleanedNames.length) return { ok: false, error: "No players given" };
  if (!cleanedSlots.length) return { ok: false, error: "No time slots given" };
  if (!isBookableDay(date)) {
    return { ok: false, error: "Bookings and cancellations are only allowed for today and tomorrow (view-only for other days)." };
  }
  for (let i = 0; i < cleanedSlots.length; i++) {
    if (isSlotCompleted(date, cleanedSlots[i])) {
      return { ok: false, error: "The time slot " + cleanedSlots[i] + " has already ended and can no longer be changed." };
    }
  }

  const warnings = [];
  const hardLimitErrors = [];

  for (let p = 0; p < cleanedNames.length; p++) {
    const player = cleanedNames[p];
    const existing = existingPlayerSessionsGS(reservations, date, player, practiceLocations);
    const proposed = proposedSessionGS(location, date, courtId, cleanedSlots);
    if (proposed.start === null) {
      return { ok: false, error: "The time slot \"" + cleanedSlots.join("\", \"") + "\" could not be read." };
    }

    const all = existing.slice();
    let sameIndex = -1;
    // "Same session" means same LOCATION, same court and same start time.
    // Comparing only court + start let a player dodge the 2-session maximum by
    // booking a same-numbered court at a different venue (e.g. Barnes Court 4
    // vs Peninsula Court 4), because the new session was never counted.
    for (let i = 0; i < all.length; i++) {
      if (all[i].location === cleanedLocation && String(all[i].court) === proposed.courtId && all[i].start === proposed.start) { sameIndex = i; break; }
    }
    let proposedSessionObj = null;
    if (sameIndex === -1) {
      proposedSessionObj = { location: location, court: proposed.courtId, start: proposed.start, slots: proposed.slots.slice() };
      all.push(proposedSessionObj);
    }

    if (action === "book") {
      if (all.length > MAX_SESSIONS_PER_DAY) {
        hardLimitErrors.push(player + " would have " + all.length + " practice sessions on " + date + "; the maximum is " + MAX_SESSIONS_PER_DAY + ".");
        continue;
      }
      let closeSession = null;
      for (let i = 0; i < all.length; i++) {
        if (all[i] !== proposedSessionObj && all[i].start !== null && proposed.start !== null && Math.abs(all[i].start - proposed.start) <= 60) {
          closeSession = all[i];
          break;
        }
      }
      if (closeSession && !staffApproved) {
        warnings.push(player + "'s new " + location + " session is within one hour of another practice session (staff approval required).");
      }
    }
  }

  if (hardLimitErrors.length) {
    return { ok: false, error: hardLimitErrors.join(" "), warnings: warnings, hardLimitErrors: hardLimitErrors, isSessionLimitError: true };
  }
  return { ok: true, error: null, warnings: warnings, hardLimitErrors: [] };
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
      throw new Error("Court " + data.courtId + " has only " + found.cells.length + " cells for " + names.length + " player(s) at " + slots[si]);
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
