import React, { useEffect, useMemo, useRef } from 'react'
import {
  existingPlayerSessions,
  slotEndMinutes,
  MAX_SESSIONS_PER_DAY,
  MAX_PLAYERS_PER_SLOT,
  getSlotBookingState,
  isSlotCompleted,
  laNow,
} from '../lib/booking-rules'
import PlayerChip from './PlayerChip'
import PlayerSwitcher from './PlayerSwitcher'
import useTickingNow from './useTickingNow'
import { formatPlayerName } from '../lib/schedule-display'

function formatTimeLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  const displayMinutes = String(minutes).padStart(2, '0')
  return `${displayHours}:${displayMinutes} ${suffix}`
}

function formatMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return ''
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`
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

function XIconSmall() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function isCurrentBlock(block, minutes) {
  const start = Number(block?.start)
  const end = Number(block?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  return start <= minutes && minutes < end
}

function describeFocusedSessionInternal(blocks, { dateKey, nowMs }) {
  const list = Array.isArray(blocks) ? blocks : []
  if (!list.length || !dateKey) return { index: -1, kind: null, block: null }
  const now = laNow(nowMs)
  if (dateKey === now.dateKey) {
    const current = list.findIndex((b) => isCurrentBlock(b, now.minutes))
    if (current >= 0) return { index: current, kind: 'current', block: list[current] }
    const next = list.findIndex((b) => Number.isFinite(Number(b.start)) && Number(b.start) > now.minutes)
    if (next >= 0) return { index: next, kind: 'next', block: list[next] }
    return { index: list.length - 1, kind: 'past', block: list[list.length - 1] }
  }
  if (dateKey > now.dateKey) return { index: 0, kind: 'next', block: list[0] }
  return { index: 0, kind: 'past', block: list[0] }
}

const Slot = React.memo(function Slot({ time, reservedBy = [], currentPlayer, onClick, onCancelPlayer, disabled, ended, isOwnedByCurrentPlayer, isSaving, isFull, isPartiallyBooked }) {
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
    containerClasses = 'bg-emerald-50 border-emerald-300 hover:border-emerald-400 hover:bg-emerald-100 cursor-pointer'
    badgeClasses = 'bg-emerald-200/70 text-emerald-800'
    badgeText = `Your booking (${count}/${MAX_PLAYERS_PER_SLOT})`
    badgeIcon = <CheckIcon />
  } else if (isFull) {
    containerClasses = 'bg-slate-50 border-slate-200 cursor-not-allowed opacity-80'
    badgeClasses = 'bg-slate-200/80 text-slate-600'
    badgeText = `Full (${count}/${MAX_PLAYERS_PER_SLOT})`
    badgeIcon = <LockIcon />
  } else if (isPartiallyBooked) {
    containerClasses = 'bg-white border-amber-200 hover:border-emerald-300 hover:bg-emerald-50/70 cursor-pointer'
    badgeClasses = 'bg-amber-100 text-amber-800'
    badgeText = `${count}/${MAX_PLAYERS_PER_SLOT} booked — Open`
    badgeIcon = null
  } else {
    containerClasses = 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 cursor-pointer'
    badgeClasses = 'bg-emerald-100 text-emerald-700'
    badgeText = 'Open'
    badgeIcon = null
  }

  const actionLabel = ended
    ? `${time} has ended`
    : isSaving
      ? `${time} is saving`
      : isOwnedByCurrentPlayer
        ? `Manage your booking for ${time}`
        : isFull
          ? `${time} is fully booked`
          : reservedBy.length
            ? currentPlayer
              ? `Add ${formatPlayerName(currentPlayer)} to one of ${MAX_PLAYERS_PER_SLOT - count} open spots at ${time}`
              : `Book one of ${MAX_PLAYERS_PER_SLOT - count} open spots for ${time}`
            : currentPlayer
              ? `Book ${time} for ${formatPlayerName(currentPlayer)}`
              : `Book ${time}`

  return (
    <div className={`relative w-full rounded-xl border-2 px-4 py-3 text-left transition-all duration-200 ${containerClasses} ${!disabled ? 'cursor-pointer' : ''}`}>
      {/* Keep the primary action stretched across the ENTIRE card. The visible
          content is layered above it but lets pointer events pass through; the
          per-player cancel controls opt back in below. This preserves the x
          buttons without shrinking partially occupied slots to a header-only
          click target. */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={actionLabel}
        title={actionLabel}
        className="absolute inset-0 z-0 h-full w-full rounded-[inherit] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      >
        <span className="sr-only">{actionLabel}</span>
      </button>

      <div className="pointer-events-none relative z-10">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <ClockIcon />
            <span>{time}</span>
          </div>
          <div className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${badgeClasses}`}>
            {badgeIcon}
            <span>{badgeText}</span>
          </div>
        </div>
        {busy && reservedBy.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reservedBy.map((name) => (
              <span key={name} className="inline-flex items-center gap-0.5">
                <PlayerChip name={name} compact highlight={name === currentPlayer} />
                <button
                  type="button"
                  data-no-swipe
                  onClick={(event) => {
                    event.stopPropagation()
                    onCancelPlayer?.(name, time)
                  }}
                  title={`Cancel ${formatPlayerName(name)} from ${time}`}
                  aria-label={`Cancel ${formatPlayerName(name)} from ${time}`}
                  className="pointer-events-auto -ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-200 text-slate-600 shadow-sm hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <XIconSmall />
                </button>
              </span>
            ))}
          </div>
        )}
        {isPartiallyBooked && (
          <div className="mt-1 text-[11px] font-medium text-amber-700">
            {MAX_PLAYERS_PER_SLOT - count} spots still open — tap anywhere to {currentPlayer ? `add ${formatPlayerName(currentPlayer)}` : 'choose a player'}
          </div>
        )}
      </div>
    </div>
  )
})

function ReservedSessionsCarousel({ blocks, currentPlayer, dateKey, nowMs, onOpenBooking, viewOnly, completedSlots }) {
  const scrollerRef = useRef(null)
  const cardRefs = useRef([])
  const focused = describeFocusedSessionInternal(blocks, { dateKey, nowMs })

  useEffect(() => {
    const card = cardRefs.current[focused.index]
    if (!card || !scrollerRef.current) return
    const scroller = scrollerRef.current
    const left = card.offsetLeft - (scroller.clientWidth - card.offsetWidth) / 2
    scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [focused.index, dateKey, blocks.length])

  if (!blocks.length) {
    return (
      <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-6 sm:py-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Reserved sessions</h3>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">0</span>
        </div>
        <p className="text-[11px] text-slate-400">
          {currentPlayer ? 'No reserved sessions for this player on this day.' : 'Select a player in "Booking Courts As" to see reserved sessions.'}
        </p>
      </div>
    )
  }

  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-6 sm:py-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Reserved sessions</h3>
          <p className="text-[11px] text-slate-400">Your bookings for this day — tap a session to cancel it. Shows court and location.</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">{blocks.length}</span>
      </div>
      <div ref={scrollerRef} data-horizontal-carousel className="hide-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-0.5">
        {blocks.map((block, index) => {
          const mine = currentPlayer ? block.players.includes(currentPlayer) : true
          const isFocused = index === focused.index
          const badge = focused.kind === 'current' && isFocused ? 'Now' : focused.kind === 'next' && isFocused ? 'Next' : null
          const ended = block.slots.every((s) => (completedSlots ? completedSlots.has(s) : isSlotCompleted(block.date, s)))
          return (
            <button
              key={`${block.location}|${block.court}|${block.start}|${block.slots.join(',')}`}
              type="button"
              ref={(el) => {
                cardRefs.current[index] = el
              }}
              onClick={() => {
                onOpenBooking?.({
                  mode: 'cancel',
                  slots: block.slots,
                  players: block.players,
                  courtId: block.court,
                  location: block.location,
                  date: block.date,
                })
              }}
              className={`w-[min(19rem,85%)] shrink-0 snap-center rounded-xl border px-3 py-2.5 text-left transition hover:shadow-md ${
                mine ? 'border-emerald-300 bg-emerald-50 hover:border-emerald-400' : 'border-slate-200 bg-white hover:border-slate-300'
              } ${isFocused ? 'ring-2 ring-emerald-400/80' : ''} ${ended ? 'opacity-60' : ''}`}
              title={`Cancel reservation: ${block.location} Court ${block.court} ${block.timeRange}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-800">{block.timeRange}</span>
                <div className="flex items-center gap-1">
                  {badge && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge === 'Now' ? 'bg-emerald-500 text-white' : 'bg-sky-100 text-sky-700'}`}>{badge}</span>
                  )}
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{block.slots.length === 2 ? '60 min' : '30 min'}</span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{block.location}</span>
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">Court {block.court}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {block.players.map((name) => (
                  <span key={name} className="inline-flex items-center gap-0.5">
                    <PlayerChip name={name} compact highlight={name === currentPlayer} />
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenBooking?.({
                          mode: 'cancel',
                          slots: block.slots,
                          players: [name],
                          courtId: block.court,
                          location: block.location,
                          date: block.date,
                        })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          e.preventDefault()
                          onOpenBooking?.({
                            mode: 'cancel',
                            slots: block.slots,
                            players: [name],
                            courtId: block.court,
                            location: block.location,
                            date: block.date,
                          })
                        }
                      }}
                      title={`Cancel ${formatPlayerName(name)}`}
                      aria-label={`Cancel ${formatPlayerName(name)} from ${block.timeRange}`}
                      className="-ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-200 text-slate-600 shadow-sm hover:bg-rose-100 hover:text-rose-700 cursor-pointer"
                    >
                      <XIconSmall />
                    </span>
                  </span>
                ))}
              </div>
              <div className="mt-2 text-[10px] font-medium text-rose-600">Tap to cancel • x by each player to cancel that player</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const CourtSchedule = React.memo(function CourtSchedule({
  court,
  date,
  location,
  reservations,
  currentPlayer = '',
  roster = [],
  onSelectPlayer,
  pendingReservations = {},
  practiceLocations = null,
  viewOnly = false,
  completedSlots = null,
  barnesOnly30 = false,
  onOpenBooking,
  onPreviousCourt,
  onNextCourt,
  canGoPrevious = false,
  canGoNext = false,
  onClose,
}) {
  const nowMs = useTickingNow()

  if (!court) return null

  const key = `${location}|${date}|${court}`
  const reserved = reservations[key] || {}

  const sessionsUsed = useMemo(() => {
    if (!currentPlayer) return 0
    return existingPlayerSessions(reservations, { dateKey: date, name: currentPlayer, practiceLocations }).length
  }, [reservations, date, currentPlayer, practiceLocations])

  const totalSlots = useMemo(() => {
    const start = 8 * 60
    const end = 18 * 60
    let count = 0
    for (let t = start; t <= end; t += 30) count++
    return count
  }, [])

  const bookedCount = useMemo(() => Object.values(reserved).filter((v) => Array.isArray(v) && v.length >= MAX_PLAYERS_PER_SLOT).length, [reserved])

  const myCount = useMemo(() => {
    if (!currentPlayer) return 0
    return Object.values(reserved).reduce((acc, v) => acc + (Array.isArray(v) && v.includes(currentPlayer) ? 1 : 0), 0)
  }, [reserved, currentPlayer])

  const myReservationBlocks = useMemo(() => {
    if (!currentPlayer) return []
    if (!date) return []
    const sessions = existingPlayerSessions(reservations, { dateKey: date, name: currentPlayer, practiceLocations })
    const blocks = []
    for (const session of sessions) {
      const loc = session.location
      const courtId = String(session.court)
      const slots = [...session.slots]
      if (!slots.length) continue
      const end = slotEndMinutes(slots[slots.length - 1]) ?? session.start + slots.length * 30
      const playersSet = new Set()
      for (const slot of slots) {
        const val = reservations[`${loc}|${date}|${courtId}`]?.[slot]
        const arr = Array.isArray(val) ? val : val ? [val] : []
        arr.forEach((n) => playersSet.add(n))
      }
      if (!playersSet.has(currentPlayer)) playersSet.add(currentPlayer)
      blocks.push({
        date,
        location: loc,
        court: courtId,
        start: session.start,
        end,
        slots,
        players: [...playersSet].sort((a, b) => formatPlayerName(a).localeCompare(formatPlayerName(b))),
        timeRange: `${formatMinutes(session.start)}–${formatMinutes(end)}`,
      })
    }
    return blocks.sort((a, b) => a.start - b.start || a.location.localeCompare(b.location) || Number(a.court) - Number(b.court))
  }, [reservations, date, currentPlayer, practiceLocations])

  const slots = useMemo(() => {
    const list = []
    const start = 8 * 60
    const end = 18 * 60
    for (let t = start; t <= end; t += 30) {
      const endTime = t + 30
      list.push({ label: `${formatTimeLabel(t)}–${formatTimeLabel(endTime)}`, start: t, end: endTime })
    }
    return list
  }, [])

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="bg-gradient-to-br from-[#1f5f99] to-[#164a7a] px-5 py-4 shrink-0 sm:px-6 sm:py-5">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-white">Court {court}</h2>
            <div className="text-sm text-blue-200 mt-0.5">{location}</div>
            <div className="text-sm text-blue-200">{date}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" data-no-swipe onClick={onPreviousCourt} disabled={!canGoPrevious} aria-label="Previous court" title="Previous court (←)" className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white disabled:cursor-not-allowed disabled:opacity-30 transition">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button type="button" data-no-swipe onClick={onNextCourt} disabled={!canGoNext} aria-label="Next court" title="Next court (→)" className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white disabled:cursor-not-allowed disabled:opacity-30 transition">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
            <button type="button" data-no-swipe onClick={onClose} className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white transition ml-1" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            {totalSlots - bookedCount} open (up to {MAX_PLAYERS_PER_SLOT}/slot)
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            {bookedCount} fully booked
          </div>
          {myCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1.5 text-xs font-medium text-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-300" />
              {myCount} yours on this court
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white" title="Practice sessions used by this player today (max 2)">
            <span className="w-2 h-2 rounded-full bg-amber-300" />
            {Math.min(sessionsUsed, MAX_SESSIONS_PER_DAY)}/{MAX_SESSIONS_PER_DAY} sessions today
          </div>
          {viewOnly && (
            <div className="flex items-center gap-1.5 rounded-full bg-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-200">View only — bookings are allowed for today and tomorrow only</div>
          )}
        </div>
      </div>

      <div className="px-5 py-3 border-b border-slate-100 shrink-0 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-3">
          <PlayerSwitcher currentPlayer={currentPlayer} roster={roster} onSelect={onSelectPlayer} appearance="navbar" sessionsLabel={`${Math.min(sessionsUsed, MAX_SESSIONS_PER_DAY)}/${MAX_SESSIONS_PER_DAY} sessions`} />
          <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
            {barnesOnly30 ? '30-minute times — Barnes allows one 30-minute session per reservation' : `30-minute times — up to ${MAX_PLAYERS_PER_SLOT} players per slot`}
          </span>
        </div>
      </div>

      <ReservedSessionsCarousel blocks={myReservationBlocks} currentPlayer={currentPlayer} dateKey={date} nowMs={nowMs} onOpenBooking={onOpenBooking} viewOnly={viewOnly} completedSlots={completedSlots} />

      <div className="flex-1 overflow-auto p-5 pb-14 sm:p-6 sm:pb-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {slots.map((slot) => {
            const players = reserved[slot.label] || []
            const ended = completedSlots ? completedSlots.has(slot.label) : false
            // Re-evaluate ownership from the CURRENT "Booking Courts As"
            // player on every render. A slot held by Player A is still a book
            // action after the user switches this court card to Player X.
            const {
              action,
              isOwnedByCurrentPlayer,
              isFull,
              isPartiallyBooked,
              isReservedFullForOthers,
            } = getSlotBookingState(players, currentPlayer)
            const slotPrefix = `${key}|${slot.label}|`
            const isSaving = Object.keys(pendingReservations).some((k) => k.startsWith(`book|${slotPrefix}`) || k.startsWith(`cancel|${slotPrefix}`))
            const disabled = ended || isSaving || isReservedFullForOthers
            return (
              <Slot
                key={slot.label}
                time={slot.label}
                reservedBy={players}
                currentPlayer={currentPlayer}
                disabled={disabled}
                ended={ended}
                isOwnedByCurrentPlayer={isOwnedByCurrentPlayer}
                isSaving={isSaving}
                isFull={players.length >= MAX_PLAYERS_PER_SLOT}
                isPartiallyBooked={isPartiallyBooked}
                onClick={() => {
                  if (ended) {
                    alert('That time has already ended and can no longer be booked or canceled.')
                    return
                  }
                  if (viewOnly) {
                    alert('This day is view only — bookings and cancellations are only available for today and tomorrow.')
                    return
                  }
                  if (isReservedFullForOthers) {
                    alert(`That slot is fully booked (${MAX_PLAYERS_PER_SLOT}/${MAX_PLAYERS_PER_SLOT}) by ${players.map(formatPlayerName).join(', ')}.`)
                    return
                  }
                  if (action === 'cancel') {
                    onOpenBooking({ source: 'slot', mode: 'cancel', slots: [slot.label], players: [...new Set(players)], courtId: court, location, date })
                    return
                  }
                  const initial = currentPlayer ? [currentPlayer] : []
                  onOpenBooking({ source: 'slot', mode: 'book', slots: [slot.label], players: initial, courtId: court, location, date })
                }}
                onCancelPlayer={(name) => {
                  if (ended) {
                    alert('That time has already ended and can no longer be canceled.')
                    return
                  }
                  if (viewOnly) {
                    alert('This day is view only — bookings and cancellations are only available for today and tomorrow.')
                    return
                  }
                  onOpenBooking({ mode: 'cancel', slots: [slot.label], players: [name], courtId: court, location, date })
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
})

export default CourtSchedule
