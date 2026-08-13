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

function ReservationEntry({ entry }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
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
        <PlayerChip name={entry.player} compact />
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
    </article>
  )
}

export default function PlayerReservationsModal({ reservations, roster, initialPlayer, onClose }) {
  const [selectedPlayer, setSelectedPlayer] = useState(initialPlayer)
  const sections = useMemo(
    () => playerReservationSections(reservations, selectedPlayer),
    [reservations, selectedPlayer]
  )
  const total = sections.past.length + sections.current.length + sections.upcoming.length

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose?.()
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
              <p className="mt-1 text-sm text-blue-200">Past, current and upcoming reservations from the loaded Google Sheet.</p>
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    {entries.map((entry) => (
                      <ReservationEntry key={`${entry.location}|${entry.date}|${entry.court}|${entry.start}`} entry={entry} />
                    ))}
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
