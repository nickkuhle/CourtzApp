import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import CourtGrid from '../components/CourtGrid'
import CourtCardCarousel from '../components/CourtCardCarousel'
import GroupBookingModal from '../components/GroupBookingModal'
import PlayerSwitcher from '../components/PlayerSwitcher'
import PlayerReservationsModal from '../components/PlayerReservationsModal'
import DayCarousel from '../components/DayCarousel'
import DaySlide from '../components/DaySlide'
import SiteOverview from '../components/SiteOverview'
import {
  laNow,
  laDayOffset,
  isBookableDay,
  isSlotCompleted,
  existingPlayerSessions,
  validateBooking,
  getSlotTapIntent,
  MAX_SESSIONS_PER_DAY,
} from '../lib/booking-rules'
import { DEFAULT_PRACTICE_LOCATIONS, MATCH_PLAY_LOCATIONS, isBarnesLocation } from '../lib/locations'

const LOGO_URL = '/logo.svg'
const MAX_PLAYERS_PER_SLOT = 4

// Fallback lists used only when the sheet cannot be reached or a legacy
// deployment does not report metadata. The three practice sites are shown by
// default; USD, Balboa and Pacific Beach are match-play sites that stay hidden
// until the desk adds them with the + button.
const REMEMBERED_LOCATIONS_KEY = 'courtz.activePracticeLocations'

const FALLBACK_COURTS_BY_LOCATION = {
  'Barnes Tennis Center': [4, 5, 6],
  'Peninsula Tennis Club': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  'Point Loma Nazarene College': [1, 2, 3, 4, 5, 6],
}

const LOCATION_SHORT = {
  'Barnes Tennis Center': 'Barnes',
  'Peninsula Tennis Club': 'Peninsula',
  'Point Loma Nazarene College': 'PLNU',
  'Pacific Beach Tennis Club': 'Pacific Beach',
  'Balboa Tennis Center': 'Balboa',
  'USD': 'USD',
}

// Roster - now loaded live from Google Sheets (fallback to fake names if not configured)
const FALLBACK_ROSTER = [
  'Alice Johnson',
  'Becca Smith',
  'Carla Gomez',
  'Diana Lee',
  'Eva Martinez',
  'Fiona Chen',
  'Grace Park',
  'Hannah Kim',
]

const PLAYER_PASSCODES = {
  alice: 'Alice Johnson',
  becca: 'Becca Smith',
  carla: 'Carla Gomez',
  diana: 'Diana Lee',
  eva: 'Eva Martinez',
  fiona: 'Fiona Chen',
  grace: 'Grace Park',
  hannah: 'Hannah Kim',
}

function getPlayerFromUrl() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  const player = params.get('player')
  const passcode = params.get('passcode')
  if (player) {
    try {
      return decodeURIComponent(player)
    } catch {
      // A malformed ?player=... value must never crash the page.
      return ''
    }
  }
  if (passcode) return PLAYER_PASSCODES[passcode.toLowerCase()] || ''
  return ''
}

function formatDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDateShort(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

function formatDateDay(d) {
  return d.toLocaleDateString(undefined, { day: 'numeric' })
}

function formatDateLong(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// Dates are formatted with the LOCAL parts of 'YYYY-MM-DD' (which is exactly
// how the sheet reports them). toISOString() would use UTC and could shift an
// evening booking to the following day.
function dateKeyToLocalDate(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatTimeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  const displayMinutes = String(minutes).padStart(2, '0')
  return `${displayHours}:${displayMinutes} ${suffix}`
}

const THIRTY_MIN_SLOTS = (() => {
  const labels = []
  for (let t = 8 * 60; t <= 18 * 60; t += 30) {
    labels.push(`${formatTimeLabel(t)}–${formatTimeLabel(t + 30)}`)
  }
  return labels
})()

// Builds the day pills from the dates reported by the sheet (past, current and
// future are all shown and all remain clickable). Only today and tomorrow are
// bookable; every other day is marked "View only".
function buildDayObjects(dates) {
  const { dateKey: todayKey } = laNow()
  return (dates || [])
    .map((key) => {
      const [y, m, d] = String(key).split('-').map(Number)
      if (!y || !m || !d) return null
      const dateObj = new Date(y, m - 1, d)
      const offset = laDayOffset(key)
      return {
        label: formatDate(dateObj),
        key,
        dayName: formatDateShort(dateObj),
        dayNum: formatDateDay(dateObj),
        isToday: key === todayKey,
        offset,
        bookable: isBookableDay(key),
        dateObj,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
}

// Default day: today when it exists in the sheet, otherwise the next date on or
// after today, otherwise the last (most recent) date.
function pickDefaultDay(days) {
  if (!days.length) return ''
  const { dateKey: todayKey } = laNow()
  const hit = days.find((d) => d.key === todayKey)
  if (hit) return hit.key
  const future = days.find((d) => d.key >= todayKey)
  return future ? future.key : days[days.length - 1].key
}

// Courts a player can act on for one window (one or more consecutive 30-minute
// parts): courts that have at least one free spot (<4 players) for every part,
// plus courts already booked by that player (so they can cancel from the same list).
// Fixed to allow shared bookings: previously anyTaken blocked other players even when 3 spots were open.
function findCourtsForBooking(courtsList, reservations, location, dateKey, slots, name) {
  return (courtsList || [])
    .map((courtId) => {
      const parts = slots.map((slot) => {
        const players = reservations[`${location}|${dateKey}|${courtId}`]?.[slot]
        return Array.isArray(players) ? players : []
      })
      const mine = parts.some((p) => p.includes(name))
      const full = parts.some((p) => p.length >= MAX_PLAYERS_PER_SLOT && !p.includes(name))
      if (full) return null
      const maxOccupancy = Math.max(0, ...parts.map((p) => p.length))
      return { location, courtId, mine, occupancy: maxOccupancy }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.courtId - b.courtId)
}

function loadRememberedLocations() {
  if (typeof window === 'undefined') return null
  try {
    const saved = JSON.parse(window.localStorage.getItem(REMEMBERED_LOCATIONS_KEY) || 'null')
    if (Array.isArray(saved) && saved.length) return saved
  } catch {}
  return null
}

function saveRememberedLocations(list) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(REMEMBERED_LOCATIONS_KEY, JSON.stringify(list))
  } catch {}
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [days, setDays] = useState([])
  const [selectedDay, setSelectedDay] = useState('')
  const [locations, setLocations] = useState(DEFAULT_PRACTICE_LOCATIONS) // every location the Sheet knows
  const [activeLocations, setActiveLocations] = useState(DEFAULT_PRACTICE_LOCATIONS) // the ones shown as practice sites
  const [courtsByDate, setCourtsByDate] = useState({})
  const [selectedLocation, setSelectedLocation] = useState('')
  const [selectedCourt, setSelectedCourt] = useState(null)
  const [currentPlayer, setCurrentPlayer] = useState('')
  const [showAddLocation, setShowAddLocation] = useState(false)
  const [showSiteOverview, setShowSiteOverview] = useState(false)

  const [reservations, setReservations] = useState({})
  const [roster, setRoster] = useState(FALLBACK_ROSTER)
  const [rosterLoaded, setRosterLoaded] = useState(false)
  const [pendingReservations, setPendingReservations] = useState({})
  const [showFindCourt, setShowFindCourt] = useState(false)
  const [showPlayerReservations, setShowPlayerReservations] = useState(false)
  const [findLocation, setFindLocation] = useState('')
  const [findDay, setFindDay] = useState('')
  const [findDuration, setFindDuration] = useState(30)
  const [findTime, setFindTime] = useState('')
  const [findNotice, setFindNotice] = useState(null)
  const [bookingModal, setBookingModal] = useState(null) // {mode, courtId, slots, players, bookedPlayers, title, subtitle}
  const [sheetsConnected, setSheetsConnected] = useState(null) // null = still loading/unknown
  const [staffCodeRequired, setStaffCodeRequired] = useState(false)
  const lastScheduleSync = useRef(0)
  const currentPlayerRef = useRef('')

  // Update the ref in the same event that changes the visible selection. React
  // may not have rendered the new player into every court slot yet when a user
  // switches names and immediately taps a time; the booking handler can still
  // read the exact latest choice synchronously from this ref.
  const handleSelectPlayer = useCallback((name) => {
    const nextPlayer = String(name || '').trim()
    currentPlayerRef.current = nextPlayer
    setCurrentPlayer(nextPlayer)
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    handleSelectPlayer(getPlayerFromUrl())
  }, [handleSelectPlayer])

  // Remembered practice locations (the + button additions survive reloads).
  useEffect(() => {
    const saved = loadRememberedLocations()
    if (saved) setActiveLocations(saved)
  }, [])

  useEffect(() => {
    if (mounted) saveRememberedLocations(activeLocations)
  }, [activeLocations, mounted])

  // Loads the full schedule (reservations + roster + dates + courts). The
  // response also reports whether the server is actually wired to Google
  // Sheets; when it is not, a warning banner is shown instead of silently
  // presenting empty data.
  const refreshSchedule = useCallback(async (force = false) => {
    try {
      const response = await fetch(force ? '/api/schedule?refresh=1' : '/api/schedule')
      if (!response.ok) throw new Error('Failed to load schedule')
      const result = await response.json()
      lastScheduleSync.current = Date.now()
      setReservations(result.reservations || {})
      if (Array.isArray(result.roster) && result.roster.length > 0) setRoster(result.roster)
      if (Array.isArray(result.locations) && result.locations.length > 0) setLocations(result.locations)
      if (result.courtsByDate && typeof result.courtsByDate === 'object') setCourtsByDate(result.courtsByDate)
      if (Array.isArray(result.days) && result.days.length > 0) {
        const dayObjects = buildDayObjects(result.days)
        setDays(dayObjects)
        setSelectedDay((prev) => {
          if (prev && dayObjects.some((d) => d.key === prev)) return prev
          return pickDefaultDay(dayObjects)
        })
      }
      setSheetsConnected(result.connected === true)
      setStaffCodeRequired(result.staffCodeRequired === true)
      return true
    } catch (e) {
      console.warn('Unable to load schedule from the server', e)
      setSheetsConnected(false)
      return false
    } finally {
      setRosterLoaded(true)
    }
  }, [])

  useEffect(() => {
    refreshSchedule()
  }, [refreshSchedule])

  // Pick up bookings made by other players (or direct sheet edits) when the
  // tab is revisited, without hammering the Sheets backend.
  useEffect(() => {
    function handleWindowFocus() {
      if (Date.now() - lastScheduleSync.current > 30_000) refreshSchedule()
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
  }, [refreshSchedule])

  useEffect(() => {
    if (rosterLoaded && currentPlayer && roster.length > 0 && !roster.includes(currentPlayer)) {
      handleSelectPlayer('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterLoaded])

  // Keep the default selection in sync with the very first data load.
  useEffect(() => {
    if (days.length && !selectedDay) {
      setSelectedDay(pickDefaultDay(days))
    }
    if (days.length && !selectedLocation) {
      setSelectedLocation(activeLocations[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length])

  // Never let the selected day or location drift outside what is available.
  useEffect(() => {
    if (days.length && selectedDay && !days.some((d) => d.key === selectedDay)) {
      setSelectedDay(pickDefaultDay(days))
      setSelectedCourt(null)
    }
  }, [days, selectedDay])

  useEffect(() => {
    if (selectedLocation && activeLocations.length && !activeLocations.includes(selectedLocation)) {
      setSelectedLocation(activeLocations[0])
      setSelectedCourt(null)
    }
  }, [activeLocations, selectedLocation])

  useEffect(() => {
    setReservations((prev) => {
      const next = { ...prev }
      let changed = false
      Object.keys(next).forEach((key) => {
        const slots = next[key]
        if (slots && typeof slots === 'object') {
          Object.keys(slots).forEach((s) => {
            const v = slots[s]
            if (v && !Array.isArray(v)) {
              slots[s] = [v]
              changed = true
            }
          })
        }
      })
      return changed ? next : prev
    })
  }, [])

  // --- Booking window (America/Los_Angeles) --------------------------------
  // Only today and tomorrow can be booked or changed. Other days stay fully
  // visible ("View only"), and 30-minute slots that have ended are locked too
  // (the current slot stays available: at 1:15 PM, 1:00-1:30 PM is still open
  // but 12:30-1:00 PM is not).
  const dayOffset = selectedDay ? laDayOffset(selectedDay) : null
  const viewOnlyDate = dayOffset === null || !isBookableDay(selectedDay)

  const completedSlots = useMemo(() => {
    const set = new Set()
    if (!selectedDay) return set
    THIRTY_MIN_SLOTS.forEach((label) => {
      if (isSlotCompleted(selectedDay, label)) set.add(label)
    })
    return set
  }, [selectedDay])

  const findCompletedSlots = useMemo(() => {
    const set = new Set()
    if (!findDay) return set
    THIRTY_MIN_SLOTS.forEach((label) => {
      if (isSlotCompleted(findDay, label)) set.add(label)
    })
    return set
  }, [findDay])

  const bookableDays = useMemo(() => days.filter((d) => d.bookable), [days])

  // Courts for the selected day + location, discovered from the sheet's court
  // header rows (empty courts included). Falls back to the known venue lists.
  const courts = useMemo(() => {
    const discovered = courtsByDate[selectedDay]?.[selectedLocation]
    if (Array.isArray(discovered) && discovered.length) {
      return discovered.map((number) => ({ id: number, number, location: selectedLocation, date: selectedDay }))
    }
    // Legacy fallback: derive from reservation keys, then from the known lists.
    const fromKeys = Object.keys(reservations)
      .filter((k) => k.startsWith(`${selectedLocation}|${selectedDay}|`))
      .map((k) => Number(k.split('|')[2]))
      .filter((n) => !isNaN(n))
    const ids = fromKeys.length ? [...new Set(fromKeys)].sort((a, b) => a - b) : (FALLBACK_COURTS_BY_LOCATION[selectedLocation] || [])
    return ids.map((number) => ({ id: number, number, location: selectedLocation, date: selectedDay }))
  }, [courtsByDate, selectedDay, selectedLocation, reservations])

  // How many practice sessions the signed-in player has on the selected day
  // (across every active practice location). Barnes 30-minute slots count one
  // each; elsewhere two consecutive 30-minute slots count as one session.
  const mySessionsToday = useMemo(() => {
    if (!selectedDay || !currentPlayer) return []
    return existingPlayerSessions(reservations, {
      dateKey: selectedDay,
      name: currentPlayer,
      practiceLocations: activeLocations,
    })
  }, [reservations, selectedDay, currentPlayer, activeLocations])

  const timeLabelToMinutes = useCallback((label) => {
    const m = String(label).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
    if (!m) return 0
    let h = Number(m[1])
    const min = Number(m[2])
    const ap = (m[3] || '').toUpperCase()
    if (ap === 'PM' && h !== 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    return h * 60 + min
  }, [])

  // 30-minute parts that make up the requested window. Barnes only ever
  // offers 30-minute bookings, even if a 1-hour length was chosen earlier.
  const findSlots = useMemo(() => {
    if (!findTime) return []
    const duration = isBarnesLocation(findLocation) ? 30 : findDuration
    const parts = [findTime]
    if (duration === 60) {
      const startMinutes = timeLabelToMinutes(findTime.split('–')[0])
      parts.push(`${formatTimeLabel(startMinutes + 30)}–${formatTimeLabel(startMinutes + 60)}`)
    }
    return parts
  }, [findTime, findDuration, findLocation, timeLabelToMinutes])

  // Recomputed on every render of the modal, so results stay accurate even
  // right after a booking is made from inside Find a Court.
  const findCourts = useMemo(() => {
    if (!showFindCourt || !findLocation || !findDay || !findSlots.length) return []
    return findCourtsForBooking(courtsByDate[findDay]?.[findLocation] || [], reservations, findLocation, findDay, findSlots, currentPlayer)
  }, [showFindCourt, findLocation, findDay, findSlots, reservations, currentPlayer, courtsByDate])

  const handleSelectCourt = useCallback((id) => {
    setSelectedCourt(id)
  }, [])

  // A refresh can drop a court that was open; never leave the carousel on a
  // court that is no longer in the selected location/day.
  useEffect(() => {
    if (selectedCourt == null) return
    if (!courts.length || !courts.some((court) => court.id === selectedCourt)) setSelectedCourt(null)
  }, [courts, selectedCourt])

  // --- Atomic group booking / cancellation --------------------------------
  // The optimistic UI change is applied immediately, then the whole group is
  // written to the sheet in one request; on failure every name is rolled back
  // so a half-saved group is never shown or stored.
  const handleGroupWrite = useCallback(async ({ mode, location, date, courtId, slots, names, staffApproved = false, staffCode = null }) => {
    const reservationKey = `${location}|${date}|${courtId}`
    const requestKey = `${mode}|${reservationKey}|${slots.join(',')}|${names.join(',')}`
    if (pendingReservations[requestKey]) return

    // Snapshot the affected slots so a failed write can be undone exactly.
    const snapshot = {}
    // Use functional read to avoid stale closure
    setReservations((current) => {
      slots.forEach((slot) => {
        snapshot[slot] = [...((current[reservationKey]?.[slot] || []) )]
      })
      return current
    })

    setPendingReservations((pending) => ({ ...pending, [requestKey]: true }))
    setReservations((current) => {
      const next = { ...current }
      const courtReservations = { ...(next[reservationKey] || {}) }
      slots.forEach((slot) => {
        const list = Array.isArray(courtReservations[slot]) ? [...courtReservations[slot]] : []
        if (mode === 'cancel') {
          names.forEach((n) => {
            const i = list.indexOf(n)
            if (i >= 0) list.splice(i, 1)
          })
        } else {
          names.forEach((n) => { if (!list.includes(n)) list.push(n) })
        }
        if (list.length) courtReservations[slot] = list
        else delete courtReservations[slot]
      })
      if (Object.keys(courtReservations).length) next[reservationKey] = courtReservations
      else delete next[reservationKey]
      return next
    })

    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode, location, date, courtId, slots, names, staffApproved, staffCode, practiceLocations: activeLocations }),
      })
      if (!response.ok) {
        let message = 'Unable to save reservation'
        let code = null
        let staffCodeRequired = false
        try {
          const body = await response.json()
          if (body?.error) message = body.error.replace(/^Error:\s*/i, '')
          code = body?.code || null
          staffCodeRequired = body?.staffCodeRequired === true
        } catch {}
        if (code === 'STAFF_APPROVAL_REQUIRED') {
          message = 'Tournament staff approval is required for this booking. Confirm the approval step and try again.'
        }
        const error = new Error(message)
        error.code = code
        error.staffCodeRequired = staffCodeRequired
        throw error
      }
      // Re-sync from the sheet shortly after the write so the local view
      // always settles on what the backend actually stored. Use longer delay
      // to allow Sheets to settle, but don't block UI.
      setTimeout(() => refreshSchedule(true), 1500)
      return true
    } catch (e) {
      console.error('Failed saving reservation', e)
      // Roll back exactly what this request changed.
      setReservations((current) => {
        const next = { ...current }
        const courtReservations = { ...(next[reservationKey] || {}) }
        slots.forEach((slot) => {
          courtReservations[slot] = [...(snapshot[slot] || [])]
          if (!courtReservations[slot].length) delete courtReservations[slot]
        })
        if (Object.keys(courtReservations).length) next[reservationKey] = courtReservations
        else delete next[reservationKey]
        return next
      })
      throw e
    } finally {
      setPendingReservations((pending) => {
        const next = { ...pending }
        delete next[requestKey]
        return next
      })
    }
  }, [pendingReservations, activeLocations, refreshSchedule])

  // Session-limit / approval evaluation used by the booking modal. It is
  // recomputed with the modal's CURRENT player list, so adding a player who is
  // over the limit is caught before anything is sent.
  const evaluateBookingRules = useCallback((players) => {
    const modal = bookingModal
    if (!modal || modal.mode !== 'book') return { ok: true, warning: null, error: null }
    const names = [...new Set(players.map((n) => String(n).trim()).filter(Boolean))]
    if (!names.length) return { ok: true, warning: null, error: null }
    const result = validateBooking({
      action: 'book',
      location: modal.location,
      date: modal.date,
      courtId: modal.courtId,
      slots: modal.slots,
      names,
      staffApproved: false,
      reservations,
      practiceLocations: activeLocations,
    })
    if (!result.ok) return { ok: false, warning: null, error: result.error }
    if (result.warnings.length) return { ok: true, warning: result.warnings.join(' '), error: null }
    return { ok: true, warning: null, error: null }
  }, [bookingModal, reservations, activeLocations])

  const handleConfirmGroupBooking = useCallback(async (players, opts = {}) => {
    const modal = bookingModal
    if (!modal) return
    const slots = modal.slots
    // Keep only players that are still relevant (all of them for a booking).
    const names = [...new Set(players.map((n) => String(n).trim()).filter(Boolean))]
    const staffApproved = Boolean(opts.staffApproved)
    const staffCode = opts.staffCode || null

    const validation = validateBooking({
      action: modal.mode,
      location: modal.location,
      date: modal.date,
      courtId: modal.courtId,
      slots,
      names,
      staffApproved,
      reservations,
      practiceLocations: activeLocations,
    })
    if (!validation.ok) throw new Error(validation.error)
    if (modal.mode === 'book' && validation.warnings.length && !staffApproved) {
      throw new Error('Tournament staff approval is required for this booking.')
    }

    if (modal.mode === 'book') {
      await handleGroupWrite({ mode: 'book', location: modal.location, date: modal.date, courtId: modal.courtId, slots, names, staffApproved, staffCode })
      setBookingModal(null)
      if (modal.origin === 'find') {
        setFindNotice(`Booked Court ${modal.courtId} at ${LOCATION_SHORT[modal.location] || modal.location} for ${slots.join(' and ')}.`)
        setFindTime('')
      }
    } else {
      await handleGroupWrite({ mode: 'cancel', location: modal.location, date: modal.date, courtId: modal.courtId, slots, names })
      setBookingModal(null)
      if (modal.origin === 'find') {
        setFindNotice(`Canceled the booking on Court ${modal.courtId} at ${LOCATION_SHORT[modal.location] || modal.location}.`)
      }
    }
  }, [bookingModal, reservations, activeLocations, handleGroupWrite])

  const openFindCourt = useCallback(() => {
    const preferred = selectedDay && isBookableDay(selectedDay)
      ? selectedDay
      : (bookableDays[0]?.key || '')
    if (!preferred) {
      alert('Bookings are only available for today and tomorrow.')
      return
    }
    setFindDay(preferred)
    setFindLocation(selectedLocation || activeLocations[0])
    setFindDuration(30) // Barnes is 30-minute only; other sites can extend to 60 in step 3
    setFindTime('')
    setFindNotice(null)
    setShowFindCourt(true)
  }, [selectedDay, bookableDays, selectedLocation, activeLocations])

  // Find a Court result: open the group-booking dialog for the chosen court
  // (or the cancellation dialog when the current player already has a booking
  // in the window). Now allows shared occupancy up to 4 players.
  // Supports blank currentPlayer and prevents duplicate booking by excluding
  // already-booked players from additional players search.
  const handleFindCourtPick = useCallback((courtId) => {
    if (!findDay || !isBookableDay(findDay)) {
      alert('Bookings are only available for today and tomorrow.')
      return
    }
    const slotPlayersList = findSlots.map((slot) => reservations[`${findLocation}|${findDay}|${courtId}`]?.[slot] || [])
    const allPlayers = [...new Set(slotPlayersList.flat())]
    const mine = currentPlayer ? allPlayers.includes(currentPlayer) : false
    const full = currentPlayer
      ? slotPlayersList.some((players) => players.length >= MAX_PLAYERS_PER_SLOT && !players.includes(currentPlayer))
      : slotPlayersList.some((players) => players.length >= MAX_PLAYERS_PER_SLOT)

    if (mine) {
      setBookingModal({
        origin: 'find',
        mode: 'cancel',
        location: findLocation,
        date: findDay,
        courtId,
        slots: findSlots,
        players: allPlayers,
        bookedPlayers: [],
        title: `Cancel Court ${courtId}`,
        subtitle: `${findLocation} · ${formatDateLong(dateKeyToLocalDate(findDay))}`,
      })
      return
    }
    if (full) {
      alert(`Court ${courtId} is fully booked (${MAX_PLAYERS_PER_SLOT}/${MAX_PLAYERS_PER_SLOT}) for that time. Pick another court.`)
      return
    }
    // When currentPlayer is blank, allow opening booking modal with empty list;
    // validation for empty will be done inside modal after player selection.
    const namesForValidation = currentPlayer ? [currentPlayer] : []
    if (namesForValidation.length) {
      const validation = validateBooking({
        action: 'book',
        location: findLocation,
        date: findDay,
        courtId,
        slots: findSlots,
        names: namesForValidation,
        staffApproved: false,
        reservations,
        practiceLocations: activeLocations,
      })
      if (!validation.ok) {
        alert(validation.error)
        return
      }
    }
    setBookingModal({
      origin: 'find',
      mode: 'book',
      location: findLocation,
      date: findDay,
      courtId,
      slots: findSlots,
      players: namesForValidation,
      bookedPlayers: allPlayers,
      title: `Book Court ${courtId}`,
      subtitle: `${findLocation} · ${formatDateLong(dateKeyToLocalDate(findDay))}`,
    })
  }, [findDay, findLocation, findSlots, reservations, currentPlayer, activeLocations])

  // Jumps from Find a Court to the full schedule for one court so the booking
  // can be viewed or adjusted.
  const openCourtSchedule = useCallback((location, dateKey, courtId) => {
    setSelectedLocation(location)
    setSelectedDay(dateKey)
    setSelectedCourt(courtId)
    setShowFindCourt(false)
  }, [])

  // Called by the CourtSchedule modal when a slot is tapped.
  // Supports blank currentPlayer: user can click court and time slot, then add
  // any players in booking modal. Also prevents duplicate booking by passing
  // bookedPlayers to modal so already-booked players are excluded from search.
  const handleOpenBooking = useCallback(({ source = 'direct', mode, slots, players, courtId, location, date }) => {
    const bookingCourt = courtId ?? selectedCourt
    const bookingLocation = location || selectedLocation
    const bookingDate = date || selectedDay
    if (viewOnlyDate) {
      alert('This day is view only — bookings and cancellations are only available for today and tomorrow.')
      return
    }
    const dateObj = dateKeyToLocalDate(bookingDate)
    const reservationKey = `${bookingLocation}|${bookingDate}|${bookingCourt}`
    const bookedPlayers = [...new Set((slots || []).flatMap((slot) => reservations[reservationKey]?.[slot] || []))]
    const eventPlayers = [...new Set((players || []).map((name) => String(name).trim()).filter(Boolean))]

    // A court-slot tap is resolved again here using the player switcher's
    // synchronous ref. This is intentionally independent of the child card's
    // captured `mode` and `players`: if the card rendered Player A one moment
    // before the switch to Player X, the tap still books X into A's open slot.
    // Explicit x buttons and reservation cards retain their supplied cancel
    // intent because they use source="direct".
    const slotIntent = source === 'slot'
      ? getSlotTapIntent(bookedPlayers, currentPlayerRef.current)
      : null
    const effectiveMode = slotIntent?.mode || mode
    const effectivePlayers = slotIntent?.players || eventPlayers

    if (source === 'slot' && effectiveMode === 'book' && bookedPlayers.length >= MAX_PLAYERS_PER_SLOT) {
      alert(`That slot is fully booked (${MAX_PLAYERS_PER_SLOT}/${MAX_PLAYERS_PER_SLOT}).`)
      return
    }

    if (effectiveMode === 'cancel') {
      const validation = validateBooking({
        action: 'cancel',
        location: bookingLocation,
        date: bookingDate,
        courtId: bookingCourt,
        slots,
        names: effectivePlayers,
        staffApproved: false,
        reservations,
        practiceLocations: activeLocations,
      })
      if (!validation.ok) {
        alert(validation.error)
        return
      }
      setBookingModal({
        origin: 'schedule',
        mode: 'cancel',
        location: bookingLocation,
        date: bookingDate,
        courtId: bookingCourt,
        slots,
        players: effectivePlayers,
        bookedPlayers: [],
        title: `Cancel Court ${bookingCourt}`,
        subtitle: `${bookingLocation} · ${formatDateLong(dateObj)}`,
      })
      return
    }

    if (effectivePlayers.length) {
      const validation = validateBooking({
        action: 'book',
        location: bookingLocation,
        date: bookingDate,
        courtId: bookingCourt,
        slots,
        names: effectivePlayers,
        staffApproved: false,
        reservations,
        practiceLocations: activeLocations,
      })
      if (!validation.ok) {
        alert(validation.error)
        return
      }
    }
    setBookingModal({
      origin: 'schedule',
      mode: 'book',
      location: bookingLocation,
      date: bookingDate,
      courtId: bookingCourt,
      slots,
      players: effectivePlayers,
      bookedPlayers,
      title: `Book Court ${bookingCourt}`,
      subtitle: `${bookingLocation} · ${formatDateLong(dateObj)}`,
    })
  }, [selectedCourt, selectedLocation, selectedDay, viewOnlyDate, reservations, activeLocations])

  // Called by the Player's reservations dialog when a current or upcoming
  // reservation is tapped. The whole group booked in that window is
  // pre-selected in the cancellation dialog so individual players can be
  // removed from the request before confirming. Slots that have already ended
  // are never sent.
  const handleCancelPlayerReservation = useCallback((entry) => {
    const { location, date, court } = entry
    if (!isBookableDay(date)) {
      alert('This reservation is on a view-only day and can no longer be changed.')
      return
    }
    const cancellableSlots = (entry.slots || []).filter((slot) => !isSlotCompleted(date, slot))
    if (!cancellableSlots.length) {
      alert('This reservation has already ended and can no longer be canceled.')
      return
    }
    const reservationKey = `${location}|${date}|${court}`
    const group = [...new Set(cancellableSlots.flatMap((slot) => reservations[reservationKey]?.[slot] || []))]
    if (!group.length) {
      alert('This reservation could not be found in the current schedule. Refresh the page and try again.')
      return
    }
    setBookingModal({
      origin: 'player-reservations',
      mode: 'cancel',
      location,
      date,
      courtId: court,
      slots: cancellableSlots,
      players: group,
      title: `Cancel Court ${court}`,
      subtitle: `${location} · ${formatDateLong(dateKeyToLocalDate(date))}`,
    })
  }, [reservations])

  // Add another location from the + button (only sites the Sheet already has a
  // court-grid tab for are offered). The choice is remembered in the browser.
  const hiddenLocations = useMemo(() => locations.filter((l) => !activeLocations.includes(l)), [locations, activeLocations])

  const handleAddLocation = useCallback((loc) => {
    if (!loc) return
    setActiveLocations((prev) => (prev.includes(loc) ? prev : [...prev, loc]))
    setSelectedLocation(loc)
    setSelectedCourt(null)
    setShowAddLocation(false)
  }, [])

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <img src={LOGO_URL} alt="" className="h-12 w-12 animate-pulse" />
          <span className="text-sm">Loading Courtz...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(134,239,172,0.18),_transparent_18%),linear-gradient(180deg,#f7fafc_0%,#e2f3e8_35%,#f1f5f9_100%)] p-4 sm:p-6 text-slate-900">
      <Head>
        <title>Courtz — USTA Girl&apos;s National Championships</title>
        <meta name="description" content="Practice court scheduler for the USTA Girl's National Championships" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
      </Head>

      <div className="max-w-6xl mx-auto">
        {/* Navigation */}
        <nav className="sticky top-4 z-40 flex flex-wrap lg:flex-nowrap justify-between items-center gap-3 bg-[#1f5f99]/90 border border-blue-300/10 backdrop-blur-xl rounded-[2rem] px-4 sm:px-6 py-3 sm:py-4 shadow-2xl shadow-slate-950/20 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <img src={LOGO_URL} alt="USTA logo" className="h-9 w-9 sm:h-10 sm:w-10 rounded-full border border-white/20 bg-white/10 object-cover shrink-0" />
            <div className="min-w-0">
              <div className="text-sm sm:text-base lg:text-lg font-semibold tracking-tight text-white truncate">USTA Girl&apos;s National Championships</div>
              <div className="text-xs uppercase tracking-[0.15em] text-slate-400 truncate">Practice Courts</div>
            </div>
          </div>
          <div className="flex flex-wrap lg:flex-nowrap justify-center items-center gap-2 text-sm shrink-0">
            <button className="rounded-full px-3 py-1.5 bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 transition">Practice Courts</button>
            <button
              type="button"
              onClick={openFindCourt}
              className="rounded-full px-3 py-1.5 bg-white/15 text-white border border-white/20 hover:bg-white/25 transition"
            >
              Find a Court
            </button>
            <PlayerSwitcher
              currentPlayer={currentPlayer}
              roster={roster}
              onSelect={handleSelectPlayer}
              appearance="navbar"
              sessionsLabel={`${Math.min(mySessionsToday.length, MAX_SESSIONS_PER_DAY)}/${MAX_SESSIONS_PER_DAY} sessions`}
              onOpenReservations={() => setShowPlayerReservations(true)}
            />
          </div>
        </nav>

        {/* A plain-language connection light lets the desk know whether it is
            safe to make bookings. Never hide a failed Sheets connection. */}
        {sheetsConnected === true && (
          <div className="mb-6 flex items-center justify-center gap-2 text-sm font-medium text-emerald-800" role="status">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
            Google Sheet connected — reservations are up to date
          </div>
        )}
        {sheetsConnected === false && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm" role="alert">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="min-w-[12rem] flex-1 text-sm leading-relaxed">
              <span className="font-semibold">The Google Sheet is not connected.</span> Do not make a booking yet because it may not be saved.
            </div>
            <button
              type="button"
              onClick={() => {
                setSheetsConnected(null)
                refreshSchedule(true)
              }}
              className="ml-auto shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 transition"
            >
              Try again
            </button>
          </div>
        )}

        {/* Day Selector — Pill Buttons (every date found in the sheet, past and
            future included; all remain clickable so old reservations can be
            reviewed. Only today and tomorrow are bookable.) */}
        {days.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-center gap-3 mb-3 px-1">
              <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Select Day</h2>
              <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
            </div>
            <DayCarousel
              days={days}
              selectedDay={selectedDay}
              onSelect={(key) => { setSelectedDay(key); setSelectedCourt(null) }}
            />
          </div>
        )}

        {/* Location Selector */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-3 mb-3 px-1">
            <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Select Location</h2>
            <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {activeLocations.map((loc) => {
              const isActive = selectedLocation === loc
              const isMatchPlay = MATCH_PLAY_LOCATIONS.includes(loc)
              return (
                <button
                  key={loc}
                  onClick={() => { setSelectedLocation(loc); setSelectedCourt(null) }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all duration-200 ${
                    isActive
                      ? 'bg-[#1f5f99] border-[#1f5f99] text-white shadow-lg shadow-blue-900/20'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isActive ? 'text-emerald-300' : 'text-slate-400'}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="text-sm font-medium">{loc}</span>
                  {isMatchPlay && (
                    <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>match site</span>
                  )}
                </button>
              )
            })}
            {hiddenLocations.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAddLocation((v) => !v)}
                  title="Add another practice location"
                  aria-label="Add another practice location"
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-[#1f5f99]/50 hover:text-[#1f5f99] hover:bg-blue-50/50 transition-all duration-200"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span className="text-sm font-medium">Add site</span>
                </button>
                {showAddLocation && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-72 rounded-xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                      Add a practice location
                    </div>
                    {hiddenLocations.map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => handleAddLocation(loc)}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 transition flex items-center gap-2"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600 shrink-0">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        {loc}
                        {MATCH_PLAY_LOCATIONS.includes(loc) && (
                          <span className="ml-auto text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">match-play site</span>
                        )}
                      </button>
                    ))}
                    <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
                      Sites already configured as a court-grid tab in the Google Sheet appear here.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {viewOnlyDate && (
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                View only — bookings and changes are allowed for today and tomorrow only.
              </span>
            </div>
          )}
        </div>

        {/* Court Grid / Site Overview */}
        <section className="mb-6">
          <div className="mb-4 flex justify-center">
            <div
              className="inline-flex rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm"
              role="tablist"
              aria-label="Court display view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!showSiteOverview}
                onClick={() => setShowSiteOverview(false)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  !showSiteOverview ? 'bg-[#1f5f99] text-white shadow' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Courts
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={showSiteOverview}
                onClick={() => setShowSiteOverview(true)}
                title="See every court and every time at a glance — which hours the whole site is busy or open"
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  showSiteOverview ? 'bg-[#1f5f99] text-white shadow' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Site overview
              </button>
            </div>
          </div>
          <DaySlide
            dayKey={selectedDay}
            canSwipeLeft={Boolean(selectedDay) && days.findIndex((d) => d.key === selectedDay) < days.length - 1}
            canSwipeRight={Boolean(selectedDay) && days.findIndex((d) => d.key === selectedDay) > 0}
            onSwipeLeft={() => {
              const index = days.findIndex((d) => d.key === selectedDay)
              if (index >= 0 && index < days.length - 1) {
                setSelectedDay(days[index + 1].key)
                setSelectedCourt(null)
              }
            }}
            onSwipeRight={() => {
              const index = days.findIndex((d) => d.key === selectedDay)
              if (index > 0) {
                setSelectedDay(days[index - 1].key)
                setSelectedCourt(null)
              }
            }}
          >
            {courts.length === 0 ? (
              <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center text-sm text-slate-500">
                No courts are set up for {selectedLocation} on this day yet.
              </div>
            ) : (
              <div className="flex justify-center">
                {showSiteOverview ? (
                  <SiteOverview
                    courts={courts}
                    reservations={reservations}
                    location={selectedLocation}
                    dateKey={selectedDay}
                    slotLabels={THIRTY_MIN_SLOTS}
                    completedSlots={completedSlots}
                    onSelectCourt={handleSelectCourt}
                  />
                ) : (
                  <CourtGrid courts={courts} reservations={reservations} onSelect={handleSelectCourt} selectedCourt={selectedCourt} completedSlots={completedSlots} />
                )}
              </div>
            )}
          </DaySlide>
        </section>

        {/* Info Section */}
        <section id="info" className="mt-16 rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-6 sm:p-8 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1f5f99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800">Information</h2>
          </div>
          <p className="text-slate-600 leading-relaxed">Welcome to the USTA Girl&apos;s National Championships practice court scheduler. Use this page to book practice sessions at the selected venue for the tournament. A booking can include several players — the whole group is saved together. Each 30-minute slot holds up to 4 players.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700">How to book</div>
                <div className="text-xs text-slate-500">Select a date &amp; location, then tap a court to reserve a time slot for one or more players. Bookings can only be made for today and tomorrow; other days are view only. Each slot can hold up to 4 players — partially booked slots still show as open.</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1f5f99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700">Session limits</div>
                <div className="text-xs text-slate-500">Max 2 practice sessions per player per day. Barnes offers 30-minute bookings only (each counts as one session); at other sites a 1-hour booking counts as one session. Back-to-back or close sessions (within 1 hour) for the same player need tournament staff approval — a staff code prompt will appear when required.</div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section id="contact" className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-6 sm:p-8 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1f5f99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-800">Contact</h2>
          </div>
          <p className="text-slate-600 leading-relaxed">For tournament inquiries, please visit the official event website or reach out to tournament staff.</p>
          <a href="mailto:info@ustagirlsnationals.com" className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-[#1f5f99] hover:text-emerald-600 transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            info@ustagirlsnationals.com
          </a>
        </section>

        <footer className="mt-6 text-center text-xs text-slate-400 pb-4">
          Click a court to view the schedule and reserve 30-minute slots for up to 4 players each.
        </footer>
      </div>

      {showFindCourt && (
        <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center overflow-auto">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowFindCourt(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 my-8 overflow-hidden">
            <div className="bg-gradient-to-br from-[#1f5f99] to-[#164a7a] px-6 py-5">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-white">Find a Court</h2>
                  <p className="text-sm text-blue-200 mt-1">Pick a location, a start time and a length to see courts you can book.</p>
                </div>
                <button onClick={() => setShowFindCourt(false)} className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PlayerSwitcher
                  currentPlayer={currentPlayer}
                  roster={roster}
                  onSelect={(name) => {
                    handleSelectPlayer(name)
                    setFindNotice(null)
                  }}
                  appearance="header"
                  dropdownAlign="left"
                  sessionsLabel={`${Math.min(currentPlayer ? existingPlayerSessions(reservations, { dateKey: findDay, name: currentPlayer, practiceLocations: activeLocations }).length : 0, MAX_SESSIONS_PER_DAY)}/${MAX_SESSIONS_PER_DAY} sessions`}
                  onOpenReservations={() => setShowPlayerReservations(true)}
                />
              </div>
            </div>

            <div className="p-4 max-h-[60vh] overflow-auto space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Day</div>
                <DayCarousel
                  days={bookableDays}
                  selectedDay={findDay}
                  onSelect={(key) => {
                    setFindDay(key)
                    setFindTime('')
                    setFindNotice(null)
                  }}
                />
                <p className="mt-2 text-center text-[11px] text-slate-400">Only today and tomorrow can be booked.</p>
              </div>
              {/* Step 1 — Location (practice sites + any added sites) */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">1. Location</div>
                <div className="flex flex-wrap gap-2">
                  {activeLocations.map((loc) => {
                    const isActive = findLocation === loc
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => { setFindLocation(loc); setFindNotice(null) }}
                        className={`rounded-lg border-2 px-3 py-1.5 text-sm font-medium transition ${
                          isActive
                            ? 'border-[#1f5f99] bg-[#1f5f99] text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        {loc}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Step 2 — Start time */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">2. Start time</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {THIRTY_MIN_SLOTS.map((slot) => {
                    const isActive = findTime === slot
                    const completed = findCompletedSlots.has(slot)
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={completed}
                        title={completed ? 'This time has already ended' : ''}
                        onClick={() => { setFindTime(slot); setFindNotice(null) }}
                        className={`rounded-lg border-2 px-2 py-1.5 text-xs font-medium transition ${
                          isActive
                            ? 'border-[#1f5f99] bg-[#1f5f99] text-white'
                            : completed
                              ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed line-through'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {slot.split('–')[0]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Step 3 — Length */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">3. Length</div>
                {isBarnesLocation(findLocation) ? (
                  <p className="text-sm text-slate-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    Barnes offers 30-minute bookings only.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setFindDuration(30); setFindNotice(null) }}
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${
                        findDuration === 30
                          ? 'border-[#1f5f99] bg-[#1f5f99] text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      30 minutes
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (findTime && timeLabelToMinutes(findTime.split('–')[0]) <= 17 * 60 + 30) { setFindDuration(60); setFindNotice(null) } }}
                      disabled={!findTime || timeLabelToMinutes(findTime.split('–')[0]) > 17 * 60 + 30 || findCompletedSlots.has(findSlots[1])}
                      title={
                        !findTime
                          ? 'Pick a start time first'
                          : timeLabelToMinutes(findTime.split('–')[0]) > 17 * 60 + 30
                            ? 'A 1-hour booking must start by 5:30 PM'
                            : findCompletedSlots.has(findSlots[1])
                              ? 'The second half of this hour has already ended'
                              : '1 hour'
                      }
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${
                        findDuration === 60
                          ? 'border-[#1f5f99] bg-[#1f5f99] text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50'
                      }`}
                    >
                      1 hour
                    </button>
                  </div>
                )}
                {findTime && findDuration === 60 && timeLabelToMinutes(findTime.split('–')[0]) > 17 * 60 + 30 && (
                  <p className="mt-1.5 text-xs text-amber-700">A 1-hour booking must start by 5:30 PM.</p>
                )}
                {findLocation && !isBarnesLocation(findLocation) && findTime && findDuration === 30 && (
                  <p className="mt-1.5 text-xs text-slate-400">A 30-minute booking counts as one session. Choose 1 hour for a single one-session 60-minute booking.</p>
                )}
              </div>

              {/* Step 4 — Available courts */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">4. Available courts (up to 4 players per slot)</div>
                {findSlots.length > 0 && (
                  <p className="mb-2 text-sm text-slate-600">
                    Looking for <span className="font-semibold text-slate-800">{findSlots[0].split('–')[0]} to {findSlots[findSlots.length - 1].split('–')[1]}</span>
                    {findSlots.length === 2 ? ' (1 hour)' : ' (30 minutes)'} at {findLocation || 'a venue'} on {findDay ? formatDateLong(dateKeyToLocalDate(findDay)) : 'the selected day'}.
                  </p>
                )}
                {findNotice && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {findNotice}
                  </div>
                )}
                {!findTime ? (
                  <p className="text-sm text-slate-500 text-center py-6">Choose a start time above to see which courts are open.</p>
                ) : findCourts.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">
                    No courts are open at {LOCATION_SHORT[findLocation] || findLocation} for {findSlots.join(' and ')}. Try another time.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {findCourts.map((r) => {
                      const isMine = r.mine
                      const pendingPrefix = `${r.location}|${findDay}|${r.courtId}|${findSlots.join(',')}|`
                      const isSaving = Object.keys(pendingReservations).some(
                        (k) => k.startsWith(`book|${pendingPrefix}`) || k.startsWith(`cancel|${pendingPrefix}`)
                      )
                      return (
                        <div
                          key={`${r.location}-${r.courtId}`}
                          className={`flex items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 transition ${
                            isMine ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleFindCourtPick(r.courtId)}
                            disabled={isSaving}
                            className="flex-1 text-left"
                          >
                            <div className="font-semibold text-slate-800">Court {r.courtId} {r.occupancy ? `(${r.occupancy}/4)` : ''}</div>
                            <div className="text-xs text-slate-500">{r.location}</div>
                            <div className={`text-xs font-medium mt-1 ${isMine ? 'text-emerald-700' : 'text-slate-500'}`}>
                              {isSaving ? 'Saving…' : isMine ? 'Booked by you — tap to manage' : r.occupancy ? `${r.occupancy}/4 booked — tap to add yourself` : `Open ${findSlots.length === 2 ? 'for 1 hour' : 'for 30 minutes'} — tap to book`}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => openCourtSchedule(r.location, findDay, r.courtId)}
                            className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-[#1f5f99] hover:border-[#1f5f99]/40 hover:bg-blue-50 transition"
                          >
                            View
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showPlayerReservations && (
        <PlayerReservationsModal
          reservations={reservations}
          roster={roster}
          initialPlayer={currentPlayer}
          onClose={() => setShowPlayerReservations(false)}
          onCancelReservation={handleCancelPlayerReservation}
        />
      )}

      {selectedCourt && (
        <CourtCardCarousel
          courts={courts}
          selectedCourt={selectedCourt}
          onSelectCourt={handleSelectCourt}
          date={selectedDay}
          location={selectedLocation}
          reservations={reservations}
          roster={roster}
          currentPlayer={currentPlayer}
          onSelectPlayer={handleSelectPlayer}
          pendingReservations={pendingReservations}
          practiceLocations={activeLocations}
          viewOnly={viewOnlyDate}
          completedSlots={completedSlots}
          barnesOnly30={isBarnesLocation(selectedLocation)}
          onOpenBooking={handleOpenBooking}
          onClose={() => setSelectedCourt(null)}
        />
      )}

      {bookingModal && (
        <GroupBookingModal
          title={bookingModal.title}
          subtitle={bookingModal.subtitle}
          slots={bookingModal.slots}
          initialPlayers={bookingModal.players}
          bookedPlayers={bookingModal.bookedPlayers || []}
          roster={roster}
          mode={bookingModal.mode}
          evaluate={evaluateBookingRules}
          requiresStaffCode={staffCodeRequired}
          onConfirm={handleConfirmGroupBooking}
          onClose={() => setBookingModal(null)}
        />
      )}
    </div>
  )
}
