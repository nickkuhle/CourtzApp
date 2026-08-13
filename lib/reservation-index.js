// lib/reservation-index.js - One memoized, read-only view of the reservations
// payload returned by /api/schedule.
//
// Before this index existed, every court card, every court-schedule render and
// every reservation search re-scanned the *entire* reservations object (often
// once per date, per player and per court). The index walks the payload ONCE
// and exposes ready-made lookups instead.
//
// It is display/read-only infrastructure:
//   - Booking, cancellation and Sheet writes keep using the canonical player
//     strings exactly as they came from the Sheet (session.player below is that
//     untouched value).
//   - The v2.1 rule enforcement (lib/booking-rules.js, pages/api/reservations.js
//     and CourtzAppsScript.gs) is unchanged and is still the only thing that
//     decides whether a booking is allowed.
//
// Session grouping mirrors the v2.1 rules exactly:
//   - Barnes: every occupied 30-minute slot is one session.
//   - Elsewhere: for the same player/date/location/court, two immediately
//     consecutive 30-minute slots form one 60-minute session (max two slots).

import { isBarnesLocation } from './locations.js'
import { isBookableDay, isSlotCompleted, laNow, slotStartMinutes, slotEndMinutes } from './booking-rules.js'
import { formatPlayerName, nameAliases, normalizeNameKey } from './player-names.js'

// The v2.1 Apps Script deliberately strips every 30-minute slot that has
// already ENDED from its getSchedule payload (they can no longer be booked or
// cancelled). That keeps the booking rules honest, but it also means the
// payload contains no past dates at all — which is exactly why the reservation
// search could not find a player's earlier sessions.
//
// `history` is the unpruned reservations map (from the Apps Script's existing
// getAll action). Merging it for DISPLAY is safe because only *completed*
// slots are taken from it: a completed slot is immutable, so it can never
// conflict with a pending optimistic booking or cancellation. Live data always
// wins for everything still changeable.
export function mergeCompletedHistory(live, history, nowMs = Date.now()) {
  if (!history || !Object.keys(history).length) return live || {}
  const merged = {}
  for (const [key, slots] of Object.entries(live || {})) merged[key] = { ...slots }

  for (const [key, slots] of Object.entries(history)) {
    const [, date] = String(key).split('|')
    if (!date || !slots || typeof slots !== 'object') continue
    for (const [slotLabel, names] of Object.entries(slots)) {
      // Only immutable (already ended) slots are restored from history.
      if (!isSlotCompleted(date, slotLabel, nowMs)) continue
      if (merged[key]?.[slotLabel]) continue
      if (!merged[key]) merged[key] = {}
      merged[key][slotLabel] = Array.isArray(names) ? [...names] : [names]
    }
  }
  return merged
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

export function courtKey(location, date, court) {
  return `${location}|${date}|${court}`
}

function timeRange(start, end) {
  return `${formatMinutes(start)}–${formatMinutes(end)}`
}

const EMPTY_SECTIONS = Object.freeze({ past: [], current: [], upcoming: [] })

// Groups the slots one player holds on one court into v2.1 sessions.
function groupSlots(owned, barnes) {
  const sorted = [...owned].sort((a, b) => a.start - b.start)
  const sessions = []
  let current = null
  for (const entry of sorted) {
    if (barnes) {
      sessions.push({ start: entry.start, slots: [entry.slotLabel] })
      current = null
      continue
    }
    if (current && entry.start === current.start + 30 && current.slots.length < 2) {
      current.slots.push(entry.slotLabel)
    } else {
      current = { start: entry.start, slots: [entry.slotLabel] }
      sessions.push(current)
    }
  }
  return sessions
}

/**
 * Builds the shared reservation index.
 *
 * @param {Object} reservations `{ "Location|YYYY-MM-DD|Court": { "8:00 AM–8:30 AM": ["Last, First"] } }`
 * @returns {{
 *   sessions: Array,
 *   sessionsByPlayer: Map<string, Array>,
 *   canonicalByAlias: Map<string, string>,
 *   players: string[],
 *   blocksByCourt: Map<string, Array>,
 *   dates: string[],
 *   locations: string[],
 *   resolvePlayer: (value: string) => string|null,
 *   sessionsForPlayer: (value: string) => Array,
 *   blocksForCourt: (opts: {dateKey: string, location: string, court: string|number}) => Array,
 *   sectionsForPlayer: (value: string, opts?: {nowMs?: number}) => {past: Array, current: Array, upcoming: Array},
 * }}
 */
export function buildReservationIndex(reservations) {
  const sessions = []
  const sessionsByPlayer = new Map() // normalized canonical key -> sessions[]
  const canonicalByAlias = new Map() // "last, first" AND "first last" -> canonical Sheet value
  const blocksByCourt = new Map() // "Location|date|court" -> blocks[]
  const dates = new Set()
  const locations = new Set()
  const canonicalByKey = new Map() // normalized canonical key -> canonical Sheet value

  for (const [key, slots] of Object.entries(reservations || {})) {
    const [location, date, court] = String(key).split('|')
    if (!location || !date || !court) continue
    if (!slots || typeof slots !== 'object') continue
    locations.add(location)
    dates.add(date)

    // 1. Collect the 30-minute slots each player holds on this court.
    const byPlayer = new Map() // normalized key -> { canonical, owned[] }
    for (const [slotLabel, value] of Object.entries(slots)) {
      const start = slotStartMinutes(slotLabel)
      if (start === null) continue
      const names = Array.isArray(value) ? value : [value]
      for (const raw of names) {
        // The canonical value is kept EXACTLY as the Sheet reported it (only
        // surrounding whitespace is dropped) — it is what bookings write back.
        const canonical = String(raw ?? '').trim()
        if (!canonical) continue
        const normalized = normalizeNameKey(canonical)
        if (!normalized) continue
        if (!byPlayer.has(normalized)) byPlayer.set(normalized, { canonical, owned: [] })
        byPlayer.get(normalized).owned.push({ start, slotLabel })
        if (!canonicalByKey.has(normalized)) canonicalByKey.set(normalized, canonical)
        for (const alias of nameAliases(canonical)) {
          if (!canonicalByAlias.has(alias)) canonicalByAlias.set(alias, canonical)
        }
      }
    }

    // 2. Group them into v2.1 sessions and index them per player.
    const barnes = isBarnesLocation(location)
    const blocks = new Map()
    for (const [normalized, { canonical, owned }] of byPlayer) {
      for (const grouped of groupSlots(owned, barnes)) {
        const end = slotEndMinutes(grouped.slots[grouped.slots.length - 1]) ?? grouped.start + grouped.slots.length * 30
        const session = {
          player: canonicalByKey.get(normalized) || canonical,
          playerKey: normalized,
          location,
          date,
          court: String(court),
          start: grouped.start,
          end,
          slots: [...grouped.slots],
          minutes: grouped.slots.length * 30,
          barnes,
          timeRange: timeRange(grouped.start, end),
        }
        sessions.push(session)
        if (!sessionsByPlayer.has(normalized)) sessionsByPlayer.set(normalized, [])
        sessionsByPlayer.get(normalized).push(session)

        // 3. Shared-player blocks: players holding the identical time window on
        //    this court are merged into a single block for court previews.
        const blockKey = `${grouped.start}|${grouped.slots.join('\u0001')}`
        if (!blocks.has(blockKey)) {
          blocks.set(blockKey, {
            date,
            location,
            court: String(court),
            start: grouped.start,
            end,
            slots: [...grouped.slots],
            minutes: grouped.slots.length * 30,
            barnes,
            timeRange: timeRange(grouped.start, end),
            players: [],
            playerKeys: [],
          })
        }
        const block = blocks.get(blockKey)
        if (!block.playerKeys.includes(normalized)) {
          block.playerKeys.push(normalized)
          block.players.push(session.player)
        }
      }
    }

    if (blocks.size) {
      const list = [...blocks.values()]
        .map((block) => ({
          ...block,
          players: block.players.sort((a, b) => formatPlayerName(a).localeCompare(formatPlayerName(b))),
        }))
        .sort((a, b) => a.start - b.start)
      blocksByCourt.set(courtKey(location, date, court), list)
    }
  }

  const sortSessions = (a, b) =>
    a.date.localeCompare(b.date) ||
    a.start - b.start ||
    a.location.localeCompare(b.location) ||
    String(a.court).localeCompare(String(b.court), undefined, { numeric: true })

  sessions.sort(sortSessions)
  for (const list of sessionsByPlayer.values()) list.sort(sortSessions)

  // Canonical Sheet value for whatever the user typed or selected: accepts the
  // canonical "Last, First" form, the displayed "First Last" form, and any
  // case/whitespace variant of either.
  function resolvePlayer(value) {
    const normalized = normalizeNameKey(value)
    if (!normalized) return null
    if (canonicalByKey.has(normalized)) return canonicalByKey.get(normalized)
    if (canonicalByAlias.has(normalized)) return canonicalByAlias.get(normalized)
    return null
  }

  // Every session a player holds, found via either name form.
  function sessionsForPlayer(value) {
    const normalized = normalizeNameKey(value)
    if (!normalized) return []
    if (sessionsByPlayer.has(normalized)) return sessionsByPlayer.get(normalized)
    const canonical = canonicalByAlias.get(normalized)
    if (canonical) return sessionsByPlayer.get(normalizeNameKey(canonical)) || []
    return []
  }

  function blocksForCourt({ dateKey, location, court } = {}) {
    if (!dateKey || !location || court === undefined || court === null) return []
    return blocksByCourt.get(courtKey(location, dateKey, court)) || []
  }

  // Past / current (today) / upcoming split with the display status each entry
  // needs. `nowMs` keeps this testable at a fixed moment.
  function sectionsForPlayer(value, { nowMs = Date.now() } = {}) {
    const list = sessionsForPlayer(value)
    if (!list.length) return { past: [], current: [], upcoming: [] }
    const today = laNow(nowMs).dateKey
    const out = { past: [], current: [], upcoming: [] }
    for (const session of list) {
      const section = session.date < today ? 'past' : session.date === today ? 'current' : 'upcoming'
      const ended = session.slots.every((slot) => isSlotCompleted(session.date, slot, nowMs))
      out[section].push({
        ...session,
        section,
        ended,
        viewOnly: !isBookableDay(session.date, nowMs),
        status: ended ? 'Ended' : section === 'current' ? 'Today' : 'Upcoming',
      })
    }
    out.past.reverse() // most recent past reservation first
    return out
  }

  const players = [...canonicalByKey.values()].sort((a, b) => formatPlayerName(a).localeCompare(formatPlayerName(b)))

  return {
    sessions,
    sessionsByPlayer,
    canonicalByAlias,
    players,
    blocksByCourt,
    dates: [...dates].sort(),
    locations: [...locations],
    resolvePlayer,
    sessionsForPlayer,
    blocksForCourt,
    sectionsForPlayer,
  }
}

// A shared, always-safe empty index so components can be rendered before the
// first schedule response arrives.
export const EMPTY_RESERVATION_INDEX = buildReservationIndex({})

export function emptySections() {
  return { past: [], current: [], upcoming: [] }
}

export { EMPTY_SECTIONS }
