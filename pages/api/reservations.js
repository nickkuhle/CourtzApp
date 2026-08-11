import { readReservations, toggleReservation } from '../../lib/reservations'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const reservations = await readReservations()
      return res.status(200).json({ reservations })
    } catch (error) {
      console.error(error)
      return res.status(500).json({ error: 'Unable to read reservations.' })
    }
  }

  if (req.method === 'POST') {
    try {
      const { location, date, courtId, slot, name } = req.body || {}
      if (!location || !date || !courtId || !slot || !name) {
        return res.status(400).json({ error: 'Missing reservation payload.' })
      }

      await toggleReservation({ location, date, courtId, slot, name })
      // The client updates this one slot optimistically. Returning the entire
      // schedule here used to make every booking wait on a full Sheets re-read.
      return res.status(200).json({ success: true })
    } catch (error) {
      console.error(error)
      return res.status(500).json({ error: 'Unable to save reservation.' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
