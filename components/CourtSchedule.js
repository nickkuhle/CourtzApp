import React, { useEffect, useState } from 'react'
import { isSlotCompleted } from '../lib/booking-window'

function formatTimeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  const displayMinutes = String(minutes).padStart(2, '0')
  return `${displayHours}:${displayMinutes} ${suffix}`
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

function EndedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function Slot({ time, reservedBy = [], onClick, disabled, isOwnedByCurrentPlayer, isSaving, completed, viewOnly }) {
  const count = Array.isArray(reservedBy) ? reservedBy.length : 0
  const busy = count > 0

  let containerClasses, badgeClasses, badgeText, badgeIcon
  if (isSaving) {
    containerClasses = 'bg-amber-50 border-amber-200 hover:border-amber-300 cursor-wait'
    badgeClasses = 'bg-amber-100 text-amber-700'
    badgeText = 'Saving…'
    badgeIcon = <SpinnerIcon />
  } else if (completed) {
    containerClasses = 'bg-slate-100 border-slate-200 cursor-not-allowed opacity-70'
    badgeClasses = 'bg-slate-200 text-slate-500'
    badgeText = 'Ended'
    badgeIcon = <EndedIcon />
  } else if (viewOnly) {
    containerClasses = 'bg-slate-50 border-slate-200 cursor-not-allowed opacity-80'
    badgeClasses = 'bg-slate-200 text-slate-600'
    badgeText = 'View only'
    badgeIcon = <LockIcon />
  } else if (isOwnedByCurrentPlayer) {
    containerClasses = 'bg-emerald-50 border-emerald-200 hover:border-emerald-400 hover:bg-emerald-100 cursor-pointer'
    badgeClasses = 'bg-emerald-200/70 text-emerald-800'
    badgeText = 'Your booking'
    badgeIcon = <CheckIcon />
  } else if (busy) {
    containerClasses = 'bg-slate-50 border-slate-200 cursor-not-allowed opacity-70'
    badgeClasses = 'bg-slate-200/70 text-slate-600'
    badgeText = 'Booked'
    badgeIcon = <LockIcon />
  } else {
    containerClasses = 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 cursor-pointer'
    badgeClasses = 'bg-emerald-100 text-emerald-700'
    badgeText = 'Open'
    badgeIcon = null
  }

  const blockReason = completed
    ? 'This time slot has already ended and can no longer be booked or canceled.'
    : viewOnly
      ? 'This day is view only. Reservations can only be booked or changed for today and tomorrow (America/Los_Angeles).'
      : undefined

  return (
    <button
      onClick={onClick}
      disabled={disabled || isSaving || completed || viewOnly}
      title={blockReason}
      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all duration-200 ${containerClasses}`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <ClockIcon />
            <span>{time}</span>
          </div>
          {busy && reservedBy.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-slate-500">
              <UserIcon />
              <span className="truncate">{reservedBy.join(', ')}</span>
            </div>
          )}
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full shrink-0 ${badgeClasses}`}>
          {badgeIcon}
          <span>{badgeText}</span>
        </div>
      </div>
    </button>
  )
}

// Slot clicks are handed to the parent, which opens the shared group-booking
// dialog: open slots start a booking with the signed-in player; slots the
// signed-in player already holds open the cancellation dialog for the whole
// group booked in that slot. View-only days and already-ended slots are
// disabled here (and rechecked by the API and Apps Script).
export default function CourtSchedule({ court, date, location, reservations, currentPlayer = 'Alice Johnson', pendingReservations = {}, viewOnly = false, onOpenBooking, onPreviousCourt, onNextCourt, canGoPrevious = false, canGoNext = false, onClose }) {
  if (!court) return null

  // Re-evaluate "now" once a minute so ended slots and the booking window stay
  // correct while the schedule stays open.
  const [clockNow, setClockNow] = useState(() => new Date())
  useEffect(() => {
    const tick = setInterval(() => setClockNow(new Date()), 60_000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'ArrowLeft' && canGoPrevious) onPreviousCourt?.()
      if (event.key === 'ArrowRight' && canGoNext) onNextCourt?.()
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canGoPrevious, canGoNext, onPreviousCourt, onNextCourt, onClose])

  // Count slots for summary
  const key = `${location}|${date}|${court}`
  const reserved = reservations[key] || {}

  const totalSlots = (() => {
    const start = 8 * 60
    const end = 18 * 60
    let count = 0
    for (let t = start; t <= end; t += 30) count++
    return count
  })()
  const bookedCount = Object.values(reserved).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0)
  const myCount = Object.values(reserved).reduce((acc, v) => acc + (Array.isArray(v) && v.includes(currentPlayer) ? 1 : 0), 0)

  const slots = []
  const start = 8 * 60 // 8:00
  const end = 18 * 60 // 6:00 PM
  for (let t = start; t <= end; t += 30) {
    const endTime = t + 30
    const startLabel = formatTimeLabel(t)
    const endLabel = formatTimeLabel(endTime)
    slots.push({ label: `${startLabel}–${endLabel}`, start: t, end: endTime })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center overflow-auto">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 my-8 max-h-[calc(100vh-4rem)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-br from-[#1f5f99] to-[#164a7a] px-6 py-5 shrink-0">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-white">Court {court}</h2>
              <div className="text-sm text-blue-200 mt-0.5">{location}</div>
              <div className="text-sm text-blue-200">{date}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onPreviousCourt}
                disabled={!canGoPrevious}
                aria-label="Previous court"
                title="Previous court (←)"
                className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white disabled:cursor-not-allowed disabled:opacity-30 transition"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button
                type="button"
                onClick={onNextCourt}
                disabled={!canGoNext}
                aria-label="Next court"
                title="Next court (→)"
                className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white disabled:cursor-not-allowed disabled:opacity-30 transition"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
              <button onClick={onClose} className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white transition ml-1" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>

          {/* Summary bar */}
          <div className="flex flex-wrap gap-3 mt-4">
            <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {totalSlots - bookedCount} open
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              {bookedCount} booked
            </div>
            {myCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1.5 text-xs font-medium text-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-300" />
                {myCount} yours
              </div>
            )}
            {viewOnly && (
              <div className="flex items-center gap-1.5 rounded-full bg-slate-500/30 px-3 py-1.5 text-xs font-medium text-slate-200">
                <LockIcon />
                View only — bookings and cancellations are limited to today and tomorrow
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-600">Booking as</span>
              <span className="rounded-full bg-[#1f5f99]/10 px-3 py-1 text-sm font-semibold text-[#1f5f99]">{currentPlayer}</span>
            </div>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">30-minute times</span>
          </div>
        </div>

        {/* Slot grid */}
        <div className="p-6 overflow-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {slots.map((slot) => {
              const players = reserved[slot.label] || []
              const isOwnedByCurrentPlayer = players.includes(currentPlayer)
              const isReservedBySomeoneElse = players.length > 0 && !isOwnedByCurrentPlayer
              const requestKey = `${key}|${slot.label}|${currentPlayer}`
              const isSaving = Boolean(pendingReservations[requestKey])
              // The current 30-minute slot stays usable until its end time;
              // earlier slots are ended and locked.
              const completed = !viewOnly && isSlotCompleted(slot.label, date, clockNow)
              return (
                <Slot
                  key={slot.label}
                  time={slot.label}
                  reservedBy={players}
                  disabled={isReservedBySomeoneElse || isSaving}
                  isOwnedByCurrentPlayer={isOwnedByCurrentPlayer}
                  isSaving={isSaving}
                  completed={completed}
                  viewOnly={viewOnly}
                  onClick={() => {
                    if (isReservedBySomeoneElse) {
                      alert(`That slot is reserved by ${players.join(', ')}. You can only manage your own bookings.`)
                      return
                    }
                    if (isOwnedByCurrentPlayer) {
                      onOpenBooking({ mode: 'cancel', slots: [slot.label], players: [...new Set(players)] })
                      return
                    }
                    onOpenBooking({ mode: 'book', slots: [slot.label], players: [currentPlayer] })
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
