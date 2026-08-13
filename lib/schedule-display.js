// Presentation helpers for reservation data. Player names stay in their
// canonical Sheet form (usually "Last, First") everywhere bookings are matched
// or written; these helpers only change how names and grouped sessions are
// displayed in the UI.
//
// The grouping itself now lives in lib/reservation-index.js so the whole app
// builds ONE index per schedule refresh instead of re-scanning the complete
// reservations object per court card, per modal and per search. These wrappers
// stay for callers that only need a single answer (and for the existing tests).

import {
  buildReservationIndex,
  formatPlayerName,
  nameAliases,
  nameTokenKey,
  normalizeNameKey,
  resolveCanonicalName,
} from './reservation-index.js'

export {
  buildReservationIndex,
  formatPlayerName,
  nameAliases,
  nameTokenKey,
  normalizeNameKey,
  resolveCanonicalName,
}

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

export function playerInitials(value) {
  const words = formatPlayerName(value).split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

// Colors are keyed off the canonical name so the same player keeps one color
// no matter which form is on screen.
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

// One court's display blocks. Prefer index.blocksFor(...) in components — this
// convenience wrapper builds a throwaway index and is only for one-off callers.
export function courtSessionBlocks(reservations, { dateKey, location, court }) {
  return buildReservationIndex(reservations).blocksFor({ date: dateKey, location, court })
}

// One player's reservations grouped into Past / Current / Upcoming. Accepts a
// canonical "Last, First" value or the displayed "First Last" form.
export function playerReservationSections(reservations, player, { nowMs = Date.now() } = {}) {
  return buildReservationIndex(reservations, { nowMs }).sections(player, { nowMs })
}
