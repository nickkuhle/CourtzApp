import { getSchedule } from '../../lib/sheets.js'

// Vercel: allow the Apps Script round-trip to finish on serverless (the Hobby
// plan allows up to 60s). Local `next dev` ignores this.
export const maxDuration = 20

// One initial request provides both pieces of data the booking screen needs.
// This avoids making a second round-trip to Google Sheets just for the roster.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    // A forced refresh is used right after a write. On serverless hosts the POST
    // and GET routes may run in different workers, so clearing only the POST
    // worker's memory cache is not enough.
    const schedule = await getSchedule({ forceRefresh: req.query.refresh === '1' })
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
    // Expose only whether the server requires a code (never the code itself),
    // so the staff-approval modal can ask for it before attempting the write.
    const staffCodeRequired = Boolean(String(process.env.STAFF_APPROVAL_CODE || '').trim())
    return res.status(200).json({ ...schedule, staffCodeRequired })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Unable to load the schedule.' })
  }
}
