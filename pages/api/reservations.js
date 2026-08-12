import { readReservations, toggleReservation, bookGroup, cancelGroup } from '../../lib/reservations.js'
import { getSchedule } from '../../lib/sheets.js'
import { validateBookingWindow, BookingWindowError } from '../../lib/booking-window.js'
import { validateSessionBooking, formatSessionWarning } from '../../lib/session-rules.js'

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

    const slotList = Array.isArray(slots) && slots.length ? slots : slot ? [slot] : []
    const nameList = Array.isArray(names) && names.length ? names : name ? [name] : []
    const staffApproved = body.staffApproved === true
    const activeLocations = Array.isArray(body.activeLocations) ? body.activeLocations : []

    try {
      // --- Booking window (today/tomorrow in America/Los_Angeles; ended
      // 30-minute slots cannot be booked or canceled). Enforced here so the
      // API cannot be bypassed by calling it directly.
      try {
        validateBookingWindow({ date, slots: slotList })
      } catch (error) {
        if (error instanceof BookingWindowError) {
          return res.status(400).json({ error: error.message })
        }
        throw error
      }

      if (action === 'book') {
        if (!slotList.length || !nameList.length) {
          return res.status(400).json({ error: 'Missing slots or players.' })
        }
        // Session rules are re-read (not cached) so stale browser data cannot
        // slip past the API. The Apps Script repeats the same check under its
        // write lock with even fresher data.
        const schedule = await getSchedule({ forceRefresh: true })
        const validation = validateSessionBooking({
          reservations: schedule.reservations,
          activeLocations,
          location,
          date,
          courtId: String(courtId),
          slots: slotList,
          names: nameList,
        })
        if (validation.overLimit.length) {
          const who = validation.overLimit.join(', ')
          return res.status(400).json({
            error: `${who} already ${validation.overLimit.length === 1 ? 'has' : 'have'} the maximum of 2 practice sessions for that day. The limit cannot be bypassed.`,
          })
        }
        if (validation.warnings.length && !staffApproved) {
          const who = [...new Set(validation.warnings.map((w) => w.player))]
          return res.status(409).json({ error: `STAFF_APPROVAL_REQUIRED: ${formatSessionWarning(who)}` })
        }
        await bookGroup({
          location,
          date,
          courtId,
          slots: slotList,
          names: nameList,
          staffApproved,
          activeLocations,
        })
        return res.status(200).json({ success: true, action: 'book' })
      }

      if (action === 'cancel') {
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
      const status = /STAFF_APPROVAL_REQUIRED/.test(error.message || '') ? 409 : 500
      return res.status(status).json({ error: error.message || 'Unable to save reservation.' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end(`Method ${req.method} Not Allowed`)
}
