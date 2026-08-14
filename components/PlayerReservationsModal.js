import React, { useEffect, useMemo, useState } from 'react'
import PlayerChip from './PlayerChip'
import PlayerSwitcher from './PlayerSwitcher'
import { formatPlayerName, playerReservationSections } from '../lib/schedule-display'

const SECTION_META = [
  { key: 'past', title: 'Past', description: 'Previous tournament days' },
  { key: 'current', title: 'Current', description: 'Today in San Diego' },
  { key: 'upcoming', title: 'Upcoming', description: 'Tomorrow and later dates' },
]

function formatDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  if (!year || !month || !day) return dateKey
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// Every player booked in the reservation's slots (not just the selected one),
// so the card shows the whole group that a cancellation would affect.
function groupPlayersForEntry(reservations, entry) {
  const set = new Set()
  const key = `${entry.location}|${entry.date}|${entry.court}`
  for (const slot of entry.slots || []) {
    const value = reservations[key]?.[slot]
    const names = Array.isArray(value) ? value : (value ? [value] : [])
    names.forEach((name) => set.add(name))
  }
  return [...set]
}

// One reservation card. Entries that can still be changed (today/tomorrow, not
// ended) render as a button — clicking anywhere on the card opens the shared
// cancellation dialog, where individual players can be removed from the
// request before confirming.
function ReservationEntry({ entry, group = [], onCancel }) {
  const cancelable = Boolean(onCancel)
  const inner = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-bold text-slate-800">{entry.location}</h4>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Court {entry.court}</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">{formatDateKey(entry.date)}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-[#1f5f99]">{entry.timeRange}</div>
          <div className="mt-1 text-[11px] text-slate-400">
            {entry.slots.length === 2 ? '60-minute session' : '30-minute session'}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {group.length > 0
          ? group.map((name) => <PlayerChip key={name} name={name} compact highlight={name === entry.player} />)
          : <PlayerChip name={entry.player} compact highlight />}
        {entry.section === 'current' && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">Today</span>
        )}
        {entry.status !== 'Today' && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${entry.ended ? 'bg-slate-200 text-slate-600' : entry.section === 'upcoming' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
            {entry.status}
          </span>
        )}
        {entry.viewOnly && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">View only</span>
        )}
      </div>
      {cancelable && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <span className="text-[11px] text-slate-400">
            {group.length > 1 ? `${group.length} players in this reservation` : 'Your reservation'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-700 transition group-hover:bg-rose-600 group-hover:text-white">
            <XIcon />
            Cancel
          </span>
        </div>
      )}
    </>
  )

  if (cancelable) {
    return (
      <button
        type="button"
        onClick={() => onCancel(entry)}
        aria-label={`Cancel the reservation for ${formatPlayerName(entry.player)} on Court ${entry.court} at ${entry.location} ${entry.timeRange}`}
        className="group h-full w-full rounded-2xl border-2 border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-rose-300 hover:shadow-md cursor-pointer"
      >
        {inner}
      </button>
    )
  }
  return (
    <article className="h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      {inner}
    </article>
  )
}

export default function PlayerReservationsModal({ reservations, roster, initialPlayer, onClose, onCancelReservation }) {
  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayer)
  const sections = useMemo(
    () => playerReservationSections(reservations, selectedPlayer),
    [reservations, selectedPlayer]
  )
  const total = sections.past.length + sections.current.length + sections.upcoming.length

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        // Let the cancellation dialog handle Escape when it is open on top.
        if (document.querySelector('[data-booking-modal]')) return
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center overflow-auto md:items-center">
      <div className="absolute inset-0 bg-slate-900/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-4 my-8 flex max-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-2xl">
        <header className="shrink-0 bg-gradient-to-br from-[#1f5f99] to-[#164a7a] px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-blue-200">
                <CalendarIcon />
                <span className="text-xs font-bold uppercase tracking-[0.15em]">Player schedule</span>
              </div>
              <h2 className="mt-1 text-2xl font-bold text-white">Player&apos;s reservations</h2>
              <p className="mt-1 text-sm text-blue-200">Past, current and upcoming reservations. Swipe sideways through each list — tap a current or upcoming reservation to cancel it.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl bg-white/10 p-2 text-white transition hover:bg-white/20" aria-label="Close reservations">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </header>

        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PlayerSwitcher
              currentPlayer={selectedPlayer}
              roster={roster}
              onSelect={setSelectedPlayer}
              label="Reservations For"
              appearance="light"
              dropdownAlign="left"
              className="max-w-full"
            />
            <div className="text-sm text-slate-500">
              <span className="font-bold text-slate-800">{total}</span> reservation session{total === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-auto p-5 sm:p-6">
          {total === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400"><CalendarIcon /></div>
              <h3 className="mt-3 font-bold text-slate-700">No reservations found</h3>
              <p className="mt-1 text-sm text-slate-500">{formatPlayerName(selectedPlayer)} does not have a reservation on any date currently loaded from the Sheet.</p>
            </div>
          )}

          {SECTION_META.map((meta) => {
            const entries = sections[meta.key]
            return (
              <section key={meta.key} aria-labelledby={`reservation-section-${meta.key}`}>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <h3 id={`reservation-section-${meta.key}`} className="text-base font-bold text-slate-800">{meta.title}</h3>
                    <p className="text-xs text-slate-400">{meta.description}</p>
                  </div>
                  <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">{entries.length}</span>
                </div>
                {entries.length ? (
                  <div className="hide-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1">
                    {entries.map((entry) => {
                      const group = groupPlayersForEntry(reservations, entry)
                      // Only reservations that can still be changed can be
                      // canceled: today/tomorrow, and not already ended.
                      const cancelable = !entry.viewOnly && !entry.ended
                      return (
                        <div key={`${entry.location}|${entry.date}|${entry.court}|${entry.start}`} className="w-[min(18rem,80%)] shrink-0 snap-center">
                          <ReservationEntry
                            entry={entry}
                            group={group}
                            onCancel={cancelable ? onCancelReservation : null}
                          />
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-3 text-sm text-slate-400">No {meta.title.toLowerCase()} reservations.</div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
