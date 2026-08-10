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

// Roster of tournament players (only these names may reserve)
const ROSTER = [
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
  const today = new Date()
  const days = [0, 1, 2].map((offset) => {
    const d = new Date(today)
    d.setDate(today.getDate() + offset)
    return { label: `${formatDate(d)}`, key: getDateKey(d) }
  })

  const [selectedDay, setSelectedDay] = useState(days[0].key)
  const [selectedLocation, setSelectedLocation] = useState(LOCATIONS[0])
  const [selectedCourt, setSelectedCourt] = useState(null)
  const [currentPlayer, setCurrentPlayer] = useState('Alice Johnson')

  const [reservations, setReservations] = useState({})

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

    loadReservations()
  }, [])

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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(134,239,172,0.18),_transparent_18%),linear-gradient(180deg,#f7fafc_0%,#e2f3e8_35%,#f1f5f9_100%)] p-6 text-slate-900">
      <div className="max-w-6xl mx-auto">
        <nav className="sticky top-6 z-40 flex flex-col lg:flex-row justify-between items-center gap-4 bg-[#1f5f99]/80 border border-blue-300/10 backdrop-blur-xl rounded-[2rem] px-8 py-5 shadow-2xl shadow-slate-950/20 mb-8">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="USTA logo" className="h-12 w-12 rounded-full border border-white/20 bg-white/10 object-cover" />
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">USTA Girl's National Championships</div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{selectedLocation}</div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-3 text-sm">
            <a href="https://ustagirlsnationals.com" target="_blank" rel="noreferrer" className="rounded-full px-4 py-2 text-slate-200 hover:text-white hover:bg-white/10 transition">Tournament</a>
            <button className="rounded-full px-4 py-2 bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 transition">Practice Courts</button>
            <a href="#info" className="rounded-full px-4 py-2 text-slate-200 hover:text-white hover:bg-white/10 transition">Info</a>
            <a href="#contact" className="rounded-full px-4 py-2 text-slate-200 hover:text-white hover:bg-white/10 transition">Contact</a>
            <div className="flex items-center gap-2 rounded-full border border-emerald-400/70 bg-emerald-500 px-3 py-2 shadow-sm shadow-emerald-500/20">
              <span className="text-sm font-medium text-white">Signed in as</span>
              <select
                value={currentPlayer}
                onChange={(e) => setCurrentPlayer(e.target.value)}
                className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
              >
                {ROSTER.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
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
          roster={ROSTER}
          currentPlayer={currentPlayer}
          onReserve={(courtId, slot, name) => handleReserve(courtId, slot, name)}
          onClose={() => setSelectedCourt(null)}
        />
      )}
    </div>
  )
}
