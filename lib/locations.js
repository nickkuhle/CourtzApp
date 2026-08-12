// lib/locations.js - Practice-location visibility rules.
//
// The three practice sites are shown by default. USD, Balboa and Pacific Beach
// are match-play sites: they stay hidden until the desk deliberately adds them
// (they are still read from the Sheet, so their reservations are visible once
// added). Reservations at hidden sites never count toward the practice-session
// limit.

export const DEFAULT_PRACTICE_LOCATIONS = [
  'Barnes Tennis Center',
  'Peninsula Tennis Club',
  'Point Loma Nazarene College',
]

export const MATCH_PLAY_LOCATIONS = [
  'Pacific Beach Tennis Club',
  'Balboa Tennis Center',
  'USD',
]

export function isBarnesLocation(location) {
  return /barnes/i.test(String(location || ''))
}

export function isMatchPlayLocation(location) {
  return MATCH_PLAY_LOCATIONS.includes(location)
}

// The list of locations that count toward the session limit for a write. A
// client that never chose extra sites sends nothing and gets the three
// defaults, so hidden match-play reservations are never counted implicitly.
export function normalizePracticeLocations(list) {
  if (!Array.isArray(list)) return [...DEFAULT_PRACTICE_LOCATIONS]
  const cleaned = [...new Set(list.map((l) => String(l).trim()).filter(Boolean))]
  return cleaned.length ? cleaned : [...DEFAULT_PRACTICE_LOCATIONS]
}
