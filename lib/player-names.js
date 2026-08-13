// lib/player-names.js - Canonical vs. displayed player names.
//
// The Google Sheet is the single source of truth for a player's name and it
// stores them canonically, almost always as "Last, First". Every booking,
// cancellation, ownership check and Sheet write MUST keep using that exact
// canonical string. These helpers only produce the *display* form ("First
// Last") and the normalised lookup keys used for searching, so nothing here
// ever mutates or replaces a canonical value.

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

// "Abbey, Stephanie" -> "Stephanie Abbey". Names that are already in display
// form (or single words) are returned unchanged apart from trimming.
export function formatPlayerName(value) {
  const name = String(value ?? '').trim()
  if (!name.includes(',')) return name
  const [last, ...firstParts] = name.split(',')
  const first = firstParts.join(' ').trim()
  const cleanedLast = last.trim()
  return [first, cleanedLast].filter(Boolean).join(' ')
}

// The key used for every name comparison in the UI. Case, padding and repeated
// inner whitespace differences between the roster tab and the court grid must
// never hide a reservation, so they are all collapsed here.
export function normalizeNameKey(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

// Every lookup form one canonical name can be searched by:
//   "Abbey, Stephanie" -> ["abbey, stephanie", "stephanie abbey"]
export function nameAliases(value) {
  const canonical = normalizeNameKey(value)
  if (!canonical) return []
  const display = normalizeNameKey(formatPlayerName(value))
  return display && display !== canonical ? [canonical, display] : [canonical]
}

// Free-text haystack used by the roster search boxes.
export function searchableName(value) {
  return `${normalizeNameKey(value)} ${normalizeNameKey(formatPlayerName(value))}`
}

// Finds the roster entries a free-text query refers to, used by every
// PlayerSwitcher. An exact canonical or display-form match always sorts ahead
// of a partial one, so typing a player's full name and pressing Enter can never
// select somebody else whose surname merely starts the same way.
export function matchRosterQuery(roster, query) {
  const q = normalizeNameKey(query)
  if (!q) return []
  const exact = []
  const partial = []
  for (const name of roster || []) {
    const canonical = normalizeNameKey(name)
    const display = normalizeNameKey(formatPlayerName(name))
    if (canonical === q || display === q) exact.push(name)
    else if (searchableName(name).includes(q)) partial.push(name)
  }
  return [...exact, ...partial]
}

export function playerInitials(value) {
  const words = formatPlayerName(value).split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

// Stable color per player. It hashes the normalised DISPLAY form so that
// "Abbey, Stephanie", "abbey,  stephanie" and "Stephanie Abbey" all render as
// the same person in the same color.
export function playerColorIndex(value) {
  let hash = 2166136261
  for (const char of normalizeNameKey(formatPlayerName(value))) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % PLAYER_STYLES.length
}

export function playerStyle(value) {
  return PLAYER_STYLES[playerColorIndex(value)]
}
