// lib/session-rules.js - Player practice-session limits and proximity rules.
//
// A player may hold at most TWO practice sessions per day across all active
// practice locations. What counts as one session:
//
//   - Barnes: every occupied 30-minute slot is one session.
//   - Other locations: for the same player + date + location + court, two
//     immediately consecutive 30-minute slots combine into ONE 60-minute
//     session. A session contains at most two slots.
//
// Proximity (staff-approval) checks compare SESSION START TIMES - never the
// internal 30-minute halves of a 60-minute session. A booking needs tournament
// staff approval when a new session:
//   - is back-to-back with another session (starts exactly when it ends), or
//   - starts within one hour of another session's start time.
//
// The staff override can bypass ONLY the proximity warning. The hard maximum
// of two sessions per day can never be bypassed.
//
// CourtzAppsScript.gs mirrors these rules so they are rechecked server-side
// under the write lock with fresh sheet data.

import { timeToMinutes } from './sheets-grid-parser.js'

// Default active practice sites. Match-play sites (USD, Balboa, Pacific Beach)
// are hidden until the desk deliberately adds them, and their reservations do
// not count toward practice-session limits unless added.
export const PRACTICE_DEFAULT_LOCATIONS = [
  'Barnes Tennis Center',
  'Peninsula Tennis Club',
  'Point Loma Nazarene College',
]

// Splits "8:00 AM–8:30 AM" (or "8:00 AM-8:30 AM") into start/end minutes.
export function slotRange(slotLabel) {
  const parts = String(slotLabel).split(/[–\-\u2013\u2014]/)
  const start = timeToMinutes(parts[0])
  const end = timeToMinutes(parts[1])
  if (isNaN(start) || isNaN(end)) return null
  return { start, end }
}

// Groups 30-minute parts into sessions. Parts must carry {start, end} minutes
// plus optional location/court. Grouping happens per location+court; two
// immediately consecutive parts merge into one session; a session never
// contains more than two parts. Barnes never merges: every occupied 30-minute
// slot there is one session of its own.
export function groupSlots(parts) {
  const byCourt = {}
  for (const p of parts || []) {
    const key = `${p.location || ''}|${p.court || ''}`
    if (!byCourt[key]) byCourt[key] = []
    byCourt[key].push(p)
  }
  const sessions = []
  for (const key of Object.keys(byCourt)) {
    const sorted = byCourt[key].sort((a, b) => a.start - b.start || a.end - b.end)
    const isBarnes = /barnes/i.test(String(sorted[0]?.location || ''))
    let current = null
    for (const p of sorted) {
      if (current && !isBarnes && current.parts.length < 2 && current.end === p.start) {
        current.parts.push(p)
        current.end = p.end
      } else {
        current = { start: p.start, end: p.end, parts: [p], location: p.location, court: p.court }
        sessions.push(current)
      }
    }
  }
  return sessions
}

// Every 30-minute part one player holds on a date, across the locations in
// `activeLocations`.
export function playerParts({ reservations, date, player, activeLocations }) {
  const active = new Set(activeLocations || [])
  const parts = []
  for (const [key, slotsMap] of Object.entries(reservations || {})) {
    const [location, d, court] = key.split('|')
    if (!active.has(location) || d !== date) continue
    for (const [slotLabel, names] of Object.entries(slotsMap || {})) {
      if (!Array.isArray(names) || !names.includes(player)) continue
      const range = slotRange(slotLabel)
      if (range) parts.push({ ...range, location, court })
    }
  }
  return parts
}

// Grouped sessions for one player on a date (see groupSlots).
export function playerSessions({ reservations, date, player, activeLocations }) {
  return groupSlots(playerParts({ reservations, date, player, activeLocations }))
}

// True when two sessions are close enough to need staff approval.
export function sessionsClose(a, b) {
  if (Math.abs(a.start - b.start) < 60) return true // starts within one hour
  if (a.start === b.end || a.end === b.start) return true // back-to-back
  return false
}

// Validates a proposed group booking against the session rules for EVERY
// player. Returns { overLimit: [names], warnings: [{player, ...}] }.
//   - overLimit: hard maximum reached (never bypassable).
//   - warnings: proximity issue (bypassable only with staff approval).
export function validateSessionBooking({ reservations, activeLocations = [], location, date, courtId, slots = [], names = [] }) {
  const active = [...new Set([...PRACTICE_DEFAULT_LOCATIONS, ...activeLocations, location])]
  const overLimit = []
  const warnings = []
  const players = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))]

  const proposedParts = slots
    .map((slot) => slotRange(slot))
    .filter(Boolean)
    .map((range) => ({ ...range, location, court: String(courtId) }))

  for (const player of players) {
    const existingParts = playerParts({ reservations, date: String(date), player, activeLocations: active })
    const combined = groupSlots([...existingParts, ...proposedParts])
    if (combined.length > 2) overLimit.push(player)

    const existingSessions = groupSlots(existingParts)
    const proposedSessions = groupSlots(proposedParts)
    const seen = []
    for (const proposed of proposedSessions) {
      for (const existing of existingSessions) {
        if (sessionsClose(proposed, existing)) warnings.push({ player, proposed, existing })
      }
      for (const other of seen) {
        if (sessionsClose(proposed, other)) warnings.push({ player, proposed, otherProposed: other })
      }
      seen.push(proposed)
    }
  }

  return { overLimit, warnings }
}

// Human-readable summary used by the UI confirmation prompt.
export function formatSessionWarning(names) {
  const who = [...new Set(names)].join(', ')
  return `This booking puts ${who}'s practice session back-to-back with another session, or within one hour of another session's start time. Tournament staff approval is required — continue only if tournament staff have approved it.`
}
