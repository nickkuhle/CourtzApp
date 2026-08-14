import React, { useMemo } from 'react'
import PlayerChip from './PlayerChip'
import useTickingNow from './useTickingNow'
import {
  courtSessionBlocks,
  currentReservationPlayers,
  describeFocusedSession,
  formatPlayerLastName,
  formatPlayerName,
  playerStyle,
} from '../lib/schedule-display'

// The court SVG is portrait (140x220) inside a landscape frame, so it is
// letterboxed. Overlay labels are positioned in that same letterboxed court
// and keep a readable size even when the painted court is small.
const COURT_WIDTH_PCT = ((140 / 220) / (11 / 7)) * 100

// One label per quadrant of the back court (the area BETWEEN the service line
// and the baseline, on both sides of the net). Order: near deuce, near ad,
// far deuce, far ad. "Deuce" and "ad" are from each player's own perspective
// (the near player's deuce side is the right half of the picture).
const QUADRANT_LAYOUT = [
  { left: `${(70 / 140) * 100}%`, top: `${(163.85 / 220) * 100}%`, width: `${(60 / 140) * 100}%`, height: `${(46.15 / 220) * 100}%` },
  { left: `${(10 / 140) * 100}%`, top: `${(163.85 / 220) * 100}%`, width: `${(60 / 140) * 100}%`, height: `${(46.15 / 220) * 100}%` },
  { left: `${(10 / 140) * 100}%`, top: `${(10 / 220) * 100}%`, width: `${(60 / 140) * 100}%`, height: `${(46.15 / 220) * 100}%` },
  { left: `${(70 / 140) * 100}%`, top: `${(10 / 220) * 100}%`, width: `${(60 / 140) * 100}%`, height: `${(46.15 / 220) * 100}%` },
]

// Compact on-court label: the player's LAST NAME only, on a translucent pill
// so it stays readable over the green court.
function QuadrantLabel({ name }) {
  const style = playerStyle(name)
  return (
    <div
      className="flex max-w-full items-center justify-center gap-1 rounded-md border border-white/60 bg-slate-950/60 px-1.5 py-0.5 shadow-sm backdrop-blur-sm"
      title={formatPlayerName(name)}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-white/50"
        style={{ background: style.fill || '#16a34a' }}
      />
      <span className="truncate text-[11px] font-bold leading-tight tracking-tight text-white">
        {formatPlayerLastName(name)}
      </span>
    </div>
  )
}

function CourtGraphic({ highlight, gradientId, players = [] }) {
  return (
    <div className="relative w-full aspect-[11/7] overflow-hidden rounded-md">
      <svg viewBox="0 0 140 220" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={highlight ? '#4ade80' : '#38a169'} />
            <stop offset="100%" stopColor={highlight ? '#22c55e' : '#2f855a'} />
          </linearGradient>
        </defs>

        <rect x="6" y="6" width="128" height="208" rx="10" fill={`url(#${gradientId})`} />
        <rect x="10" y="10" width="120" height="200" rx="8" fill="none" stroke="#fef3c7" strokeWidth="2" />
        <line x1="25" y1="10" x2="25" y2="210" stroke="#fef3c7" strokeWidth="1.6" />
        <line x1="115" y1="10" x2="115" y2="210" stroke="#fef3c7" strokeWidth="1.6" />
        <line x1="10" y1="110" x2="130" y2="110" stroke="#fef3c7" strokeWidth="2" />
        <line x1="25" y1="56.15" x2="115" y2="56.15" stroke="#fef3c7" strokeWidth="1.6" />
        <line x1="25" y1="163.85" x2="115" y2="163.85" stroke="#fef3c7" strokeWidth="1.6" />
        <line x1="70" y1="56.15" x2="70" y2="163.85" stroke="#fef3c7" strokeWidth="1.6" />
        <line x1="70" y1="10" x2="70" y2="16" stroke="#fef3c7" strokeWidth="1.6" />
        <line x1="70" y1="204" x2="70" y2="210" stroke="#fef3c7" strokeWidth="1.6" />
      </svg>

      {players.length > 0 && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2" style={{ width: `${COURT_WIDTH_PCT}%` }}>
          {players.map((name, index) => {
            const box = QUADRANT_LAYOUT[index]
            if (!box || !name) return null
            return (
              <div key={`${name}-${index}`} className="absolute flex items-center justify-center p-0.5" style={box}>
                <QuadrantLabel name={name} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SessionPreview({ blocks, completedSlots, dateKey, nowMs }) {
  if (!blocks.length) {
    return <div className="rounded-xl border border-white/10 bg-slate-950/15 px-3 py-3 text-xs italic text-blue-100/70">Court is open all day</div>
  }

  const focused = describeFocusedSession(blocks, { dateKey, nowMs })
  const notEnded = blocks.filter((block) => !block.slots.every((slot) => completedSlots?.has(slot)))
  const upcoming = focused.kind === 'current'
    ? notEnded.filter((block) => block !== focused.block)
    : notEnded
  const preview = upcoming.length ? upcoming.slice(0, 2) : (focused.kind === 'current' ? [] : blocks.slice(-1))
  const heading = upcoming.length ? 'Next on court' : (focused.kind === 'current' ? 'Later sessions' : 'Last session')

  if (!preview.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-950/20 px-3 py-2.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-100/70">{heading}</div>
        <div className="mt-1 text-xs italic text-blue-100/70">
          {focused.kind === 'current' ? 'No later reservations today' : 'Court is open all day'}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-blue-100/70">
        <span>{heading}</span>
        {upcoming.length > preview.length && <span>+{upcoming.length - preview.length} more</span>}
      </div>
      <div className="space-y-2">
        {preview.map((block) => (
          <div key={`${block.start}|${block.slots.join(',')}`} className="flex min-w-0 items-center gap-2">
            <span className="w-[4.7rem] shrink-0 text-[11px] font-bold text-white">{block.timeRange.split('–')[0]}</span>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {block.players.slice(0, 2).map((name) => <PlayerChip key={name} name={name} compact className="max-w-[8.5rem]" />)}
              {block.players.length > 2 && <span className="shrink-0 text-[10px] font-bold text-blue-100">+{block.players.length - 2}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CourtGrid = React.memo(function CourtGrid({ courts, reservations, onSelect, selectedCourt, completedSlots = null }) {
  const nowMs = useTickingNow()
  const blocksByCourt = useMemo(() => {
    const grouped = new Map()
    courts.forEach((court) => {
      grouped.set(String(court.id), courtSessionBlocks(reservations, {
        dateKey: court.date,
        location: court.location,
        court: court.id,
      }))
    })
    return grouped
  }, [courts, reservations])

  const rows = []
  for (let i = 0; i < courts.length; i += 3) rows.push(courts.slice(i, i + 3))

  return (
    <div className="w-full max-w-6xl mx-auto transition-all duration-700 ease-out">
      <div className="flex flex-col items-center gap-4 transition-all duration-700 ease-out">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex flex-wrap justify-center items-stretch gap-4 w-full transition-all duration-700 ease-out">
            {row.map((court) => {
              const blocks = blocksByCourt.get(String(court.id)) || []
              const isSelected = selectedCourt === court.id
              const onCourt = currentReservationPlayers(blocks, { dateKey: court.date, nowMs })
              const gradientId = `court-${String(court.id).replace(/[^a-z0-9]/gi, '')}-${rowIndex}-${isSelected ? 'active' : 'idle'}`
              return (
                <button
                  key={court.id}
                  type="button"
                  onClick={() => onSelect(court.id)}
                  className={`group w-full max-w-[320px] min-h-[340px] rounded-3xl shadow-xl border p-3 text-left focus:outline-none focus:ring-4 focus:ring-emerald-400/40 focus:ring-offset-2 transition-all duration-300 ease-out relative overflow-hidden animate-[fadeIn_0.35s_ease-out] ${
                    isSelected
                      ? 'bg-[#164a7a] border-emerald-400 shadow-emerald-400/20 scale-[1.03] ring-2 ring-emerald-400/50'
                      : 'bg-[#1f5f99] border-blue-300/40 hover:shadow-[0_20px_45px_rgba(15,23,42,0.25)] hover:-translate-y-2 hover:scale-[1.02] hover:border-emerald-400 active:scale-[0.98]'
                  }`}
                >
                  <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-slate-950/70 text-white text-sm px-2.5 py-1 rounded-full">
                    <span className="font-semibold">Court {court.number}</span>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </div>

                  <div className="absolute top-3 right-3 z-10 text-right">
                    <div className="text-[10px] uppercase tracking-wide text-slate-300">Sessions</div>
                    <div className={`text-lg font-bold ${blocks.length ? 'text-emerald-300' : 'text-slate-400'}`}>{blocks.length}</div>
                  </div>

                  <div className="pt-8 transition-all duration-300 ease-out group-hover:scale-[1.025]">
                    <CourtGraphic highlight={isSelected} gradientId={gradientId} players={onCourt} />
                  </div>

                  <div className="mt-3">
                    <SessionPreview blocks={blocks} completedSlots={completedSlots} dateKey={court.date} nowMs={nowMs} />
                  </div>
                  <div className="mt-2 truncate px-1 text-xs text-blue-100/80">{court.location}</div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
})

export default CourtGrid
