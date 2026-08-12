import { readReservations, toggleReservation, bookGroup, cancelGroup } from '../../lib/reservations'

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
    const body = req.body || {}
    const { action, location, date, courtId, slot, slots, name, names } = body
    if (!location || !date || !courtId) {
      return res.status(400).json({ error: 'Missing reservation payload.' })
    }

    try {
      if (action === 'book') {
        const slotList = Array.isArray(slots) && slots.length ? slots : [slot]
        const nameList = Array.isArray(names) && names.length ? names : [name]
        if (!slotList.length || !nameList.length) {
          return res.status(400).json({ error: 'Missing slots or players.' })
        }
        await bookGroup({ location, date, courtId, slots: slotList, names: nameList })
        return res.status(200).json({ success: true, action: 'book' })
      }

      if (action === 'cancel') {
        const slotList = Array.isArray(slots) && slots.length ? slots : [slot]
        const nameList = Array.isArray(names) && names.length ? names : [name]
        if (!slotList.length || !nameList.length) {
          return res.status(400).json({ error: 'Missing slots or players.' })
        }
        await cancelGroup({ location, date, courtId, slots: slotList, names: nameList })
        return res.status(200).json({ success: true, action: 'cancel' })
      }

      // Legacy single-player toggle
      if (!slot || !name) {
        return res.status(400).json({ error: 'Missing reservation payload.' })
      }
      await toggleReservation({ location, date, courtId, slot, name })
      // The client updates this one slot optimistically. Returning the entire
      // schedule here used to make every booking wait on a full Sheets re-read.
      return res.status(200).json({ success: true })
    } catch (error) {
      console.error(error)
      return res.status(500).json({ error: error.message || 'Unable to save reservation.' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
