import React, { useEffect, useState } from 'react'

function formatTimeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  const displayMinutes = String(minutes).padStart(2, '0')
  return `${displayHours}:${displayMinutes} ${suffix}`
}

function Slot({ time, reservedBy = [], onClick, disabled }) {
  const count = Array.isArray(reservedBy) ? reservedBy.length : 0
  const busy = count > 0
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-2 rounded-md border ${
        busy ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
      } ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
    >
      <div className="flex justify-between items-center">
        <div>
          <div className="font-medium">{time}</div>
          {busy && (
            <div className="text-xs text-gray-600 truncate max-w-[14rem]">{reservedBy.join(', ')}</div>
          )}
        </div>
        <div className="text-sm text-gray-600">{busy ? 'Booked' : 'Open'}</div>
      </div>
    </button>
  )
}

export default function CourtSchedule({ court, date, location, reservations, roster = [], currentPlayer = 'Alice Johnson', pendingReservations = {}, onReserve, onPreviousCourt, onNextCourt, canGoPrevious = false, canGoNext = false, onClose }) {
  if (!court) return null

  const [selectedDuration, setSelectedDuration] = useState(location === 'Barnes Tennis Center' ? 30 : 60)

  useEffect(() => {
    setSelectedDuration(location === 'Barnes Tennis Center' ? 30 : 60)
  }, [location])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'ArrowLeft' && canGoPrevious) onPreviousCourt?.()
      if (event.key === 'ArrowRight' && canGoNext) onNextCourt?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canGoPrevious, canGoNext, onPreviousCourt, onNextCourt])

  const key = `${location}|${date}|${court}`
  const reserved = reservations[key] || {}

  const durationOptions = location === 'Barnes Tennis Center' ? [30] : [30, 60]
  const slots = []
  const start = 8 * 60 // 8:00
  const end = 18 * 60 // 6:00 PM
  for (let t = start; t <= end; t += 30) {
    const endTime = t + selectedDuration
    const startLabel = formatTimeLabel(t)
    const endLabel = formatTimeLabel(endTime)
    slots.push({ label: `${startLabel}–${endLabel}`, start: t, end: endTime })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center overflow-auto">
      <div className="absolute inset-0 bg-black opacity-40" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[calc(100vh-4rem)] overflow-auto">
        <div className="bg-[#1f5f99] px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-white">Court {court}</h2>
              <div className="text-sm text-blue-100">{location} — {date}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPreviousCourt}
                disabled={!canGoPrevious}
                aria-label="Previous court"
                title="Previous court (left arrow)"
                className="rounded bg-white/10 px-3 py-1 text-lg leading-none text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35"
              >
                ←
              </button>
              <button
                type="button"
                onClick={onNextCourt}
                disabled={!canGoNext}
                aria-label="Next court"
                title="Next court (right arrow)"
                className="rounded bg-white/10 px-3 py-1 text-lg leading-none text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35"
              >
                →
              </button>
              <button onClick={onClose} className="text-white bg-white/10 hover:bg-white/20 px-3 py-1 rounded">Close</button>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700">Booking as</span>
            <span className="rounded-full bg-[#1f5f99]/10 px-3 py-1 text-sm font-semibold text-[#1f5f99]">{currentPlayer}</span>
            <label className="text-sm font-medium text-gray-700">Duration</label>
            <select
              value={selectedDuration}
              onChange={(e) => setSelectedDuration(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {durationOptions.map((d) => (
                <option key={d} value={d}>{d} min</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {slots.map((slot) => {
              const players = reserved[slot.label] || []
              const isOwnedByCurrentPlayer = players.includes(currentPlayer)
              const isReservedBySomeoneElse = players.length > 0 && !isOwnedByCurrentPlayer
              const requestKey = `${key}|${slot.label}|${currentPlayer}`
              const isSaving = Boolean(pendingReservations[requestKey])
              return (
                <Slot
                  key={slot.label}
                  time={slot.label}
                  reservedBy={players}
                  disabled={isReservedBySomeoneElse || isSaving}
                  onClick={() => {
                    if (isOwnedByCurrentPlayer) {
                      if (confirm(`Cancel your reservation at ${slot.label}?`)) {
                        onReserve(court, slot.label, currentPlayer)
                      }
                      return
                    }
                    if (isReservedBySomeoneElse) {
                      alert(`That slot is reserved by ${players.join(', ')}. You can only manage your own bookings.`)
                      return
                    }

                    const keyPrefix = `${location}|${date}`
                    const playerCountToday = Object.keys(reservations).reduce((acc, k) => {
                      if (!k.startsWith(keyPrefix)) return acc
                      const slotsForCourt = reservations[k] || {}
                      Object.values(slotsForCourt).forEach((arr) => {
                        if (Array.isArray(arr) && arr.includes(currentPlayer)) acc++
                      })
                      return acc
                    }, 0)

                    if (playerCountToday >= 2) {
                      alert('You already have 2 sessions today.')
                      return
                    }

                    onReserve(court, slot.label, currentPlayer)
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
