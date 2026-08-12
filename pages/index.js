import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import CourtGrid from '../components/CourtGrid'
import CourtSchedule from '../components/CourtSchedule'

const LOGO_URL = '/logo.svg'

const LOCATIONS = [
  'Barnes Tennis Center',
  'Peninsula Tennis Club',
  'Point Loma Nazarene College',
]

const COURTS_BY_LOCATION = {
  'Barnes Tennis Center': [4, 5],
  'Peninsula Tennis Club': [1, 2, 7, 8, 9, 10, 11, 12],
  'Point Loma Nazarene College': [1, 2, 3, 4, 5, 6],
}

const LOCATION_SHORT = {
  'Barnes Tennis Center': 'Barnes',
  'Peninsula Tennis Club': 'Peninsula',
  'Point Loma Nazarene College': 'PLNU',
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

// Courts a player can act on for one slot: completely open ones, plus courts
// already booked by that player (so they can cancel from the same list).
// The booking screen treats any name as "taken", so slots booked only by
// other players are excluded.
function findCourtsForBooking(reservations, location, dateKey, slotLabel, name) {
  return (COURTS_BY_LOCATION[location] || [])
    .map((courtId) => {
      const players = reservations[`${location}|${dateKey}|${courtId}`]?.[slotLabel]
      const list = Array.isArray(players) ? players : []
      const mine = list.includes(name)
      const open = list.length === 0
      return open || mine ? { location, courtId, mine } : null
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.courtId - b.courtId)
}

// Same "max 2 sessions per player per day" rule the court schedule modal
// enforces, counting a player's bookings at one venue on one date.
function countPlayerSessions(reservations, location, dateKey, name) {
  const prefix = `${location}|${dateKey}`
  return Object.keys(reservations).reduce((acc, key) => {
    if (!key.startsWith(prefix)) return acc
    Object.values(reservations[key] || {}).forEach((players) => {
      if (Array.isArray(players) && players.includes(name)) acc++
    })
    return acc
  }, 0)
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [days, setDays] = useState([])
  const [selectedDay, setSelectedDay] = useState("")
  const [selectedLocation, setSelectedLocation] = useState(LOCATIONS[0])
  const [selectedCourt, setSelectedCourt] = useState(null)
  const [currentPlayer, setCurrentPlayer] = useState('Alice Johnson')

  const [reservations, setReservations] = useState({})
  const [roster, setRoster] = useState(FALLBACK_ROSTER)
  const [rosterLoaded, setRosterLoaded] = useState(false)
  const [playerSearch, setPlayerSearch] = useState("")
  const [showPlayerDropdown, setShowPlayerDropdown] = useState(false)
  const [pendingReservations, setPendingReservations] = useState({})
  const [showFindCourt, setShowFindCourt] = useState(false)
  const [findLocation, setFindLocation] = useState(LOCATIONS[0])
  const [findDay, setFindDay] = useState("")
  const [findTime, setFindTime] = useState("")
  const [findNotice, setFindNotice] = useState(null)
  const [sheetsConnected, setSheetsConnected] = useState(null) // null = still loading/unknown
  const lastScheduleSync = useRef(0)

  useEffect(() => {
    setMounted(true)
    const today = new Date()
    const endDate = new Date('2026-08-16T12:00:00')
    const newDays = []
    const cur = new Date(today)
    let daysCount = 0
    while (cur <= endDate && daysCount < 14) {
      newDays.push({
        label: `${formatDate(new Date(cur))}`,
        key: getDateKey(cur),
        dayName: formatDateShort(new Date(cur)),
        dayNum: formatDateDay(new Date(cur)),
        isToday: isSameDay(new Date(cur), today),
        dateObj: new Date(cur),
      })
      cur.setDate(cur.getDate() + 1)
      daysCount++
    }
    if (newDays.length === 0) {
      for (let offset = 0; offset < 3; offset++) {
        const d = new Date(today)
        d.setDate(today.getDate() + offset)
        newDays.push({
          label: `${formatDate(d)}`,
          key: getDateKey(d),
          dayName: formatDateShort(d),
          dayNum: formatDateDay(d),
          isToday: offset === 0,
          dateObj: d,
        })
      }
    }
    setDays(newDays)
    setSelectedDay(newDays[0].key)
  }, [])

  useEffect(() => {
    setCurrentPlayer(getPlayerFromUrl())
  }, [])

  // Loads the full schedule (reservations + roster). The response also reports
  // whether the server is actually wired to Google Sheets; when it is not, a
  // warning banner is shown instead of silently presenting empty data.
  const refreshSchedule = useCallback(async (force = false) => {
    try {
      const response = await fetch(force ? '/api/schedule?refresh=1' : '/api/schedule')
      if (!response.ok) throw new Error('Failed to load schedule')
      const result = await response.json()
      lastScheduleSync.current = Date.now()
      setReservations(result.reservations || {})
      if (Array.isArray(result.roster) && result.roster.length > 0) setRoster(result.roster)
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
  }, [rosterLoaded])

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

  const courts = useMemo(() => {
    return (COURTS_BY_LOCATION[selectedLocation] || []).map((number) => ({
      id: number,
      number,
      location: selectedLocation,
      date: selectedDay,
    }))
  }, [selectedLocation, selectedDay])

  // Recomputed on every render of the modal, so results stay accurate even
  // right after a booking is made from inside Find a Court.
  const findCourts = useMemo(() => {
    if (!showFindCourt || !findLocation || !findDay || !findTime) return []
    return findCourtsForBooking(reservations, findLocation, findDay, findTime, currentPlayer)
  }, [showFindCourt, findLocation, findDay, findTime, reservations, currentPlayer])

  function handleSelectCourt(id) {
    setSelectedCourt(id)
  }

  const selectedCourtIndex = courts.findIndex((court) => court.id === selectedCourt)

  // Toggles one player's booking for one slot. The UI updates immediately and
  // the write goes to Google Sheets via /api/reservations; on failure the
  // change is rolled back. Returns whether the server accepted the write so
  // callers (e.g. Find a Court) only show a confirmation when it really saved.
  async function handleReserve(location, date, courtId, slot, name) {
    const reservationKey = `${location}|${date}|${courtId}`
    const requestKey = `${reservationKey}|${slot}|${name}`
    if (pendingReservations[requestKey]) return false

    const wasReserved = (reservations[reservationKey]?.[slot] || []).includes(name)
    setPendingReservations((pending) => ({ ...pending, [requestKey]: true }))
    setReservations((current) => {
      const next = { ...current }
      const courtReservations = { ...(next[reservationKey] || {}) }
      const names = Array.isArray(courtReservations[slot]) ? [...courtReservations[slot]] : []
      const existingIndex = names.indexOf(name)
      if (existingIndex >= 0) names.splice(existingIndex, 1)
      else names.push(name)
      if (names.length) courtReservations[slot] = names
      else delete courtReservations[slot]
      if (Object.keys(courtReservations).length) next[reservationKey] = courtReservations
      else delete next[reservationKey]
      return next
    })

    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location, date, courtId, slot, name }),
      })
      if (!response.ok) throw new Error('Unable to save reservation')
      // Re-sync from the sheet shortly after the write so the local view
      // always settles on what the backend actually stored.
      setTimeout(() => refreshSchedule(true), 1000)
      return true
    } catch (e) {
      console.error('Failed saving reservation', e)
      setReservations((current) => {
        const next = { ...current }
        const courtReservations = { ...(next[reservationKey] || {}) }
        const names = Array.isArray(courtReservations[slot]) ? [...courtReservations[slot]] : []
        const index = names.indexOf(name)
        if (wasReserved && index === -1) names.push(name)
        if (!wasReserved && index >= 0) names.splice(index, 1)
        if (names.length) courtReservations[slot] = names
        else delete courtReservations[slot]
        if (Object.keys(courtReservations).length) next[reservationKey] = courtReservations
        else delete next[reservationKey]
        return next
      })
      alert('Unable to update reservation. Please try again.')
      return false
    } finally {
      setPendingReservations((pending) => {
        const next = { ...pending }
        delete next[requestKey]
        return next
      })
    }
  }

  function openFindCourt() {
    setFindLocation(selectedLocation)
    setFindDay(selectedDay)
    setFindTime('')
    setFindNotice(null)
    setShowFindCourt(true)
  }

  // Find a Court result: book the chosen slot on that court for the signed-in
  // player, or let them cancel their own booking from the same list.
  async function handleFindCourtPick(courtId) {
    const reservationKey = `${findLocation}|${findDay}|${courtId}`
    const players = reservations[reservationKey]?.[findTime] || []
    if (players.includes(currentPlayer)) {
      if (confirm(`Cancel your reservation for Court ${courtId} at ${findTime}?`)) {
        await handleReserve(findLocation, findDay, courtId, findTime, currentPlayer)
        setFindNotice(null)
      }
      return
    }
    if (players.length > 0) {
      alert(`Court ${courtId} was just booked by someone else. Pick another court.`)
      return
    }
    if (countPlayerSessions(reservations, findLocation, findDay, currentPlayer) >= 2) {
      alert('You already have 2 sessions today.')
      return
    }
    const saved = await handleReserve(findLocation, findDay, courtId, findTime, currentPlayer)
    if (saved) {
      setFindNotice(`Booked Court ${courtId} at ${LOCATION_SHORT[findLocation] || findLocation} for ${findTime}.`)
    }
  }

  // Jumps from Find a Court to the full schedule for one court so the booking
  // can be viewed or adjusted.
  function openCourtSchedule(location, dateKey, courtId) {
    setSelectedLocation(location)
    setSelectedDay(dateKey)
    setSelectedCourt(courtId)
    setShowFindCourt(false)
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
              <div className="text-xs uppercase tracking-[0.15em] text-slate-400 truncate">{selectedLocation}</div>
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
              <span className="text-xs font-medium text-white whitespace-nowrap hidden sm:block">Signed in as</span>
              <div className="relative">
                <input
                  type="text"
                  value={showPlayerDropdown ? playerSearch : currentPlayer}
                  onChange={(e) => {
                    setPlayerSearch(e.target.value)
                    setShowPlayerDropdown(true)
                  }}
                  onFocus={() => {
                    setPlayerSearch(currentPlayer)
                    setShowPlayerDropdown(true)
                  }}
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

        {/* Day Selector — Pill Buttons */}
        <div className="mb-6">
          <div className="flex items-center justify-center gap-3 mb-3 px-1">
            <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Select Day</h2>
            <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 px-1 -mx-1 scrollbar-thin justify-center">
            {days.map((d) => {
              const isActive = selectedDay === d.key
              return (
                <button
                  key={d.key}
                  onClick={() => { setSelectedDay(d.key); setSelectedCourt(null) }}
                  className={`flex flex-col items-center min-w-[4rem] px-3 py-2 rounded-xl border-2 transition-all duration-200 shrink-0 ${
                    isActive
                      ? 'bg-[#1f5f99] border-[#1f5f99] text-white shadow-lg shadow-blue-900/20'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:shadow-md'
                  }`}
                >
                  <span className={`text-xs font-medium ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>{d.dayName}</span>
                  <span className="text-lg font-bold leading-tight">{d.dayNum}</span>
                  {d.isToday && (
                    <span className={`text-[10px] font-semibold mt-0.5 px-1.5 py-0.5 rounded-full ${isActive ? 'bg-emerald-400/30 text-emerald-200' : 'bg-emerald-100 text-emerald-700'}`}>Today</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Location Selector */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-3 mb-3 px-1">
            <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Select Location</h2>
            <div className="h-px flex-1 max-w-[8rem] bg-slate-200" />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {LOCATIONS.map((loc) => {
              const isActive = selectedLocation === loc
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
                </button>
              )
            })}
          </div>
        </div>

        {/* Court Grid */}
        <section className="mb-6">
          <div className="flex justify-center">
            <CourtGrid courts={courts} reservations={reservations} onSelect={handleSelectCourt} selectedCourt={selectedCourt} />
          </div>
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
          <p className="text-slate-600 leading-relaxed">Welcome to the USTA Girl&apos;s National Championships practice court scheduler. Use this page to book practice sessions at the selected venue for the tournament.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700">How to book</div>
                <div className="text-xs text-slate-500">Select a date &amp; location, then tap a court to reserve a time slot.</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1f5f99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-700">30-min sessions</div>
                <div className="text-xs text-slate-500">Practice slots are 30 minutes. Max 2 sessions per player per day.</div>
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
          Click a court to view the schedule and reserve 30-minute slots.
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
                  <p className="text-sm text-blue-200 mt-1">Pick a location, a day, and a time to see courts you can book.</p>
                </div>
                <button onClick={() => setShowFindCourt(false)} className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white" aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Booking as {currentPlayer}
              </div>
            </div>

            <div className="p-4 max-h-[60vh] overflow-auto space-y-4">
              {/* Step 1 — Location */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">1. Location</div>
                <div className="flex flex-wrap gap-2">
                  {LOCATIONS.map((loc) => {
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

              {/* Step 2 — Day */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">2. Day</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {days.map((d) => {
                    const isActive = findDay === d.key
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => { setFindDay(d.key); setFindNotice(null) }}
                        className={`flex flex-col items-center min-w-[3.5rem] px-2.5 py-1.5 rounded-lg border-2 transition shrink-0 ${
                          isActive
                            ? 'border-[#1f5f99] bg-[#1f5f99] text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span className={`text-[11px] font-medium ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>{d.dayName}</span>
                        <span className="text-base font-bold leading-tight">{d.dayNum}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Step 3 — Time */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">3. Time</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {THIRTY_MIN_SLOTS.map((slot) => {
                    const isActive = findTime === slot
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => { setFindTime(slot); setFindNotice(null) }}
                        className={`rounded-lg border-2 px-2 py-1.5 text-xs font-medium transition ${
                          isActive
                            ? 'border-[#1f5f99] bg-[#1f5f99] text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {slot}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Step 4 — Available courts */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">4. Available courts</div>
                {findNotice && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {findNotice}
                  </div>
                )}
                {!findTime ? (
                  <p className="text-sm text-slate-500 text-center py-6">Choose a time above to see which courts are open.</p>
                ) : findCourts.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-6">
                    No courts are open at {LOCATION_SHORT[findLocation] || findLocation} for {findTime}. Try another time.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {findCourts.map((r) => {
                      const isMine = r.mine
                      const isSaving = Boolean(pendingReservations[`${r.location}|${findDay}|${r.courtId}|${findTime}|${currentPlayer}`])
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
                              {isSaving ? 'Saving…' : isMine ? 'Booked by you — tap to cancel' : 'Open — tap to book'}
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

      {selectedCourt && (
        <CourtSchedule
          court={selectedCourt}
          date={selectedDay}
          location={selectedLocation}
          reservations={reservations}
          roster={roster}
          currentPlayer={currentPlayer}
          pendingReservations={pendingReservations}
          onReserve={(courtId, slot, name) => handleReserve(selectedLocation, selectedDay, courtId, slot, name)}
          canGoPrevious={selectedCourtIndex > 0}
          canGoNext={selectedCourtIndex >= 0 && selectedCourtIndex < courts.length - 1}
          onPreviousCourt={() => setSelectedCourt(courts[selectedCourtIndex - 1].id)}
          onNextCourt={() => setSelectedCourt(courts[selectedCourtIndex + 1].id)}
          onClose={() => setSelectedCourt(null)}
        />
      )}
    </div>
  )
}
