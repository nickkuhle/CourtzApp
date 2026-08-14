// Pure helpers behind the "Site overview" busy map: one square per court ×
// 30-minute slot for a single location and day, so the desk can see at a
// glance which hours of the day the whole site is busy or open.
//
// A square is:
//   - 'open'    : nobody booked (green)
//   - 'partial' : 1-3 of 4 spots booked, space remains (amber)
//   - 'full'    : 4/4 booked (red)
//   - 'ended'   : the slot's end time has passed, can no longer be booked (gray)
//
// The summary row counts courts that are NOT full for each time column, so a
// red summary square means "every court at this site is booked at this time".

import { MAX_PLAYERS_PER_SLOT } from './booking-rules.js'

export function slotOccupancyStatus({ players, ended = false }) {
  if (ended) return 'ended'
  const count = slotPlayerCount(players)
  if (count === 0) return 'open'
  if (count >= MAX_PLAYERS_PER_SLOT) return 'full'
  return 'partial'
}

export function slotPlayerCount(slotValue) {
  return Array.isArray(slotValue) ? slotValue.length : slotValue ? 1 : 0
}

// Builds the overview matrix for one location and day.
//   rows: one entry per court, each with `cells` aligned to `slotLabels`
//   summary: one entry per slot label with `available` (courts with room)
//            and `total` (courts that exist that day)
export function buildSiteOverview({ courts, reservations, location, dateKey, slotLabels, completedSlots }) {
  const courtList = Array.isArray(courts) ? courts : []
  const labels = Array.isArray(slotLabels) ? slotLabels : []
  const endedSet = completedSlots instanceof Set ? completedSlots : new Set()

  const rows = courtList.map((court) => {
    const bySlot = reservations?.[`${location}|${dateKey}|${court.id}`] || {}
    const cells = labels.map((label) => {
      const players = Array.isArray(bySlot[label]) ? bySlot[label] : []
      return {
        label,
        players,
        count: players.length,
        status: slotOccupancyStatus({ players, ended: endedSet.has(label) }),
      }
    })
    return { court, cells }
  })

  const summary = labels.map((label) => {
    if (endedSet.has(label)) return { label, ended: true, available: 0, total: courtList.length }
    let available = 0
    for (const court of courtList) {
      const players = reservations?.[`${location}|${dateKey}|${court.id}`]?.[label] || []
      if (slotPlayerCount(players) < MAX_PLAYERS_PER_SLOT) available += 1
    }
    return { label, ended: false, available, total: courtList.length }
  })

  return { rows, summary }
}
