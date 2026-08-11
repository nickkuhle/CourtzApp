// lib/reservations.js - Now powered by Google Sheets (with local fallback)
// See lib/sheets.js for actual logic. This file keeps the same API so nothing else breaks.

export { readReservations, writeReservations, toggleReservation, getRoster } from './sheets.js'
