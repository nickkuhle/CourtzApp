import assert from 'node:assert/strict'
import test from 'node:test'

import parseGridValues, {
  parseSheetDate,
  normalizeTime,
  addMinutes,
  computeCourtSpans,
  findSlotCells,
  findSlotCellRanges,
} from '../lib/sheets-grid-parser.js'

// Realistic Barnes TC grid: each court spans TWO columns (merged header cells,
// e.g. ["", 4, "", 5, "", 6]), every 30-min slot uses 2 physical rows, and
// every non-empty cell inside a court's span belongs to that court.
function barnesFixture() {
  const values = []
  const pushRow = (cells) => values.push(cells)

  pushRow(['BARNES TENNIS CENTER address:', '4490 West Point Loma Blvd.', '', '', '', '', ''])
  // Mon Aug 10 - courts 4 and 5
  pushRow(['Mon Aug 10', '', '', '', '', '', ''])
  pushRow(['', 4, '', 5, '', '', ''])
  pushRow(['8:00 AM', 'Zhou, Zhongyi', '', 'Neves, Lucia', '', '', ''])
  pushRow(['', 'Shi, Kelly', '', 'Mateus, Gabriela', '', '', ''])
  pushRow(['8:30 AM', 'Holness, Dasha', 'Bergeson, Lyla', 'Seagraves, Katelyn', 'Groslimond, Lily', '', ''])
  pushRow(['', 'Brereton, Gabrielle', 'Dowdell, Emi', 'Goyen, Lyla', 'Rodriguez, Amanda', '', ''])
  pushRow(['9:00 AM', '', '', '', '', '', ''])
  pushRow(['', '', '', '', '', '', ''])
  // Tue Aug 11 - courts 4 and 5
  pushRow(['Tue Aug 11', '', '', '', '', '', ''])
  pushRow(['', 4, '', 5, '', '', ''])
  pushRow(['8:00 AM', 'Andreoli, Mia', '', 'Shue, Valerie', '', '', ''])
  pushRow(['', '', '', '', '', '', ''])
  // Wed Aug 12 - courts 4, 5 AND the new court 6 (empty - must still appear)
  pushRow(['Wed Aug 12', '', '', '', '', '', ''])
  pushRow(['', 4, '', 5, '', 6, ''])
  pushRow(['8:00 AM', '', '', '', '', '', ''])
  pushRow(['', '', '', '', '', '', ''])
  pushRow(['8:30 AM', '', '', '', '', '', ''])
  pushRow(['', '', '', '', '', '', ''])
  // Thu Aug 13 - court 6 used (names in its SECOND column) - the multi-column fix
  pushRow(['Thu Aug 13', '', '', '', '', '', ''])
  pushRow(['', 4, '', 5, '', 6, ''])
  pushRow(['8:00 AM', '', '', '', '', '', ''])
  pushRow(['', '', '', '', '', '', ''])
  pushRow(['8:30 AM', '', '', '', '', 'Waters, Eadan', 'Chen, Alice'])
  pushRow(['', '', '', '', '', 'Reeves, Sam', ''])
  return values
}

test('parseSheetDate handles the sheet formats', () => {
  assert.equal(parseSheetDate('Mon Aug 10'), '2026-08-10')
  assert.equal(parseSheetDate('Wed Aug 12'), '2026-08-12')
  assert.equal(parseSheetDate('Wednesday, August 12'), '2026-08-12')
  assert.equal(parseSheetDate('August 12'), '2026-08-12')
  assert.equal(parseSheetDate('8/12/2026'), '2026-08-12')
  assert.equal(parseSheetDate('8/12'), '2026-08-12')
  assert.equal(parseSheetDate('2026-08-12'), '2026-08-12')
  assert.equal(parseSheetDate('Wed Aug 12, 2026'), '2026-08-12')
  assert.equal(parseSheetDate(new Date(2026, 7, 12)), '2026-08-12')
  assert.equal(parseSheetDate(new Date(1899, 0, 1, 8, 0)), null) // time value
  assert.equal(parseSheetDate('8:00 AM'), null)
})

test('normalizeTime and addMinutes keep the slot label format', () => {
  assert.equal(normalizeTime('8:00 AM'), '8:00 AM')
  assert.equal(normalizeTime('8:00am'), '8:00 AM')
  assert.equal(normalizeTime('8:00'), '8:00 AM')
  assert.equal(normalizeTime('14:00'), '2:00 PM')
  assert.equal(addMinutes('8:30 AM', 30), '9:00 AM')
  assert.equal(addMinutes('12:30 PM', 30), '1:00 PM')
})

test('computeCourtSpans maps every court to all of its columns', () => {
  // merged 2-column headers: number once, next number marks the span end
  const spans = computeCourtSpans([{ n: 4, idx: 1 }, { n: 5, idx: 3 }, { n: 6, idx: 5 }])
  assert.deepEqual(spans.map(s => s.court), [4, 5, 6])
  assert.deepEqual(spans[0].cols, [1, 2]) // court 4 spans B..C
  assert.deepEqual(spans[1].cols, [3, 4]) // court 5 spans D..E
  assert.deepEqual(spans[2].cols, [5, 6]) // last court gets the standard width (F..G)

  // unmerged single-column headers
  const single = computeCourtSpans([{ n: 1, idx: 1 }, { n: 2, idx: 2 }, { n: 3, idx: 3 }])
  assert.deepEqual(single.map(s => s.cols), [[1], [2], [3]])
})

test('reads every player-name cell belonging to a court (multi-column courts)', () => {
  const { reservations } = parseGridValues(barnesFixture(), 'Barnes TC')

  // 8:30 AM Mon: 4 players on court 4 spread over columns B and C, both rows
  assert.deepEqual(
    reservations['Barnes Tennis Center|2026-08-10|4']['8:30 AM–9:00 AM'],
    ['Holness, Dasha', 'Bergeson, Lyla', 'Brereton, Gabrielle', 'Dowdell, Emi'],
  )
  assert.deepEqual(
    reservations['Barnes Tennis Center|2026-08-10|5']['8:30 AM–9:00 AM'],
    ['Seagraves, Katelyn', 'Groslimond, Lily', 'Goyen, Lyla', 'Rodriguez, Amanda'],
  )
  // Single-column usage still works
  assert.deepEqual(reservations['Barnes Tennis Center|2026-08-10|4']['8:00 AM–8:30 AM'], ['Zhou, Zhongyi', 'Shi, Kelly'])
  assert.deepEqual(reservations['Barnes Tennis Center|2026-08-10|5']['8:00 AM–8:30 AM'], ['Neves, Lucia', 'Mateus, Gabriela'])
})

test('Wednesday reservations appear when the parser used to drop them', () => {
  const { reservations } = parseGridValues(barnesFixture(), 'Barnes TC')
  // Wed Aug 12 court 6: names placed in the SECOND column of the court's span
  // (column G / index 6) - the old one-column parser never saw them.
  assert.deepEqual(
    reservations['Barnes Tennis Center|2026-08-13|6']['8:30 AM–9:00 AM'],
    ['Waters, Eadan', 'Chen, Alice', 'Reeves, Sam'],
  )
})

test('discovers every date including dates with no reservations', () => {
  const { dates } = parseGridValues(barnesFixture(), 'Barnes TC')
  assert.deepEqual(dates, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'])
})

test('discovers courts per date including empty courts (Barnes Court 6)', () => {
  const { courtsByDate } = parseGridValues(barnesFixture(), 'Barnes TC')
  assert.deepEqual(courtsByDate['2026-08-10']['Barnes Tennis Center'], [4, 5])
  assert.deepEqual(courtsByDate['2026-08-12']['Barnes Tennis Center'], [4, 5, 6]) // empty court 6 still appears
  assert.deepEqual(courtsByDate['2026-08-13']['Barnes Tennis Center'], [4, 5, 6])
})

test('findSlotCells locates every cell of a court slot for writes', () => {
  const values = barnesFixture()
  const cells = findSlotCells(values, '2026-08-13', 6, '8:30 AM')
  assert.ok(cells)
  assert.deepEqual(cells.cols, [5, 6]) // F..G
  assert.deepEqual(cells.cells.map(c => c.value), ['Waters, Eadan', 'Chen, Alice', 'Reeves, Sam', ''])
})

test('findSlotCellRanges returns A1 references for booking writes', () => {
  const values = barnesFixture()
  const ranges = findSlotCellRanges(values, '2026-08-13', 6, ['8:30 AM–9:00 AM'])
  assert.ok(ranges)
  // Thu Aug 13's 8:30 AM row is row index 23 -> sheet row 24, continuation row 25
  assert.deepEqual(ranges.map(r => r.a1), ['F24', 'G24', 'F25', 'G25'])
})

test('a date in the middle of a copied sheet that says 2001 maps to 2026', () => {
  const values = barnesFixture()
  values[19] = ['2001-08-13', '', '', '', '', '', ''] // Thu Aug 13 copied with hidden year
  const { dates } = parseGridValues(values, 'Barnes TC')
  assert.ok(dates.includes('2026-08-13'))
  assert.ok(!dates.includes('2001-08-13'))
})

test('handles "Court N" text labels in the header row', () => {
  const values = [
    ['Sat Aug 8', '', '', '', ''],
    ['', 'Court 1', 'Court 2', '', ''],
    ['8:00 AM', 'Abbey, Stephanie', '', '', ''],
    ['', '', 'Zhou, Zhongyi', '', ''],
  ]
  const { reservations, courtsByDate } = parseGridValues(values, 'Peninsula Tennis Club')
  assert.deepEqual(courtsByDate['2026-08-08']['Peninsula Tennis Club'], [1, 2])
  assert.deepEqual(reservations['Peninsula Tennis Club|2026-08-08|1']['8:00 AM–8:30 AM'], ['Abbey, Stephanie'])
  assert.deepEqual(reservations['Peninsula Tennis Club|2026-08-08|2']['8:00 AM–8:30 AM'], ['Zhou, Zhongyi'])
})

test('handles single-row time slots (no continuation row)', () => {
  const values = [
    ['Mon Aug 10', '', ''],
    ['', 4, ''],
    ['8:00 AM', 'Abbey, Stephanie', ''],
    ['8:30 AM', 'Zhou, Zhongyi', ''],
  ]
  const { reservations } = parseGridValues(values, 'Barnes TC')
  assert.deepEqual(reservations['Barnes Tennis Center|2026-08-10|4']['8:00 AM–8:30 AM'], ['Abbey, Stephanie'])
  assert.deepEqual(reservations['Barnes Tennis Center|2026-08-10|4']['8:30 AM–9:00 AM'], ['Zhou, Zhongyi'])
})
