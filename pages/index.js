import { useEffect, useMemo, useState } from 'react'
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

function getDateKey(d) {
  return d.toISOString().slice(0, 10)
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

  useEffect(() => {
    setMounted(true)
    // Generate days from today until Sunday Aug 16 (tournament end)
    const today = new Date()
    const endDate = new Date('2026-08-16T12:00:00') // tournament Sunday
    const newDays = []
    const cur = new Date(today)
    // Include today and go until Sunday
    let daysCount = 0
    while (cur <= endDate && daysCount < 14) {
      newDays.push({ label: `${formatDate(new Date(cur))}`, key: getDateKey(cur) })
      cur.setDate(cur.getDate() + 1)
      daysCount++
    }
    // Fallback to at least 3 days if endDate passed
    if (newDays.length === 0) {
      for (let offset = 0; offset < 3; offset++) {
        const d = new Date(today)
        d.setDate(today.getDate() + offset)
        newDays.push({ label: `${formatDate(d)}`, key: getDateKey(d) })
      }
    }
    setDays(newDays)
    setSelectedDay(newDays[0].key)
  }, [])

  useEffect(() => {
    setCurrentPlayer(getPlayerFromUrl())
  }, [])

  useEffect(() => {
    async function loadReservations() {
      try {
        const response = await fetch('/api/reservations')
        if (!response.ok) {
          throw new Error('Failed to load reservations')
        }
        const result = await response.json()
        setReservations(result.reservations || {})
      } catch (e) {
        console.error('Failed reading reservations', e)
      }
    }
    async function loadRoster() {
      try {
        const res = await fetch('/api/roster')
        const data = await res.json()
        if (data.roster && Array.isArray(data.roster) && data.roster.length > 0) {
          setRoster(data.roster)
        }
      } catch (e) {
        console.warn('Using fallback roster', e)
      } finally {
        setRosterLoaded(true)
      }
    }

    loadReservations()
    loadRoster()
  }, [])

  // Keep currentPlayer valid when roster loads
  useEffect(() => {
    if (rosterLoaded && roster.length > 0 && !roster.includes(currentPlayer)) {
      setCurrentPlayer(roster[0])
    }
  }, [rosterLoaded])

  // Normalize old reservation shape: ensure slot entries are arrays of names
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

  function handleSelectCourt(id) {
    setSelectedCourt(id)
  }

  async function handleReserve(courtId, slot, name) {
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: selectedLocation, date: selectedDay, courtId, slot, name }),
      })

      if (!response.ok) {
        throw new Error('Unable to save reservation')
      }

      const result = await response.json()
      setReservations(result.reservations || {})
    } catch (e) {
      console.error('Failed saving reservation', e)
      alert('Unable to update reservation. Please try again.')
    }
  }

  // Prevent hydration mismatch: render nothing on server until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7fafc] text-slate-500">
        Loading Courtz...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(134,239,172,0.18),_transparent_18%),linear-gradient(180deg,#f7fafc_0%,#e2f3e8_35%,#f1f5f9_100%)] p-6 text-slate-900">
      <div className="max-w-6xl mx-auto">
        <nav className="sticky top-6 z-40 flex flex-wrap lg:flex-nowrap justify-between items-center gap-3 bg-[#1f5f99]/80 border border-blue-300/10 backdrop-blur-xl rounded-[2rem] px-6 py-4 shadow-2xl shadow-slate-950/20 mb-8">
          <div className="flex items-center gap-3 min-w-0">
            <img src={LOGO_URL} alt="USTA logo" className="h-10 w-10 rounded-full border border-white/20 bg-white/10 object-cover shrink-0" />
            <div className="min-w-0">
              <div className="text-base lg:text-lg font-semibold tracking-tight text-white truncate">USTA Girl's National Championships</div>
              <div className="text-xs uppercase tracking-[0.15em] text-slate-400 truncate">{selectedLocation}</div>
            </div>
          </div>
          <div className="flex flex-wrap lg:flex-nowrap justify-center items-center gap-2 text-sm shrink-0">
            <a href="https://ustagirlsnationals.com" target="_blank" rel="noreferrer" className="rounded-full px-3 py-1.5 text-slate-200 hover:text-white hover:bg-white/10 transition hidden xl:block">Tournament</a>
            <button className="rounded-full px-3 py-1.5 bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 transition hidden md:block">Practice Courts</button>
            <a href="#info" className="rounded-full px-3 py-1.5 text-slate-200 hover:text-white hover:bg-white/10 transition hidden lg:block">Info</a>
            <a href="#contact" className="rounded-full px-3 py-1.5 text-slate-200 hover:text-white hover:bg-white/10 transition hidden lg:block">Contact</a>
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
                  className="w-36 lg:w-40 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs lg:text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
                {showPlayerDropdown && (
                  <div className="absolute top-full mt-2 left-0 w-56 lg:w-64 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl z-50">
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
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-emerald-50 ${name === currentPlayer ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-700'}`}
                        >
                          {name}
                        </button>
                      ))}
                    {roster.filter(n => n.toLowerCase().includes(playerSearch.toLowerCase())).length === 0 && (
                      <div className="px-4 py-2 text-sm text-slate-400">No match</div>
                    )}
                    <div className="px-3 py-1 text-xs text-slate-400 border-t">
                      {roster.filter(n => n.toLowerCase().includes(playerSearch.toLowerCase())).length} of {roster.length} players
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </nav>

        <div className="flex flex-col md:flex-row justify-center items-stretch gap-4 mb-10">
          <div className="w-full md:w-auto rounded-[1.5rem] border border-blue-300/10 bg-[#1f5f99]/80 p-6 shadow-xl shadow-slate-950/20 backdrop-blur-xl">
            <label className="flex flex-col items-start gap-3 text-sm font-medium text-slate-200">
              <span className="text-slate-300">Day</span>
              <select
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="w-56 appearance-none rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 shadow-inner shadow-black/10 focus:border-emerald-400 focus:outline-none"
              >
                {days.map((d) => (
                  <option key={d.key} value={d.key} className="bg-slate-950 text-slate-100">
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="w-full md:w-auto rounded-[1.5rem] border border-blue-300/10 bg-[#1f5f99]/80 p-6 shadow-xl shadow-slate-950/20 backdrop-blur-xl">
            <label className="flex flex-col items-start gap-3 text-sm font-medium text-slate-200">
              <span className="text-slate-300">Location</span>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-72 appearance-none rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 shadow-inner shadow-black/10 focus:border-emerald-400 focus:outline-none"
              >
                {LOCATIONS.map((l) => (
                  <option key={l} value={l} className="bg-slate-950 text-slate-100">
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <section className="mb-6">
          <div className="text-center mb-4">
            <h1 className="text-5xl font-bold tracking-tight text-[#1f5f99]">{selectedLocation}</h1>
          </div>
          <div className="flex justify-center">
            <CourtGrid courts={courts} reservations={reservations} onSelect={handleSelectCourt} />
          </div>
        </section>

        <section id="info" className="mt-16 rounded-[1.5rem] border border-white/10 bg-slate-900/80 p-8 shadow-xl shadow-slate-950/30 backdrop-blur-xl mb-8">
          <h2 className="text-2xl font-semibold text-white mb-3">Info</h2>
          <p className="text-slate-300 leading-relaxed">Welcome to the USTA Girl's National Championships practice court scheduler. Use this page to book 30-minute practice sessions at the selected venue for the tournament.</p>
          <ul className="mt-4 space-y-2 text-slate-300">
            <li>• Practice-only courts are available at {LOCATIONS.join(', ')}.</li>
            <li>• Select a date and location, then click a court to reserve a 30-minute slot.</li>
            <li>• Reservations persist on the backend so your schedule remains available across sessions.</li>
          </ul>
        </section>

        <section id="contact" className="mt-16 rounded-[1.5rem] border border-white/10 bg-slate-900/80 p-8 shadow-xl shadow-slate-950/30 backdrop-blur-xl mb-8">
          <h2 className="text-2xl font-semibold text-white mb-3">Contact</h2>
          <p className="text-slate-300 leading-relaxed">For tournament inquiries, please visit the official event website or reach out to the tournament staff for scheduling support.</p>
          <p className="mt-4 text-slate-300">Email: <a href="mailto:info@ustagirlsnationals.com" className="text-emerald-300 hover:text-emerald-200">info@ustagirlsnationals.com</a></p>
        </section>

        <footer className="mt-8 text-sm text-gray-400">Click a court to view the schedule and reserve 30-minute slots.</footer>
      </div>

      {selectedCourt && (
        <CourtSchedule
          court={selectedCourt}
          date={selectedDay}
          location={selectedLocation}
          reservations={reservations}
          roster={roster}
          currentPlayer={currentPlayer}
          onReserve={(courtId, slot, name) => handleReserve(courtId, slot, name)}
          onClose={() => setSelectedCourt(null)}
        />
      )}
    </div>
  )
}
