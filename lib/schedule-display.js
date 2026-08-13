// Presentation helpers for reservation data. Player names stay in their
// canonical Sheet form (usually "Last, First") everywhere bookings are matched
// or written; these helpers only change how names and grouped sessions are
// displayed in the UI.
//
// The heavy lifting now lives in lib/reservation-index.js, which walks the
// reservations payload once. The functions here remain available for
// one-off lookups (and for the tests), but every component should prefer the
// memoized index built in pages/index.js.

import { buildReservationIndex, formatMinutes } from './reservation-index.js'
import {
  PLAYER_STYLES,
  formatPlayerName,
  nameAliases,
  normalizeNameKey,
  playerColorIndex,
  playerInitials,
  playerStyle,
  searchableName,
} from './player-names.js'

export {
  PLAYER_STYLES,
  formatPlayerName,
  nameAliases,
  normalizeNameKey,
  playerColorIndex,
  playerInitials,
  playerStyle,
  searchableName,
  formatMinutes,
}

// Groups one court's reservations into display blocks using the exact same
// Barnes/non-Barnes session logic that enforces the daily session limit.
// Players sharing an identical block are merged into one `players` array.
export function courtSessionBlocks(reservations, { dateKey, location, court } = {}) {
  return buildReservationIndex(reservations).blocksForCourt({ dateKey, location, court })
}

// Finds one player's reservations across every location and date, accepting
// either the canonical `Last, First` value or the displayed `First Last` form.
// Entries are split by calendar date into Past / Current / Upcoming; a current
// session is "Ended" only after all of its 30-minute parts have completed.
export function playerReservationSections(reservations, player, { nowMs = Date.now() } = {}) {
  return buildReservationIndex(reservations).sectionsForPlayer(player, { nowMs })
}
