// lib/reservation-index.js - ONE read-only index built from the reservations
// map that the client already loaded from /api/schedule.
//
// Why this exists
// ---------------
// Every court card, every court-schedule modal and every reservation search
// used to walk the *complete* reservations object on its own (and
// playerReservationSections walked it once per tournament date). This module
// walks it exactly once and exposes prepared lookups instead.
//
// What it is NOT
// --------------
// This index is display/read-only infrastructure. Booking validation keeps
// using lib/booking-rules.js with canonical Sheet names; nothing here ever
// rewrites, reformats or persists a player's name. `session.player` is always
// the untouched canonical value that came from the Sheet.
//
// Session grouping mirrors existingPlayerSessions() exactly:
//   - Barnes: every occupied 30-minute slot is one session.
//   - Elsewhere: two immediately consecutive 30-minute slots for the same
//     player/date/location/court form one 60-minute session (max two slots).

import { isBarnesLocation } from './locations.js'
import { isBookableDay, isSlotCompleted, laNow, slotEndMinutes, slotStartMinutes } from './booking-rules.js'

// --- Name handling ----------------------------------------------------------

// Canonical Sheet names are usually "Last, First"; the UI shows "First Last".
// Neither form is authoritative for matching, so every comparison runs through
// these normalizers. The canonical value itself is never modified.
export function formatPlayerName(value) {
  const name = String(value || '').trim()
  if (!name.includes(',')) return name
  const [last, ...firstParts] = name.split(',')
  const first = firstParts.join(' ').trim()
  const cleanedLast = last.trim()
  return [first, cleanedLast].filter(Boolean).join(' ')
}

// Case-, accent-, punctuation- and whitespace-insensitive comparison key.
export function normalizeNameKey(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Order-insensitive key so "Abbey, Stephanie" and "Stephanie Abbey" collide.
export function nameTokenKey(value) {
  const key = normalizeNameKey(value)
  if (!key) return ''
  return key.split(' ').filter(Boolean).sort().join(' ')
}

// Every lookup form one canonical name should answer to.
export function nameAliases(canonical) {
  const raw = String(canonical == null ? '' : canonical).trim()
  if (!raw) return []
  const aliases = [normalizeNameKey(raw), normalizeNameKey(formatPlayerName(raw))]
  return [...new Set(aliases.filter(Boolean))]
}

// Resolves anything a human might type (canonical, display form, sloppy
// spacing/case) back to a canonical value taken from `candidates`.
export function resolveCanonicalName(value, candidates = []) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return null
  const exact = normalizeNameKey(raw)
  const token = nameTokenKey(raw)
  let tokenHit = null
  for (const candidate of candidates) {
    const canonical = String(candidate == null ? '' : candidate).trim()
    if (!canonical) continue
    if (nameAliases(canonical).includes(exact)) return canonical
    if (!tokenHit && nameTokenKey(canonical) === token) tokenHit = canonical
  }
  return tokenHit
}

// --- Reservation map helpers ------------------------------------------------

// The v2.1 backend prunes 30-minute slots that have already ended from the
// bookable payload (they can no longer be booked or cancelled). Past
// reservations therefore only exist in the separate read-only history payload.
// This merges the two for DISPLAY: every live slot comes from `bookable` (so an
// optimistic booking/cancellation is never resurrected by stale history) and
// history only contributes slots that have already ended.
export function mergeEndedReservations(bookable, history, { nowMs = Date.now() } = {}) {
  const merged = {}
  const copyInto = (target, source, endedOnly) => {
    for (const [key, slots] of Object.entries(source || {})) {
      if (!slots || typeof slots !== 'object') continue
      const date = String(key).split('|')[1]
      for (const [slotLabel, value] of Object.entries(slots)) {
        const names = (Array.isArray(value) ? value : [value])
          .map((n) => String(n == null ? '' : n).trim())
          .filter(Boolean)
        if (!names.length) continue
        if (endedOnly && !isSlotCompleted(date, slotLabel, nowMs)) continue
        if (!target[key]) target[key] = {}
        if (!target[key][slotLabel]) target[key][slotLabel] = []
        for (const name of names) {
          if (!target[key][slotLabel].includes(name)) target[key][slotLabel].push(name)
        }
      }
    }
  }
  copyInto(merged, history, true)
  copyInto(merged, bookable, false)
  return merged
}

function sectionForDate(date, today) {
  if (date < today) return 'past'
  if (date === today) return 'current'
  return 'upcoming'
}

function formatMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return ''
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
}

const EMPTY_SESSIONS = Object.freeze([])
const EMPTY_BLOCKS = Object.freeze([])

// --- The index --------------------------------------------------------------

/**
 * Walks the reservations map ONCE and returns every read-only view the UI needs.
 *
 * @param {object} reservations `{ 'Location|YYYY-MM-DD|Court': { '8:00 AM–8:30 AM': ['Last, First'] } }`
 * @returns {object} index with sessionsFor / blocksFor / lookup / sections
 */
export function buildReservationIndex(reservations, { nowMs = Date.now() } = {}) {
  const sessionsByPlayer = new Map() // canonical name -> sessions
  const aliasToCanonical = new Map() // exact alias key -> canonical name
  const tokenToCanonical = new Map() // order-insensitive key -> canonical name
  const ambiguousTokens = new Set()
  const blocksByCourt = new Map() // 'Location|date|court' -> blocks
  const dates = new Set()
  const locations = new Set()

  const registerPlayer = (canonical) => {
    if (sessionsByPlayer.has(canonical)) return
    sessionsByPlayer.set(canonical, [])
    for (const alias of nameAliases(canonical)) {
      if (!aliasToCanonical.has(alias)) aliasToCanonical.set(alias, canonical)
    }
    const token = nameTokenKey(canonical)
    if (!token) return
    const existing = tokenToCanonical.get(token)
    if (existing === undefined) tokenToCanonical.set(token, canonical)
    else if (existing !== canonical) ambiguousTokens.add(token)
  }

  for (const [key, slots] of Object.entries(reservations || {})) {
    const [location, date, court] = String(key).split('|')
    if (!location || !date || !court) continue
    if (!slots || typeof slots !== 'object') continue

    dates.add(date)
    locations.add(location)
    const barnes = isBarnesLocation(location)

    // 1. Gather this court's occupied 30-minute slots per canonical player.
    const ownedByPlayer = new Map()
    for (const [slotLabel, value] of Object.entries(slots)) {
      const start = slotStartMinutes(slotLabel)
      if (start === null) continue
      const names = Array.isArray(value) ? value : [value]
      for (const raw of names) {
        // Sheet cells sometimes carry stray whitespace; trim for matching but
        // keep the trimmed canonical value itself untouched otherwise.
        const player = String(raw == null ? '' : raw).trim()
        if (!player) continue
        if (!ownedByPlayer.has(player)) ownedByPlayer.set(player, [])
        ownedByPlayer.get(player).push({ start, slotLabel })
      }
    }
    if (!ownedByPlayer.size) continue

    // 2. Group each player's slots into the sessions the booking rules count.
    const courtBlocks = new Map()
    for (const [player, owned] of ownedByPlayer) {
      registerPlayer(player)
      const sorted = [...owned].sort((a, b) => a.start - b.start)
      const grouped = []
      let current = null
      for (const entry of sorted) {
        if (barnes) {
          grouped.push({ start: entry.start, slots: [entry.slotLabel] })
          current = null
          continue
        }
        if (current && entry.start === current.start + 30 && current.slots.length < 2) {
          current.slots.push(entry.slotLabel)
        } else {
          current = { start: entry.start, slots: [entry.slotLabel] }
          grouped.push(current)
        }
      }

      for (const group of grouped) {
        const end = slotEndMinutes(group.slots[group.slots.length - 1]) ?? group.start + group.slots.length * 30
        const session = {
          player,
          location,
          date,
          court: String(court),
          start: group.start,
          end,
          slots: [...group.slots],
          isBarnes: barnes,
          durationMinutes: group.slots.length * 30,
          timeRange: `${formatMinutes(group.start)}–${formatMinutes(end)}`,
        }
        sessionsByPlayer.get(player).push(session)

        // 3. Players sharing an identical block share one court preview entry.
        const blockKey = `${group.start}|${group.slots.join('\u0001')}`
        if (!courtBlocks.has(blockKey)) {
          courtBlocks.set(blockKey, {
            date,
            location,
            court: String(court),
            start: group.start,
            end,
            slots: [...group.slots],
            isBarnes: barnes,
            players: [],
            timeRange: session.timeRange,
          })
        }
        const block = courtBlocks.get(blockKey)
        if (!block.players.includes(player)) block.players.push(player)
      }
    }

    const ordered = [...courtBlocks.values()]
      .map((block) => ({
        ...block,
        players: block.players.sort((a, b) => formatPlayerName(a).localeCompare(formatPlayerName(b))),
      }))
      .sort((a, b) => a.start - b.start)
    blocksByCourt.set(`${location}|${date}|${court}`, ordered)
  }

  const ascending = (a, b) =>
    a.date.localeCompare(b.date) ||
    a.start - b.start ||
    a.location.localeCompare(b.location) ||
    Number(a.court) - Number(b.court)
  for (const sessions of sessionsByPlayer.values()) sessions.sort(ascending)

  for (const token of ambiguousTokens) tokenToCanonical.delete(token)

  const players = [...sessionsByPlayer.keys()].sort((a, b) => formatPlayerName(a).localeCompare(formatPlayerName(b)))

  /** Canonical name for anything typed, or null when nobody matches. */
  function lookup(value) {
    const raw = String(value == null ? '' : value).trim()
    if (!raw) return null
    const exact = aliasToCanonical.get(normalizeNameKey(raw))
    if (exact !== undefined) return exact
    const token = tokenToCanonical.get(nameTokenKey(raw))
    return token === undefined ? null : token
  }

  /** Every session of one player (canonical OR display form), date-ascending. */
  function sessionsFor(value) {
    const canonical = lookup(value)
    if (canonical === null) return EMPTY_SESSIONS
    return sessionsByPlayer.get(canonical) || EMPTY_SESSIONS
  }

  /** Display blocks for one court (already merged across shared players). */
  function blocksFor({ date, location, court } = {}) {
    if (!date || !location || court === undefined || court === null) return EMPTY_BLOCKS
    return blocksByCourt.get(`${location}|${date}|${String(court)}`) || EMPTY_BLOCKS
  }

  /**
   * One player's reservations split into Past / Current (today) / Upcoming,
   * across EVERY loaded date and location including hidden match-play sites.
   */
  function sections(value, options = {}) {
    const at = options.nowMs === undefined ? nowMs : options.nowMs
    const today = laNow(at).dateKey
    const result = { past: [], current: [], upcoming: [], player: lookup(value), total: 0 }
    for (const session of sessionsFor(value)) {
      const section = sectionForDate(session.date, today)
      const ended = session.slots.every((slot) => isSlotCompleted(session.date, slot, at))
      result[section].push({
        ...session,
        slots: [...session.slots],
        section,
        ended,
        viewOnly: !isBookableDay(session.date, at),
        status: ended ? 'Ended' : section === 'current' ? 'Today' : 'Upcoming',
      })
    }
    result.total = result.past.length + result.current.length + result.upcoming.length
    // Past reads most-recent-first; today and upcoming read chronologically.
    result.past.reverse()
    return result
  }

  return {
    players,
    dates: [...dates].sort(),
    locations: [...locations].sort(),
    sessionCount: [...sessionsByPlayer.values()].reduce((total, list) => total + list.length, 0),
    lookup,
    sessionsFor,
    blocksFor,
    sections,
  }
}

// An index over nothing, so components can render before the first load.
export const EMPTY_RESERVATION_INDEX = buildReservationIndex({})
