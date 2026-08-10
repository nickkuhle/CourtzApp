// Pure helpers that convert between Google Sheets rows and the app's data model.
// These functions have no I/O so they can be tested without a network connection.

/**
 * Convert "Reservations" tab rows into the app's reservation map.
 * Each sheet row is one booking: { Date, Location, Court, Slot, Player }
 * The app shape is: { "Location|YYYY-MM-DD|courtId": { "8:00 AM–8:30 AM": ["Name", ...] } }
 */
export function rowsToReservations(rows) {
  const reservations = {}
  for (const row of rows) {
    const location = String(row.Location ?? '').trim()
    const date = String(row.Date ?? '').trim()
    const court = String(row.Court ?? '').trim()
    const slot = String(row.Slot ?? '').trim()
    const player = String(row.Player ?? '').trim()
    if (!location || !date || !court || !slot || !player) continue

    const key = `${location}|${date}|${court}`
    if (!reservations[key]) reservations[key] = {}
    if (!reservations[key][slot]) reservations[key][slot] = []
    if (!reservations[key][slot].includes(player)) reservations[key][slot].push(player)
  }
  return reservations
}

/**
 * Convert the app's reservation map back into "Reservations" tab rows
 * (one row per player booking).
 */
export function reservationsToRows(reservations) {
  const rows = []
  for (const [key, slots] of Object.entries(reservations || {})) {
    const [location, date, court] = key.split('|')
    for (const [slot, players] of Object.entries(slots || {})) {
      for (const player of Array.isArray(players) ? players : []) {
        rows.push({ Date: date, Location: location, Court: court, Slot: slot, Player: player })
      }
    }
  }
  return rows
}

/**
 * Convert "Roster" tab rows (header: Name) into an array of player names.
 * Also tolerates a "Player" header in case someone reuses the Reservations format.
 */
export function rowsToRoster(rows) {
  const names = []
  for (const row of rows) {
    const name = String(row.Name ?? row.Player ?? '').trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Convert "Sites" tab rows (headers: Location, Court) into
 * { locations: string[], courtsByLocation: { "Location": ["1", "2", ...] } }
 */
export function rowsToSites(rows) {
  const locations = []
  const courtsByLocation = {}
  for (const row of rows) {
    const location = String(row.Location ?? '').trim()
    const court = String(row.Court ?? '').trim()
    if (!location || !court) continue

    if (!courtsByLocation[location]) {
      courtsByLocation[location] = []
      locations.push(location)
    }
    if (!courtsByLocation[location].includes(court)) {
      courtsByLocation[location].push(court)
    }
  }
  return { locations, courtsByLocation }
}

/**
 * Extract the reservation map key for a sheet row.
 */
export function rowKey(row) {
  return `${String(row.Location ?? '').trim()}|${String(row.Date ?? '').trim()}|${String(row.Court ?? '').trim()}`
}
