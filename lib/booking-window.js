// lib/booking-window.js - Booking window rules (America/Los_Angeles).
//
// Reservations may only be booked or changed for TODAY and TOMORROW in
// America/Los_Angeles (San Diego) time, regardless of the device or server
// timezone. Completed (already-ended) 30-minute slots cannot be booked or
// canceled; the CURRENT 30-minute slot stays available until it ends.
//
// These helpers are shared by the UI (pages/index.js, components/CourtSchedule.js)
// and the Next.js API (pages/api/reservations.js). CourtzAppsScript.gs carries a
// mirrored copy of the same rules so the backend rechecks them under its write
// lock.

import { slotRange } from './session-rules.js'

const LA_OFFSET_STANDARD_MINUTES = -8 * 60 // PST (UTC-8)
const LA_OFFSET_DST_MINUTES = -7 * 60 // PDT (UTC-7)

// US DST: from 2:00 AM on the second Sunday in March until 2:00 AM on the
// first Sunday in November.
export function getLAOffsetMinutes(utcDate) {
  const year = utcDate.getUTCFullYear()
  const marchFirst = new Date(Date.UTC(year, 2, 1))
  // Day-of-month of the first Sunday in March:
  const firstSundayMarchDay = 1 + ((7 - marchFirst.getUTCDay()) % 7)
  const dstStartUtc = Date.UTC(year, 2, firstSundayMarchDay + 7, 10) // 2 AM PST = 10:00 UTC
  const novemberFirst = new Date(Date.UTC(year, 10, 1))
  const firstSundayNovDay = 1 + ((7 - novemberFirst.getUTCDay()) % 7)
  const dstEndUtc = Date.UTC(year, 10, firstSundayNovDay, 9) // 2 AM PDT = 09:00 UTC
  const t = utcDate.getTime()
  return t >= dstStartUtc && t < dstEndUtc ? LA_OFFSET_DST_MINUTES : LA_OFFSET_STANDARD_MINUTES
}

// Splits an instant into its America/Los_Angeles wall-clock parts.
export function getLAParts(date = new Date()) {
  const offsetMinutes = getLAOffsetMinutes(date)
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
    offsetMinutes,
  }
}

// "YYYY-MM-DD" for an instant in America/Los_Angeles.
export function getLADateKey(date = new Date()) {
  const p = getLAParts(date)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// Minutes since midnight (0-1439) in America/Los_Angeles for an instant.
export function getLAMinutesOfDay(date = new Date()) {
  const p = getLAParts(date)
  return p.hours * 60 + p.minutes
}

// The only two days that can be booked or changed, as "YYYY-MM-DD" keys.
export function getBookingWindowKeys(now = new Date()) {
  const p = getLAParts(now)
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  // Step over calendar dates at UTC noon: noon UTC always falls inside the
  // same LA calendar date, which keeps this correct across DST transitions
  // (where a day is 23 or 25 hours long and "+24h" could stay on today).
  const tomorrowParts = getLAParts(new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 12)))
  const tomorrow = `${tomorrowParts.year}-${String(tomorrowParts.month).padStart(2, '0')}-${String(tomorrowParts.day).padStart(2, '0')}`
  return { today, tomorrow }
}

// True when a "YYYY-MM-DD" key falls inside the bookable window (today or
// tomorrow in Los Angeles).
export function isBookableDateKey(dateKey, now = new Date()) {
  const { today, tomorrow } = getBookingWindowKeys(now)
  return dateKey === today || dateKey === tomorrow
}

// A slot ("8:00 AM–8:30 AM") is completed once its END time has passed.
// The current 30-minute slot stays available: at 1:15 PM the 1:00–1:30 PM
// slot has not ended yet, while 12:30–1:00 PM has.
export function isSlotCompleted(slotLabel, dateKey, now = new Date()) {
  const { today } = getBookingWindowKeys(now)
  if (dateKey < today) return true // every slot on a past day has ended
  if (dateKey > today) return false // tomorrow: nothing has ended yet
  const range = slotRange(slotLabel)
  if (!range) return true // unparseable slot on today: treat as ended (safe)
  return getLAMinutesOfDay(now) >= range.end
}

export class BookingWindowError extends Error {}

// Throws BookingWindowError when a booking/cancellation request falls outside
// the window. Used by the Next.js API. Returns the resolved window info on
// success.
export function validateBookingWindow({ date, slots = [], now = new Date() }) {
  const dateKey = String(date)
  const { today, tomorrow } = getBookingWindowKeys(now)
  if (dateKey !== today && dateKey !== tomorrow) {
    throw new BookingWindowError(
      `This day is view only. Reservations can only be booked or changed for ${today} or ${tomorrow} (America/Los_Angeles).`,
    )
  }
  const completed = slots.filter((slot) => isSlotCompleted(slot, dateKey, now))
  if (completed.length) {
    throw new BookingWindowError(
      `These times have already ended: ${completed.join(', ')}. Ended time slots cannot be booked or canceled; the current 30-minute slot stays available until it ends.`,
    )
  }
  return { today, tomorrow, nowMinutes: getLAMinutesOfDay(now) }
}
