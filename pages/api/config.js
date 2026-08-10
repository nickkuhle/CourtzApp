import { readRoster, readSites, isSheetsConfigured } from '../../lib/sheets'
import { DEFAULT_LOCATIONS, DEFAULT_COURTS_BY_LOCATION, DEFAULT_ROSTER } from '../../lib/defaults'

// Serves the sites + roster used by the UI. When Google Sheets is configured,
// this data comes live from the spreadsheet; otherwise it falls back to the
// hardcoded defaults so the app still runs in development.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    const [roster, sites] = await Promise.all([readRoster(), readSites()])

    const locations = sites?.locations?.length ? sites.locations : DEFAULT_LOCATIONS
    const courtsByLocation =
      sites && Object.keys(sites.courtsByLocation).length
        ? sites.courtsByLocation
        : DEFAULT_COURTS_BY_LOCATION
    const activeRoster = roster?.length ? roster : DEFAULT_ROSTER

    return res.status(200).json({
      sheetsConfigured: isSheetsConfigured(),
      locations,
      courtsByLocation,
      roster: activeRoster,
    })
  } catch (error) {
    console.error('Unable to load site config from Google Sheets:', error)
    return res.status(500).json({
      error: 'Unable to load site config. Check that the spreadsheet is shared with the service account and the tabs exist.',
      sheetsConfigured: isSheetsConfigured(),
      locations: DEFAULT_LOCATIONS,
      courtsByLocation: DEFAULT_COURTS_BY_LOCATION,
      roster: DEFAULT_ROSTER,
    })
  }
}
