// Presentation helpers for reservation data. Player names stay in their
// canonical Sheet form (usually "Last, First") everywhere bookings are matched
// or written; these helpers only change how names and grouped sessions are
// displayed in the UI.

import {
  existingPlayerSessions,
  isBookableDay,
  isSlotCompleted,
  laNow,
  slotEndMinutes,
} from './booking-rules.js'

export const PLAYER_STYLES = [
  { avatar: 'bg-sky-600 text-white', chip: 'border-sky-200 bg-sky-50 text-sky-800', dot: 'bg-sky-500' },
  { avatar: 'bg-violet-600 text-white', chip: 'border-violet-200 bg-violet-50 text-violet-800', dot: 'bg-violet-500' },
  { avatar: 'bg-rose-600 text-white', chip: 'border-rose-200 bg-rose-50 text-rose-800', dot: 'bg-rose-500' },
  { avatar: 'bg-amber-600 text-white', chip: 'border-amber-200 bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  { avatar: 'bg-teal-600 text-white', chip: 'border-teal-200 bg-teal-50 text-teal-800', dot: 'bg-teal-500' },
  { avatar: 'bg-indigo-600 text-white', chip: 'border-indigo-200 bg-indigo-50 text-indigo-800', dot: 'bg-indigo-500' },
  { avatar: 'bg-pink-600 text-white', chip: 'border-pink-200 bg-pink-50 text-pink-800', dot: 'bg-pink-500' },
  { avatar: 'bg-lime-700 text-white', chip: 'border-lime-200 bg-lime-50 text-lime-900', dot: 'bg-lime-600' },
]

export function formatPlayerName(value) {
  const name = String(value || '').trim()
  if (!name.includes(',')) return name
  const [last, ...firstParts] = name.split(',')
  const first = firstParts.join(' ').trim()
  const cleanedLast = last.trim()
  return [first, cleanedLast].filter(Boolean).join(' ')
}

export function playerInitials(value) {
  const words = formatPlayerName(value).split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

export function playerColorIndex(value) {
  let hash = 2166136261
  for (const char of String(value || '').trim().toLowerCase()) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % PLAYER_STYLES.length
}

export function playerStyle(value) {
  return PLAYER_STYLES[playerColorIndex(value)]
}

export function formatMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return ''
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}

// Groups one court's reservations into display blocks using the exact same
// Barnes/non-Barnes session logic that enforces the daily session limit.
// Players sharing an identical block are merged into one `players` array.
export function courtSessionBlocks(reservations, { dateKey, location, court }) {
  if (!dateKey || !location || court === undefined || court === null) return []
  const sessions = existingPlayerSessions(reservations, {
    dateKey,
    practiceLocations: [location],
  }).filter((session) => session.location === location && String(session.court) === String(court))

  const blocks = new Map()
  for (const session of sessions) {
    const slots = [...session.slots]
    const key = `${session.start}|${slots.join('\u0001')}`
    if (!blocks.has(key)) {
      const end = slotEndMinutes(slots[slots.length - 1]) ?? (session.start + slots.length * 30)
      blocks.set(key, {
        date: dateKey,
        location,
        court: String(court),
        start: session.start,
        end,
        slots,
        players: [],
      })
    }
    const block = blocks.get(key)
    if (!block.players.includes(session.player)) block.players.push(session.player)
  }

  return [...blocks.values()]
    .map((block) => ({
      ...block,
      players: block.players.sort((a, b) => formatPlayerName(a).localeCompare(formatPlayerName(b))),
      timeRange: `${formatMinutes(block.start)}–${formatMinutes(block.end)}`,
    }))
    .sort((a, b) => a.start - b.start || Number(a.court) - Number(b.court))
}

function allReservationDatesAndLocations(reservations) {
  const dates = new Set()
  const locations = new Set()
  for (const key of Object.keys(reservations || {})) {
    const [location, date] = String(key).split('|')
    if (location) locations.add(location)
    if (date) dates.add(date)
  }
  return { dates: [...dates].sort(), locations: [...locations] }
}

function sectionForDate(date, today) {
  if (date < today) return 'past'
  if (date === today) return 'current'
  return 'upcoming'
}

// Finds one canonical player's reservations across every location and date.
// Entries are split by calendar date into Past / Current / Upcoming; a current
// session is "Ended" only after all of its 30-minute parts have completed.
export function playerReservationSections(reservations, player, { nowMs = Date.now() } = {}) {
  const empty = { past: [], current: [], upcoming: [] }
  const canonicalPlayer = String(player || '').trim()
  if (!canonicalPlayer) return empty

  const { dates, locations } = allReservationDatesAndLocations(reservations)
  const today = laNow(nowMs).dateKey
  const sections = { past: [], current: [], upcoming: [] }

  for (const date of dates) {
    const sessions = existingPlayerSessions(reservations, {
      dateKey: date,
      name: canonicalPlayer,
      practiceLocations: locations,
    })
    for (const session of sessions) {
      const end = slotEndMinutes(session.slots[session.slots.length - 1]) ?? (session.start + session.slots.length * 30)
      const section = sectionForDate(date, today)
      const ended = session.slots.every((slot) => isSlotCompleted(date, slot, nowMs))
      sections[section].push({
        player: canonicalPlayer,
        location: session.location,
        date,
        court: String(session.court),
        start: session.start,
        end,
        slots: [...session.slots],
        timeRange: `${formatMinutes(session.start)}–${formatMinutes(end)}`,
        section,
        ended,
        viewOnly: !isBookableDay(date, nowMs),
        status: ended ? 'Ended' : section === 'current' ? 'Today' : 'Upcoming',
      })
    }
  }

  const ascending = (a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.location.localeCompare(b.location) || Number(a.court) - Number(b.court)
  sections.current.sort(ascending)
  sections.upcoming.sort(ascending)
  sections.past.sort((a, b) => -ascending(a, b))
  return sections
}
