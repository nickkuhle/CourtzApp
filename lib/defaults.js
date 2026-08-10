// Fallback values used when the Google Sheets integration is not configured.
// Once GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_SPREADSHEET_ID
// are set in .env.local, the app pulls this data live from the spreadsheet instead.

export const DEFAULT_LOCATIONS = [
  'Barnes Tennis Center',
  'Peninsula Tennis Club',
  'Point Loma Nazarene College',
]

export const DEFAULT_COURTS_BY_LOCATION = {
  'Barnes Tennis Center': [4, 5],
  'Peninsula Tennis Club': [1, 2, 7, 8, 9, 10, 11, 12],
  'Point Loma Nazarene College': [1, 2, 3, 4, 5, 6],
}

export const DEFAULT_ROSTER = [
  'Alice Johnson',
  'Becca Smith',
  'Carla Gomez',
  'Diana Lee',
  'Eva Martinez',
  'Fiona Chen',
  'Grace Park',
  'Hannah Kim',
]
