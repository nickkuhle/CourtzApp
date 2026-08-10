import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import {
  rowsToReservations,
  reservationsToRows,
  rowsToRoster,
  rowsToSites,
  rowKey,
} from './sheetMappers'
import {
  readReservations as readLocalReservations,
  writeReservations as writeLocalReservations,
  toggleReservation as toggleLocalReservation,
} from './reservations'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
// The app talks to Google Sheets when these env vars are present. Otherwise it
// silently falls back to the local data/reservations.json store so the app
// still runs during development.
//
//   GOOGLE_SPREADSHEET_ID          e.g. "1AbC...xyz" (from the sheet's URL)
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   e.g. "courtz-app@my-project.iam.gserviceaccount.com"
//   GOOGLE_PRIVATE_KEY             e.g. "-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
//
// Tab names can be overridden with the env vars below if your spreadsheet uses
// different tab names.
export const SHEET_TABS = {
  ROSTER: process.env.GOOGLE_SHEETS_ROSTER_TAB || 'Roster',
  SITES: process.env.GOOGLE_SHEETS_SITES_TAB || 'Sites',
  RESERVATIONS: process.env.GOOGLE_SHEETS_RESERVATIONS_TAB || 'Reservations',
}

export function isSheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_SPREADSHEET_ID
  )
}

// ---------------------------------------------------------------------------
// Google Sheets client (lazy singleton)
// ---------------------------------------------------------------------------
let docPromise = null

async function getDoc() {
  if (!isSheetsConfigured()) return null
  if (!docPromise) {
    const auth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // The private key is often stored with literal "\n" escapes; normalize them.
      key: String(process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREADSHEET_ID, auth)
    docPromise = doc
      .loadInfo()
      .then(() => doc)
      .catch((error) => {
        // Don't cache failures — allow retries on the next request.
        docPromise = null
        throw error
      })
  }
  return docPromise
}

async function getSheet(title) {
  const doc = await getDoc()
  const sheet = doc && doc.sheetsByTitle[title]
  if (!sheet) {
    throw new Error(
      `Google Sheet is missing the "${title}" tab. Create it (or set GOOGLE_SHEETS_*_TAB to the correct tab name).`
    )
  }
  return sheet
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
export async function readRoster() {
  if (!isSheetsConfigured()) return null
  const sheet = await getSheet(SHEET_TABS.ROSTER)
  await sheet.loadHeaderRow()
  const rows = await sheet.getRows()
  return rowsToRoster(rows)
}

// ---------------------------------------------------------------------------
// Sites (locations and their court numbers)
// ---------------------------------------------------------------------------
export async function readSites() {
  if (!isSheetsConfigured()) return null
  const sheet = await getSheet(SHEET_TABS.SITES)
  await sheet.loadHeaderRow()
  const rows = await sheet.getRows()
  return rowsToSites(rows)
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------
export async function readReservations() {
  if (!isSheetsConfigured()) return readLocalReservations()
  const sheet = await getSheet(SHEET_TABS.RESERVATIONS)
  await sheet.loadHeaderRow()
  const rows = await sheet.getRows()
  return rowsToReservations(rows)
}

export async function writeReservations(data) {
  if (!isSheetsConfigured()) return writeLocalReservations(data)
  const sheet = await getSheet(SHEET_TABS.RESERVATIONS)
  await sheet.loadHeaderRow()
  await sheet.clear()
  const rows = reservationsToRows(data)
  if (rows.length) await sheet.addRows(rows)
  return data
}

export async function toggleReservation({ location, date, courtId, slot, name }) {
  if (!isSheetsConfigured()) {
    return toggleLocalReservation({ location, date, courtId, slot, name })
  }

  if (!location || !date || !slot || !name) {
    throw new Error('Missing reservation fields')
  }

  const sheet = await getSheet(SHEET_TABS.RESERVATIONS)
  await sheet.loadHeaderRow()
  const rows = await sheet.getRows()
  const reservations = rowsToReservations(rows)

  // Apply the same toggle logic used by the local JSON store.
  const key = `${location}|${date}|${courtId}`
  const current = { ...(reservations[key] || {}) }
  const arr = Array.isArray(current[slot]) ? [...current[slot]] : []
  const index = arr.indexOf(name)

  if (index !== -1) {
    arr.splice(index, 1)
    if (arr.length) {
      current[slot] = arr
    } else {
      delete current[slot]
    }
  } else {
    arr.push(name)
    current[slot] = arr
  }

  if (Object.keys(current).length > 0) {
    reservations[key] = current
  } else {
    delete reservations[key]
  }

  // Sync the spreadsheet: remove the rows for this date/location/court, then
  // write back the updated rows for that key. Everything else in the sheet is
  // left untouched.
  const toDelete = rows.filter((row) => rowKey(row) === key)
  // Delete from the bottom up so row numbers stay valid.
  const sorted = [...toDelete].sort((a, b) => b.rowNumber - a.rowNumber)
  for (const row of sorted) {
    await sheet.deleteRows(row.rowNumber - 1, row.rowNumber)
  }

  const newRows = reservationsToRows(reservations).filter(
    (r) => `${r.Location}|${r.Date}|${r.Court}` === key
  )
  if (newRows.length) await sheet.addRows(newRows)

  return reservations
}
