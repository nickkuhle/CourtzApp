import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getLAOffsetMinutes,
  getLAParts,
  getLADateKey,
  getLAMinutesOfDay,
  getBookingWindowKeys,
  isBookableDateKey,
  isSlotCompleted,
  validateBookingWindow,
  BookingWindowError,
} from '../lib/booking-window.js'

// Helpers: build instants in UTC and express expected LA times.
function utc(year, month, day, hours, minutes) {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes))
}

test('America/Los_Angeles offset: PDT in summer, PST in winter', () => {
  // Aug 12 2026 is in PDT (UTC-7).
  assert.equal(getLAOffsetMinutes(utc(2026, 8, 12, 20, 15)), -7 * 60)
  // Jan 15 2026 is in PST (UTC-8).
  assert.equal(getLAOffsetMinutes(utc(2026, 1, 15, 12, 0)), -8 * 60)
})

test('LA date key rolls over at UTC midnight, not in device timezone', () => {
  // 2026-08-12T06:59Z is 2026-08-11 23:59 PDT.
  assert.equal(getLADateKey(utc(2026, 8, 12, 6, 59)), '2026-08-11')
  // 2026-08-12T07:00Z is 2026-08-12 00:00 PDT.
  assert.equal(getLADateKey(utc(2026, 8, 12, 7, 0)), '2026-08-12')
  // Winter: 2026-01-15T07:59Z is 2026-01-14 23:59 PST.
  assert.equal(getLADateKey(utc(2026, 1, 15, 7, 59)), '2026-01-14')
  assert.equal(getLADateKey(utc(2026, 1, 15, 8, 0)), '2026-01-15')
})

test('getBookingWindowKeys returns today and tomorrow in Los Angeles', () => {
  // 1:15 PM on Aug 12 2026 in LA = 20:15 UTC.
  const now = utc(2026, 8, 12, 20, 15)
  const { today, tomorrow } = getBookingWindowKeys(now)
  assert.equal(today, '2026-08-12')
  assert.equal(tomorrow, '2026-08-13')
  // Near the fall-back DST transition (Nov 1 2026, 00:30 PDT): +24h would land
  // on the same LA date, but tomorrow must still be Nov 2.
  const fallBack = utc(2026, 11, 1, 7, 30)
  const window = getBookingWindowKeys(fallBack)
  assert.equal(window.today, '2026-11-01')
  assert.equal(window.tomorrow, '2026-11-02')
})

test('isBookableDateKey accepts only today and tomorrow', () => {
  const now = utc(2026, 8, 12, 20, 15) // 1:15 PM PDT
  assert.equal(isBookableDateKey('2026-08-12', now), true)
  assert.equal(isBookableDateKey('2026-08-13', now), true)
  assert.equal(isBookableDateKey('2026-08-11', now), false)
  assert.equal(isBookableDateKey('2026-08-14', now), false)
})

test('isSlotCompleted: current 30-minute slot stays available; earlier slots ended', () => {
  const now = utc(2026, 8, 12, 20, 15) // 1:15 PM LA
  assert.equal(getLAMinutesOfDay(now), 13 * 60 + 15)
  // 1:00–1:30 PM is still available at 1:15 PM.
  assert.equal(isSlotCompleted('1:00 PM–1:30 PM', '2026-08-12', now), false)
  // 12:30–1:00 PM has already ended.
  assert.equal(isSlotCompleted('12:30 PM–1:00 PM', '2026-08-12', now), true)
  // The next slot (1:30–2:00 PM) is obviously still available.
  assert.equal(isSlotCompleted('1:30 PM–2:00 PM', '2026-08-12', now), false)
  // At exactly 1:30 PM the 1:00–1:30 slot has ended.
  assert.equal(isSlotCompleted('1:00 PM–1:30 PM', '2026-08-12', utc(2026, 8, 12, 20, 30)), true)
  // Nothing has ended yet tomorrow.
  assert.equal(isSlotCompleted('8:00 AM–8:30 AM', '2026-08-13', now), false)
  // Every slot on a past day is completed.
  assert.equal(isSlotCompleted('5:30 PM–6:00 PM', '2026-08-11', now), true)
})

test('validateBookingWindow rejects past/future dates and ended slots', () => {
  const now = utc(2026, 8, 12, 20, 15) // 1:15 PM LA
  // Today's current slot passes.
  const info = validateBookingWindow({ date: '2026-08-12', slots: ['1:00 PM–1:30 PM'], now })
  assert.equal(info.today, '2026-08-12')
  // Past date rejected.
  assert.throws(
    () => validateBookingWindow({ date: '2026-08-11', slots: ['9:00 AM–9:30 AM'], now }),
    (err) => err instanceof BookingWindowError && /view only/i.test(err.message),
  )
  // Day after tomorrow rejected.
  assert.throws(
    () => validateBookingWindow({ date: '2026-08-14', slots: ['9:00 AM–9:30 AM'], now }),
    BookingWindowError,
  )
  // Ended slot on today rejected.
  assert.throws(
    () => validateBookingWindow({ date: '2026-08-12', slots: ['12:30 PM–1:00 PM'], now }),
    (err) => err instanceof BookingWindowError && /already ended/i.test(err.message),
  )
  // Tomorrow: everything passes.
  assert.doesNotThrow(() => validateBookingWindow({ date: '2026-08-13', slots: ['8:00 AM–8:30 AM'], now }))
})

test('LA parts around DST transitions stay correct', () => {
  // Spring forward 2026: Mar 8 2026 2:00 AM PST -> 3:00 AM PDT (10:00 UTC).
  // 17:30 UTC on Mar 8 is 10:30 AM PDT (offset is already -7h).
  const p = getLAParts(utc(2026, 3, 8, 17, 30))
  assert.equal(p.month, 3)
  assert.equal(p.day, 8)
  assert.equal(p.hours, 10)
  assert.equal(p.minutes, 30)
  assert.equal(p.offsetMinutes, -7 * 60)
})
