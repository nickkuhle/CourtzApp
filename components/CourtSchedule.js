import React, { useEffect } from 'react'
import { existingPlayerSessions, MAX_SESSIONS_PER_DAY } from '../lib/booking-rules'
import PlayerChip from './PlayerChip'
import PlayerSwitcher from './PlayerSwitcher'
import { courtSessionBlocks, formatPlayerName } from '../lib/schedule-display'

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

function Slot({ time, reservedBy = [], currentPlayer, onClick, disabled, ended, isOwnedByCurrentPlayer, isSaving }) {
  const count = Array.isArray(reservedBy) ? reservedBy.length : 0
  const busy = count > 0

  let containerClasses, badgeClasses, badgeText, badgeIcon
  if (isSaving) {
    containerClasses = 'bg-amber-50 border-amber-200 hover:border-amber-300 cursor-wait'
    badgeClasses = 'bg-amber-100 text-amber-700'
    badgeText = 'Saving…'
    badgeIcon = <SpinnerIcon />
  } else if (ended) {
    containerClasses = 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
    badgeClasses = 'bg-slate-200/80 text-slate-500'
    badgeText = 'Ended'
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

  return (
    <button
      onClick={onClick}
      disabled={disabled || isSaving}
      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all duration-200 ${containerClasses}`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <ClockIcon />
            <span>{time}</span>
          </div>
          {busy && reservedBy.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reservedBy.map((name) => (
                <PlayerChip key={name} name={name} compact highlight={name === currentPlayer} />
              ))}
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
// group booked in that slot. Days outside today/tomorrow and 30-minute slots
// that have already ended are view-only: they can be inspected but never
// booked or canceled.
export default function CourtSchedule({ court, date, location, reservations, currentPlayer = 'Alice Johnson', roster = [], onSelectPlayer, pendingReservations = {}, practiceLocations = null, viewOnly = false, completedSlots = null, barnesOnly30 = false, onOpenBooking, onPreviousCourt, onNextCourt, canGoPrevious = false, canGoNext = false, onClose }) {
  // Hooks must run unconditionally, before the early return below: returning
  // first would break the Rules of Hooks (and crash with "Rendered fewer hooks
  // than expected") if this component ever stayed mounted while court is null.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'ArrowLeft' && canGoPrevious) onPreviousCourt?.()
      if (event.key === 'ArrowRight' && canGoNext) onNextCourt?.()
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canGoPrevious, canGoNext, onPreviousCourt, onNextCourt, onClose])

  if (!court) return null

  // Count slots for summary
  const key = `${location}|${date}|${court}`
  const reserved = reservations[key] || {}

  // Practice sessions already used by this player today (max 2). Barnes
  // 30-minute slots count one each; elsewhere two consecutive 30-minute slots
  // on the same court count as a single session.
  const sessionsUsed = existingPlayerSessions(reservations, {
    dateKey: date,
    name: currentPlayer,
    practiceLocations,
  }).length

  const totalSlots = (() => {
    const start = 8 * 60
    const end = 18 * 60
    let count = 0
    for (let t = start; t <= end; t += 30) count++
    return count
  })()
  const bookedCount = Object.values(reserved).filter((v) => Array.isArray(v) && v.length > 0).length
  const myCount = Object.values(reserved).reduce((acc, v) => acc + (Array.isArray(v) && v.includes(currentPlayer) ? 1 : 0), 0)
  const sessionBlocks = courtSessionBlocks(reservations, { dateKey: date, location, court })

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
            <div
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white"
              title="Practice sessions used by this player today (max 2)"
            >
              <span className="w-2 h-2 rounded-full bg-amber-300" />
              {Math.min(sessionsUsed, MAX_SESSIONS_PER_DAY)}/{MAX_SESSIONS_PER_DAY} sessions today
            </div>
            {viewOnly && (
              <div className="flex items-center gap-1.5 rounded-full bg-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-200">
                View only — bookings are allowed for today and tomorrow only
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <PlayerSwitcher
              currentPlayer={currentPlayer}
              roster={roster}
              onSelect={onSelectPlayer}
              appearance="light"
              sessionsLabel={`${Math.min(sessionsUsed, MAX_SESSIONS_PER_DAY)}/${MAX_SESSIONS_PER_DAY} sessions`}
            />
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
              {barnesOnly30 ? '30-minute times — Barnes allows one 30-minute session per reservation' : '30-minute times'}
            </span>
          </div>
        </div>

        {/* Consecutive non-Barnes slots are summarized as a single 60-minute
            session. Barnes reservations always remain individual 30-minute
            blocks. The slot grid below stays available for the existing book
            and cancel interactions. */}
        {sessionBlocks.length > 0 && (
          <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-6 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Reserved sessions</h3>
                <p className="text-[11px] text-slate-400">Consecutive times are grouped by player.</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">{sessionBlocks.length}</span>
            </div>
            <div className="grid max-h-40 gap-2 overflow-auto sm:grid-cols-2">
              {sessionBlocks.map((block) => {
                const mine = block.players.includes(currentPlayer)
                return (
                  <div
                    key={`${block.start}|${block.slots.join(',')}`}
                    className={`rounded-xl border px-3 py-2.5 ${mine ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-800">{block.timeRange}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{block.slots.length === 2 ? '60 min' : '30 min'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {block.players.map((name) => <PlayerChip key={name} name={name} compact highlight={name === currentPlayer} />)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Slot grid */}
        <div className="p-6 overflow-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {slots.map((slot) => {
              const players = reserved[slot.label] || []
              const ended = completedSlots ? completedSlots.has(slot.label) : false
              const isOwnedByCurrentPlayer = players.includes(currentPlayer)
              const isReservedBySomeoneElse = players.length > 0 && !isOwnedByCurrentPlayer
              // Pending writes are keyed "mode|location|date|court|slots|names"
              // in handleGroupWrite (pages/index.js). A booking may also carry
              // extra players, and a cancel carries the whole group, so match
              // by prefix for this court + slot rather than one exact key.
              const slotPrefix = `${key}|${slot.label}|`
              const isSaving = Object.keys(pendingReservations).some(
                (k) => k.startsWith(`book|${slotPrefix}`) || k.startsWith(`cancel|${slotPrefix}`)
              )
              return (
                <Slot
                  key={slot.label}
                  time={slot.label}
                  reservedBy={players}
                  currentPlayer={currentPlayer}
                  disabled={isReservedBySomeoneElse || isSaving}
                  ended={ended}
                  isOwnedByCurrentPlayer={isOwnedByCurrentPlayer}
                  isSaving={isSaving}
                  onClick={() => {
                    if (ended) {
                      alert('That time has already ended and can no longer be booked or canceled.')
                      return
                    }
                    if (viewOnly) {
                      alert('This day is view only — bookings and cancellations are only available for today and tomorrow.')
                      return
                    }
                    if (isReservedBySomeoneElse) {
                      alert(`That slot is reserved by ${players.map(formatPlayerName).join(', ')}. You can only manage your own bookings.`)
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
