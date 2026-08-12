import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import CourtGrid from '../components/CourtGrid'
import CourtSchedule from '../components/CourtSchedule'
import GroupBookingModal from '../components/GroupBookingModal'
import { getBookingWindowKeys, isBookableDateKey, isSlotCompleted, validateBookingWindow } from '../lib/booking-window'
import { validateSessionBooking, formatSessionWarning, PRACTICE_DEFAULT_LOCATIONS } from '../lib/session-rules'

const LOGO_URL = '/logo.svg'

// Fallbacks used only when the sheet cannot be reached or a legacy deployment
// does not report metadata. Once the v2.x Apps Script is live, every date,
// location and court below comes straight from the sheet.
const FALLBACK_LOCATIONS = PRACTICE_DEFAULT_LOCATIONS

// Sites that are hidden by default because they are match-play venues. They
// can be added deliberately with the + button, which also makes their
// reservations count toward practice-session limits.
const MATCH_PLAY_HINTS = {
  'USD': 'Match play site',
  'Pacific Beach Tennis Club': 'Match play site',
  'Balboa Tennis Center': 'Match play site',
}

const ACTIVE_LOCATIONS_STORAGE_KEY = 'courtz.activeLocations.v1'

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
  if (typeof window === 'undefined') return 'Alice Johnson'
  const params = new URLSearchParams(window.location.search)
  const player = params.get('player')
  const passcode = params.get('passcode')
  if (player) return decodeURIComponent(player)
  if (passcode) return PLAYER_PASSCODES[passcode.toLowerCase()] || 'Alice Johnson'
  return 'Alice Johnson'
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

function getDateKey(d) {
  // Use the date shown in the visitor's own timezone. toISOString() uses UTC
  // and could accidentally move an evening booking to the following day.
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
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
// future are all shown and all remain clickable).
function buildDayObjects(dates, today) {
  return (dates || [])
    .map((key) => {
      const [y, m, d] = String(key).split('-').map(Number)
      if (!y || !m || !d) return null
      const dateObj = new Date(y, m - 1, d)
      return {
        label: formatDate(dateObj),
        key: getDateKey(dateObj),
        dayName: formatDateShort(dateObj),
        dayNum: formatDateDay(dateObj),
        isToday: isSameDay(dateObj, today),
        dateObj,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
}

// Default day: today when it exists in the sheet, otherwise the next date on or
// after today, otherwise the last (most recent) date.
function pickDefaultDay(days, today) {
  if (!days.length) return ''
  const todayKey = getDateKey(today)
  const hit = days.find((d) => d.key === todayKey)
  if (hit) return hit.key
  const future = days.find((d) => d.key >= todayKey)
  return future ? future.key : days[days.length - 1].key
}

// Courts a player can act on for one window (one or more consecutive 30-minute
// parts): courts that are completely open for every part, plus courts already
// booked by that player (so they can cancel from the same list).
function findCourtsForBooking(courtsList, reservations, location, dateKey, slots, name) {
  return (courtsList || [])
    .map((courtId) => {
      const parts = slots.map((slot) => {
        const players = reservations[`${location}|${dateKey}|${courtId}`]?.[slot]
        return Array.isArray(players) ? players : []
      })
      const anyTaken = parts.some((p) => p.length > 0)
      const mine = parts.some((p) => p.includes(name))
      const open = !anyTaken
      return open || mine ? { location, courtId, mine } : null
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.courtId - b.courtId)
}

// Practice sites deliberately added by the desk are remembered in the browser
// so they stay visible between visits. (Session-limit counting uses
// lib/session-rules.js, which counts sessions across all active practice
// locations and groups 60-minute pairs.)
function readSavedExtraLocations() {
  try {
    const raw = window.localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY)
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? [...new Set(parsed.filter((x) => typeof x === 'string'))] : []
  } catch {
    return []
  }
}

function persistExtraLocations(list) {
  try {
    window.localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable (private mode) - the session still works in memory.
  }
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [days, setDays] = useState([])
  const [selectedDay, setSelectedDay] = useState('')
  const [locations, setLocations] = useState(FALLBACK_LOCATIONS)
  const [extraLocations, setExtraLocations] = useState([])
  const [showAddLocation, setShowAddLocation] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [courtsByDate, setCourtsByDate] = useState({})
  const [selectedLocation, setSelectedLocation] = useState('')
  const [selectedCourt, setSelectedCourt] = useState(null)
  const [currentPlayer, setCurrentPlayer] = useState('Alice Johnson')

  const [reservations, setReservations] = useState({})
  const [roster, setRoster] = useState(FALLBACK_ROSTER)
  const [rosterLoaded, setRosterLoaded] = useState(false)
  const [playerSearch, setPlayerSearch] = useState('')
  const [showPlayerDropdown, setShowPlayerDropdown] = useState(false)
  const [pendingReservations, setPendingReservations] = useState({})
  const [showFindCourt, setShowFindCourt] = useState(false)
  const [findLocation, setFindLocation] = useState('')
  const [findDuration, setFindDuration] = useState(30)
  const [findTime, setFindTime] = useState('')
  const [findNotice, setFindNotice] = useState(null)
  const [bookingModal, setBookingModal] = useState(null) // {mode, courtId, slots, players, title, subtitle}
  const [sheetsConnected, setSheetsConnected] = useState(null) // null = still loading/unknown
  const lastScheduleSync = useRef(0)

  useEffect(() => {
    setMounted(true)
    setExtraLocations(readSavedExtraLocations())
    // Refresh the clock every minute so ended time slots and the bookable
    // window (today/tomorrow in America/Los_Angeles) stay correct while the
    // page is open.
    const tick = setInterval(() => setClockNow(new Date()), 60_000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    setCurrentPlayer(getPlayerFromUrl())
  }, [])

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
        const today = new Date()
        const dayObjects = buildDayObjects(result.days, today)
        setDays(dayObjects)
        setSelectedDay((prev) => {
          if (prev && dayObjects.some((d) => d.key === prev)) return prev
          return pickDefaultDay(dayObjects, today)
        })
      }
      setSheetsConnected(result.connected === true)
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
    if (rosterLoaded && roster.length > 0 && !roster.includes(currentPlayer)) {
      setCurrentPlayer(roster[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterLoaded])

  // Booking window in America/Los_Angeles: only today and tomorrow can be
  // booked or changed. Everything else stays clickable but view only.
  const bookingWindow = useMemo(() => getBookingWindowKeys(clockNow), [clockNow])
  const selectedDayBookable = useMemo(
    () => isBookableDateKey(selectedDay, clockNow),
    [selectedDay, clockNow],
  )

  // Visible practice sites: the three default practice venues plus any site
  // the desk deliberately added with the + button (remembered in the browser).
  // Everything else the sheet reports (match-play sites, new tabs) is offered
  // through the + menu.
  const visibleLocations = useMemo(() => {
    const defaults = PRACTICE_DEFAULT_LOCATIONS.filter((loc) => locations.includes(loc))
    const extras = extraLocations.filter((loc) => locations.includes(loc) && !defaults.includes(loc))
    return [...defaults, ...extras]
  }, [locations, extraLocations])

  const addableLocations = useMemo(
    () => locations.filter((loc) => !visibleLocations.includes(loc)),
    [locations, visibleLocations],
  )

  function addPracticeLocation(loc) {
    setExtraLocations((prev) => {
      const next = prev.includes(loc) ? prev : [...prev, loc]
      persistExtraLocations(next)
      return next
    })
    setShowAddLocation(false)
  }

  function removePracticeLocation(loc) {
    setExtraLocations((prev) => {
      const next = prev.filter((x) => x !== loc)
      persistExtraLocations(next)
      return next
    })
    if (selectedLocation === loc) setSelectedLocation(PRACTICE_DEFAULT_LOCATIONS[0])
  }

  // Keep the default selection in sync with the very first data load.
  useEffect(() => {
    if (days.length && !selectedDay) {
      setSelectedDay(pickDefaultDay(days, new Date()))
    }
    if (visibleLocations.length && (!selectedLocation || !visibleLocations.includes(selectedLocation))) {
      setSelectedLocation(visibleLocations[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, visibleLocations.length])

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

  function timeLabelToMinutes(label) {
    const m = String(label).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
    if (!m) return 0
    let h = Number(m[1])
    const min = Number(m[2])
    const ap = (m[3] || '').toUpperCase()
    if (ap === 'PM' && h !== 12) h += 12
    if (ap === 'AM' && h === 12) h = 0
    return h * 60 + min
  }

  // 30-minute parts that make up the requested window.
  const findSlots = useMemo(() => {
    if (!findTime) return []
    const parts = [findTime]
    if (findDuration === 60) {
      const startMinutes = timeLabelToMinutes(findTime.split('–')[0])
      parts.push(`${formatTimeLabel(startMinutes + 30)}–${formatTimeLabel(startMinutes + 60)}`)
    }
    return parts
  }, [findTime, findDuration])

  // Whether the second half of a 60-minute window at the chosen start time has
  // already ended (that half could then never be booked).
  const findSecondPartEnded = useMemo(() => {
    if (!findTime || selectedDay !== bookingWindow.today) return false
    const startMinutes = timeLabelToMinutes(findTime.split('–')[0])
    const second = `${formatTimeLabel(startMinutes + 30)}–${formatTimeLabel(startMinutes + 60)}`
    return isSlotCompleted(second, selectedDay, clockNow)
  }, [findTime, selectedDay, bookingWindow.today, clockNow])

  // Recomputed on every render of the modal, so results stay accurate even
  // right after a booking is made from inside Find a Court.
  const findCourts = useMemo(() => {
    if (!showFindCourt || !findLocation || !selectedDay || !findSlots.length) return []
    return findCourtsForBooking(courtsByDate[selectedDay]?.[findLocation] || [], reservations, findLocation, selectedDay, findSlots, currentPlayer)
  }, [showFindCourt, findLocation, selectedDay, findSlots, reservations, currentPlayer, courtsByDate])

  function handleSelectCourt(id) {
    setSelectedCourt(id)
  }

  const selectedCourtIndex = courts.findIndex((court) => court.id === selectedCourt)

  // --- Atomic group booking / cancellation --------------------------------
  // The optimistic UI change is applied immediately, then the whole group is
  // written to the sheet in one request; on failure every name is rolled back
  // so a half-saved group is never shown or stored.
  async function handleGroupWrite({ mode, location, date, courtId, slots, names, staffApproved = false, activeLocations = [] }) {
    const reservationKey = `${location}|${date}|${courtId}`
    const requestKey = `${mode}|${reservationKey}|${slots.join(',')}|${names.join(',')}`
    if (pendingReservations[requestKey]) return

    // Snapshot the affected slots so a failed write can be undone exactly.
    const snapshot = {}
    slots.forEach((slot) => {
      snapshot[slot] = [...((reservations[reservationKey]?.[slot] || []) )]
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
        body: JSON.stringify({ action: mode, location, date, courtId, slots, names, staffApproved, activeLocations }),
      })
      if (!response.ok) {
        let message = 'Unable to save reservation'
        try {
          const body = await response.json()
          if (body?.error) message = body.error.replace(/^Error:\s*/i, '')
        } catch {}
        throw new Error(message)
      }
      // Re-sync from the sheet shortly after the write so the local view
      // always settles on what the backend actually stored.
      setTimeout(() => refreshSchedule(true), 1000)
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
  }

  // `opts.staffApproved` is set when the desk already confirmed the staff
  // approval prompt. Returns { approvalRequired } when the modal should show
  // the tournament-staff approval prompt instead of closing; throws on hard
  // errors (which the modal shows inline).
  async function handleConfirmGroupBooking(players, opts = {}) {
    const modal = bookingModal
    if (!modal) return
    const slots = modal.slots
    // Keep only players that are still relevant (all of them for a booking).
    const names = [...new Set(players.map((n) => String(n).trim()).filter(Boolean))]

    if (modal.mode === 'book') {
      // Max 2 sessions per player per day across all active practice
      // locations, plus the staff-approval proximity warning. Checked for
      // EVERY member so one player can never exceed the limit by riding along
      // on a group. The API and Apps Script repeat both checks server-side.
      const validation = validateSessionBooking({
        reservations,
        activeLocations: visibleLocations,
        location: modal.location,
        date: modal.date,
        courtId: modal.courtId,
        slots,
        names,
      })
      if (validation.overLimit.length) {
        throw new Error(
          `${validation.overLimit.join(', ')} already ${validation.overLimit.length === 1 ? 'has' : 'have'} the maximum of 2 practice sessions for that day. The limit cannot be bypassed.`,
        )
      }
      if (validation.warnings.length && !opts.staffApproved) {
        const who = [...new Set(validation.warnings.map((w) => w.player))]
        return { approvalRequired: { names: who, message: formatSessionWarning(who) } }
      }
      try {
        await handleGroupWrite({
          mode: 'book',
          location: modal.location,
          date: modal.date,
          courtId: modal.courtId,
          slots,
          names,
          staffApproved: opts.staffApproved === true,
          activeLocations: visibleLocations,
        })
      } catch (e) {
        // The backend may know about reservations this browser had not seen
        // yet (stale data). If the fresh server-side check finds the sessions
        // are too close, show the approval prompt again instead of failing.
        if (/STAFF_APPROVAL_REQUIRED|staff approval is required/i.test(e?.message || '')) {
          return { approvalRequired: { names, message: e.message.replace(/^STAFF_APPROVAL_REQUIRED:\s*/i, '') } }
        }
        throw e
      }
      setBookingModal(null)
      if (modal.origin === 'find') {
        setFindNotice(`Booked Court ${modal.courtId} at ${LOCATION_SHORT[modal.location] || modal.location} for ${slots.join(' and ')}.`)
        setFindTime('')
      }
    } else {
      // Canceling is a change too, so the booking window applies. The API and
      // Apps Script recheck this (and the UI already hides ended slots).
      validateBookingWindow({ date: modal.date, slots })
      await handleGroupWrite({ mode: 'cancel', location: modal.location, date: modal.date, courtId: modal.courtId, slots, names })
      setBookingModal(null)
      if (modal.origin === 'find') {
        setFindNotice(`Canceled the booking on Court ${modal.courtId} at ${LOCATION_SHORT[modal.location] || modal.location}.`)
      }
    }
  }

  function openFindCourt() {
    setFindLocation(selectedLocation)
    setFindDuration(30)
    setFindTime('')
    setFindNotice(null)
    setShowFindCourt(true)
  }

  // Find a Court result: open the group-booking dialog for the chosen court
  // (or the cancellation dialog when the current player already has a booking
  // in the window). View-only days and already-ended times cannot be booked
  // or canceled from here.
  function handleFindCourtPick(courtId) {
    if (!selectedDayBookable) {
      setFindNotice('This day is view only. Reservations can only be booked or changed for today and tomorrow (America/Los_Angeles).')
      return
    }
    const endedPart = findSlots.find((slot) => isSlotCompleted(slot, selectedDay, clockNow))
    if (endedPart) {
      setFindNotice(`That time has already ended (${endedPart}). Pick a later start time.`)
      return
    }
    const players = findSlots.flatMap((slot) => reservations[`${findLocation}|${selectedDay}|${courtId}`]?.[slot] || [])
    const mine = players.includes(currentPlayer)
    if (mine) {
      const group = [...new Set(players)]
      setBookingModal({
        origin: 'find',
        mode: 'cancel',
        location: findLocation,
        date: selectedDay,
        courtId,
        slots: findSlots,
        players: group,
        title: `Cancel Court ${courtId}`,
        subtitle: `${findLocation} · ${formatDateLong(new Date(selectedDay + 'T12:00:00'))}`,
      })
      return
    }
    if (players.length > 0) {
      alert(`Court ${courtId} was just booked by someone else. Pick another court.`)
      return
    }
    setBookingModal({
      origin: 'find',
      mode: 'book',
      location: findLocation,
      date: selectedDay,
      courtId,
      slots: findSlots,
      players: [currentPlayer],
      title: `Book Court ${courtId}`,
      subtitle: `${findLocation} · ${formatDateLong(new Date(selectedDay + 'T12:00:00'))}`,
    })
  }

  // Jumps from Find a Court to the full schedule for one court so the booking
  // can be viewed or adjusted.
  function openCourtSchedule(location, dateKey, courtId) {
    setSelectedLocation(location)
    setSelectedDay(dateKey)
    setSelectedCourt(courtId)
    setShowFindCourt(false)
  }

  // Called by the CourtSchedule modal when a slot is tapped. View-only days
  // and already-ended slots never reach this (their buttons are disabled),
  // but the guard is kept as a second line of defense.
  function handleOpenBooking({ mode, slots, players }) {
    if (!selectedDayBookable) return
    if (slots.some((slot) => isSlotCompleted(slot, selectedDay, clockNow))) return
    const dateObj = new Date(selectedDay + 'T12:00:00')
    setBookingModal({
      origin: 'schedule',
      mode,
      location: selectedLocation,
      date: selectedDay,
      courtId: selectedCourt,
      slots,
      players,
      title: mode === 'cancel' ? `Cancel Court ${selectedCourt}` : `Book Court ${selectedCourt}`,
      subtitle: `${selectedLocation} · ${formatDateLong(dateObj)}`,
    })
  }

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
              <div className="text-xs uppercase tracking-[0.15em] text-slate-400 truncate">{selectedLocation || 'Practice Courts'}</div>
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
            <div className="relative flex items-center gap-1.5 rounded-full border border-emerald-400/70 bg-emerald-500 px-2.5 py-1.5 shadow-sm shadow-emerald-500/20">
              <span className="text-xs font-medium text-white whitespace-nowrap hidden sm:block">Booking Courts As</span>
              <div className="relative">
                <input
                  type="text"
                  value={showPlayerDropdown ? playerSearch : currentPlayer}
                  onChange={(e) => {
                    setPlayerSearch(e.target.value)
                    setShowPlayerDropdown(true)
                  }}
                  onFocus={(e) => {
                    setPlayerSearch(currentPlayer)
                    setShowPlayerDropdown(true)
                    // Select the entire current name so typing immediately
                    // replaces it.
                    requestAnimationFrame(() => e.target.select())
                  }}
                  onMouseUp={(e) => e.preventDefault()}
                  onBlur={() => setTimeout(() => setShowPlayerDropdown(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const filtered = roster.filter(n => n.toLowerCase().includes(playerSearch.toLowerCase()))
                      if (filtered.length) {
                        setCurrentPlayer(filtered[0])
                        setShowPlayerDropdown(false)
                      }
                    }
                    if (e.key === 'Escape') setShowPlayerDropdown(false)
                  }}
                  placeholder="Search player..."
                  className="w-32 sm:w-36 lg:w-40 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs lg:text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
                {showPlayerDropdown && (
                  <div className="absolute top-full mt-2 right-0 w-56 lg:w-64 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl z-50">
                    {roster
                      .filter(n => n.toLowerCase().includes(playerSearch.toLowerCase()))
                      .slice(0, 30)
                      .map((name) => (
                        <button
                          key={name}
                          onMouseDown={() => {
                            setCurrentPlayer(name)
                            setPlayerSearch(name)
                            setShowPlayerDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 transition ${name === currentPlayer ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-700'}`}
                        >
                          {name}
                        </button>
                      ))}
                    {roster.filter(n => n.toLowerCase().includes(playerSearch.toLowerCase())).length === 0 && (
                      <div className="px-4 py-3 text-sm text-slate-400">No players found</div>
                    )}
                    <div className="px-3 py-1.5 text-xs text-slate-400 border-t">
                      {roster.filter(n => n.toLowerCase().includes(playerSearch.toLowerCase())).length} of {roster.length} players
                    </div>
                  </div>
                )}
              </div>
            </div>
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
            reviewed) */}
        {days.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-center gap-3 mb-3 px-1">
              <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Select Day</h2>
              <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 px-1 -mx-1 scrollbar-thin justify-center">
              {days.map((d) => {
                const isActive = selectedDay === d.key
                const bookable = isBookableDateKey(d.key, clockNow)
                const isTomorrow = d.key === bookingWindow.tomorrow
                return (
                  <button
                    key={d.key}
                    onClick={() => { setSelectedDay(d.key); setSelectedCourt(null) }}
                    title={bookable ? 'Bookings can be made or changed for this day.' : 'View only — bookings can be made or changed for today and tomorrow only.'}
                    className={`flex flex-col items-center min-w-[4rem] px-3 py-2 rounded-xl border-2 transition-all duration-200 shrink-0 ${
                      isActive
                        ? 'bg-[#1f5f99] border-[#1f5f99] text-white shadow-lg shadow-blue-900/20'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:shadow-md'
                    }`}
                  >
                    <span className={`text-xs font-medium ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>{d.dayName}</span>
                    <span className="text-lg font-bold leading-tight">{d.dayNum}</span>
                    <span className="h-[18px] mt-0.5 flex items-center">
                      {d.isToday && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-emerald-400/30 text-emerald-200' : 'bg-emerald-100 text-emerald-700'}`}>Today</span>
                      )}
                      {!d.isToday && isTomorrow && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-emerald-400/30 text-emerald-200' : 'bg-emerald-100 text-emerald-700'}`}>Tomorrow</span>
                      )}
                      {!bookable && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-slate-500/40 text-slate-200' : 'bg-slate-200 text-slate-500'}`}>View only</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
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
            {visibleLocations.map((loc) => {
              const isActive = selectedLocation === loc
              const isExtra = !PRACTICE_DEFAULT_LOCATIONS.includes(loc)
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
                  {isExtra && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Hide ${loc}`}
                      title="Hide this location"
                      onClick={(e) => {
                        e.stopPropagation()
                        removePracticeLocation(loc)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          removePracticeLocation(loc)
                        }
                      }}
                      className={`ml-0.5 -mr-1 rounded-full p-1 leading-none ${isActive ? 'text-white/70 hover:text-white hover:bg-white/20' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </span>
                  )}
                </button>
              )
            })}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAddLocation((v) => !v)}
                aria-label="Add another practice location"
                title="Add another site that is configured as a court-grid tab in the Google Sheet"
                className="flex items-center justify-center w-[38px] h-[38px] rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-slate-500 hover:border-[#1f5f99] hover:text-[#1f5f99] hover:bg-blue-50 transition-all duration-200"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              {showAddLocation && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAddLocation(false)} />
                  <div className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 w-72 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                    <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 bg-slate-50 border-b border-slate-100">Add another site</div>
                    {addableLocations.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-400">No other court-grid tabs were found in the Google Sheet.</div>
                    ) : (
                      <div className="max-h-60 overflow-auto">
                        {addableLocations.map((loc) => (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => addPracticeLocation(loc)}
                            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-emerald-50 transition flex items-center justify-between gap-2"
                          >
                            <span className="flex items-center gap-2">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                <circle cx="12" cy="10" r="3" />
                              </svg>
                              {loc}
                            </span>
                            {MATCH_PLAY_HINTS[loc] && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 whitespace-nowrap">
                                {MATCH_PLAY_HINTS[loc]}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* View-only notice: days outside the bookable window stay clickable
            for reviewing reservations, but nothing can be booked or changed. */}
        {days.length > 0 && !selectedDayBookable && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm" role="alert">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div className="min-w-[12rem] flex-1 text-sm leading-relaxed">
              <span className="font-semibold">View only day.</span> Reservations can only be booked or changed for <span className="font-semibold">today ({bookingWindow.today})</span> and <span className="font-semibold">tomorrow ({bookingWindow.tomorrow})</span> (America/Los_Angeles). Pick one of those days to book or cancel.
            </div>
          </div>
        )}

        {/* Court Grid */}
        <section className="mb-6">
          {courts.length === 0 ? (
            <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center text-sm text-slate-500">
              No courts are set up for {selectedLocation} on this day yet.
            </div>
          ) : (
            <div className="flex justify-center">
              <CourtGrid courts={courts} reservations={reservations} onSelect={handleSelectCourt} selectedCourt={selectedCourt} />
            </div>
          )}
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
          <p className="text-slate-600 leading-relaxed">Welcome to the USTA Girl&apos;s National Championships practice court scheduler. Use this page to book practice sessions at the selected venue for the tournament. A booking can include several players — the whole group is saved together.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700">How to book</div>
                <div className="text-xs text-slate-500">Select a date &amp; location, then tap a court to reserve a time slot for one or more players.</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1f5f99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700">Sessions &amp; limits</div>
                <div className="text-xs text-slate-500">Practice slots are 30 minutes; Peninsula and PLNU also offer 1-hour bookings. Max 2 sessions per player per day. Sessions that are back-to-back or start within one hour of each other need tournament staff approval.</div>
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
          Click a court to view the schedule and reserve 30-minute slots for one or more players.
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
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Booking as {currentPlayer}
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {formatDateLong(new Date(selectedDay + 'T12:00:00'))}
                </div>
              </div>
            </div>

            <div className="p-4 max-h-[60vh] overflow-auto space-y-4">
              {!selectedDayBookable && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span><span className="font-semibold">View only day.</span> You can find and review courts, but bookings and cancellations are only possible for today and tomorrow (America/Los_Angeles).</span>
                </div>
              )}
              {/* Step 1 — Location */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">1. Location</div>
                <div className="flex flex-wrap gap-2">
                  {visibleLocations.map((loc) => {
                    const isActive = findLocation === loc
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => { setFindLocation(loc); setFindDuration(loc === 'Barnes Tennis Center' ? 30 : findDuration); setFindNotice(null) }}
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
                    // Ended 30-minute parts cannot be booked. The CURRENT
                    // 30-minute slot stays selectable until it ends.
                    const ended = isSlotCompleted(slot, selectedDay, clockNow)
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={ended}
                        onClick={() => { setFindTime(slot); setFindNotice(null) }}
                        title={ended ? 'This time has already ended' : `Start at ${slot.split('–')[0]}`}
                        className={`rounded-lg border-2 px-2 py-1.5 text-xs font-medium transition ${
                          isActive
                            ? 'border-[#1f5f99] bg-[#1f5f99] text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through'
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
                {findLocation === 'Barnes Tennis Center' ? (
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
                      onClick={() => { if (timeLabelToMinutes(findTime.split('–')[0]) <= 17 * 60 + 30) { setFindDuration(60); setFindNotice(null) } }}
                      disabled={!findTime || findSecondPartEnded || timeLabelToMinutes(findTime.split('–')[0]) > 17 * 60 + 30}
                      title={
                        findSecondPartEnded
                          ? 'The second half of this hour has already ended'
                          : findTime && timeLabelToMinutes(findTime.split('–')[0]) > 17 * 60 + 30
                            ? 'A 1-hour booking must start by 5:30 PM'
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
                {findSecondPartEnded && (
                  <p className="mt-1.5 text-xs text-amber-700">The second half of that hour has already ended, so only a 30-minute booking is possible.</p>
                )}
                {findTime && findDuration === 60 && timeLabelToMinutes(findTime.split('–')[0]) > 17 * 60 + 30 && (
                  <p className="mt-1.5 text-xs text-amber-700">A 1-hour booking must start by 5:30 PM.</p>
                )}
              </div>

              {/* Step 4 — Available courts */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">4. Available courts</div>
                {findSlots.length > 0 && (
                  <p className="mb-2 text-sm text-slate-600">
                    Looking for <span className="font-semibold text-slate-800">{findSlots[0].split('–')[0]} to {findSlots[findSlots.length - 1].split('–')[1]}</span>
                    {findDuration === 60 ? ' (1 hour)' : ' (30 minutes)'} at {findLocation || 'a venue'} on {selectedDay ? formatDateLong(new Date(selectedDay + 'T12:00:00')) : 'the selected day'}.
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
                      const isSaving = Boolean(pendingReservations[`book|${r.location}|${selectedDay}|${r.courtId}|${findSlots.join(',')}|${currentPlayer}`])
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
                            <div className="font-semibold text-slate-800">Court {r.courtId}</div>
                            <div className="text-xs text-slate-500">{r.location}</div>
                            <div className={`text-xs font-medium mt-1 ${isMine ? 'text-emerald-700' : 'text-slate-400'}`}>
                              {isSaving ? 'Saving…' : isMine ? 'Booked by you — tap to manage' : `Open ${findDuration === 60 ? 'for 1 hour' : 'for 30 minutes'} — tap to book`}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => openCourtSchedule(r.location, selectedDay, r.courtId)}
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

      {selectedCourt && (
        <CourtSchedule
          court={selectedCourt}
          date={selectedDay}
          location={selectedLocation}
          reservations={reservations}
          roster={roster}
          currentPlayer={currentPlayer}
          pendingReservations={pendingReservations}
          viewOnly={!selectedDayBookable}
          onOpenBooking={handleOpenBooking}
          canGoPrevious={selectedCourtIndex > 0}
          canGoNext={selectedCourtIndex >= 0 && selectedCourtIndex < courts.length - 1}
          onPreviousCourt={() => setSelectedCourt(courts[selectedCourtIndex - 1].id)}
          onNextCourt={() => setSelectedCourt(courts[selectedCourtIndex + 1].id)}
          onClose={() => setSelectedCourt(null)}
        />
      )}

      {bookingModal && (
        <GroupBookingModal
          title={bookingModal.title}
          subtitle={bookingModal.subtitle}
          slots={bookingModal.slots}
          initialPlayers={bookingModal.players}
          roster={roster}
          mode={bookingModal.mode}
          onConfirm={handleConfirmGroupBooking}
          onClose={() => setBookingModal(null)}
        />
      )}
    </div>
  )
}
