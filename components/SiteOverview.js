import React, { useMemo } from 'react'
import { MAX_PLAYERS_PER_SLOT } from '../lib/booking-rules'
import { buildSiteOverview } from '../lib/site-overview'
import { formatPlayerName } from '../lib/schedule-display'

// "Site overview": every court at the selected location as a row, every
// 30-minute slot as a column. One glance shows which hours of the day the
// whole site is busy (red) or open (green). Tapping a square opens that
// court's schedule so the desk can jump straight into booking.

const STATUS_META = {
  open: { cell: 'bg-emerald-400', dot: 'bg-emerald-400', label: 'Open — nobody booked' },
  partial: { cell: 'bg-amber-300', dot: 'bg-amber-300', label: 'Partly booked — space left' },
  full: { cell: 'bg-rose-500', dot: 'bg-rose-500', label: 'Full — 4/4 booked' },
  ended: { cell: 'bg-slate-200/80', dot: 'bg-slate-300', label: 'Ended — time has passed' },
}

function cellTitle({ court, time, status, players }) {
  const base = `Court ${court.number} · ${time}`
  if (status === 'open') return `${base} — Open, no one booked. Tap to open this court.`
  const names = players.map(formatPlayerName).join(', ')
  if (status === 'partial') return `${base} — ${players.length}/${MAX_PLAYERS_PER_SLOT} booked (${names}). Space left. Tap to open this court.`
  if (status === 'full') return `${base} — Full (${players.length}/${MAX_PLAYERS_PER_SLOT}): ${names}.`
  return `${base} — This time has already ended.`
}

// Where to open the hover tooltip so it never runs off the edge of the grid:
// cells near the left edge open rightward, near the right edge leftward, and
// the rest stay centered above the cell.
function tooltipAlign(index, total) {
  if (index <= 2) return 'left-0'
  if (total > 0 && index >= total - 3) return 'right-0'
  return 'left-1/2 -translate-x-1/2'
}

function summaryCell({ label, available, total, ended }) {
  if (ended) {
    return {
      className: 'bg-slate-100 text-slate-400',
      text: '—',
      title: `${label} — ended`,
    }
  }
  if (total === 0) return { className: 'bg-slate-100 text-slate-400', text: '—', title: `${label} — no courts` }
  if (available === total) {
    return { className: 'bg-emerald-100 text-emerald-800', text: `${available}/${total}`, title: `${label} — every court has space` }
  }
  if (available === 0) {
    return { className: 'bg-rose-100 text-rose-700', text: '0/' + total, title: `${label} — every court is full` }
  }
  return { className: 'bg-amber-100 text-amber-800', text: `${available}/${total}`, title: `${label} — ${available} of ${total} courts have space` }
}

const SiteOverview = React.memo(function SiteOverview({
  courts,
  reservations,
  location,
  dateKey,
  slotLabels,
  completedSlots,
  onSelectCourt,
}) {
  const { rows, summary } = useMemo(
    () => buildSiteOverview({ courts, reservations, location, dateKey, slotLabels, completedSlots }),
    [courts, reservations, location, dateKey, slotLabels, completedSlots]
  )

  if (!courts.length) return null

  const gridStyle = {
    gridTemplateColumns: `minmax(5rem, 7rem) repeat(${slotLabels.length}, minmax(1.9rem, 1fr))`,
  }

  return (
    <div className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <div className="text-sm font-bold text-slate-800">Site overview</div>
          <div className="text-xs text-slate-500">{location} — every court, every time. Green = open, amber = space left, red = full, gray = ended.</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-slate-600">
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${meta.dot}`} />
              {key === 'open' ? 'Open' : key === 'partial' ? 'Space left' : key === 'full' ? 'Full' : 'Ended'}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto overscroll-x-contain">
        <div className="grid gap-px rounded-lg bg-slate-200 p-px" style={gridStyle}>
          {/* Corner + time column headers */}
          <div className="sticky left-0 z-20 flex items-center justify-center gap-1 bg-white px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Court
          </div>
          {slotLabels.map((label) => (
            <div
              key={label}
              title={label}
              className="flex h-16 items-end justify-center bg-white px-0.5 pb-1.5"
            >
              <span className="rotate-180 text-[9px] font-semibold leading-none text-slate-500 [writing-mode:vertical-rl]">
                {label.split('–')[0]}
              </span>
            </div>
          ))}

          {/* One row per court */}
          {rows.map(({ court, cells }) => (
            <React.Fragment key={court.id}>
              <button
                type="button"
                onClick={() => onSelectCourt?.(court.id)}
                className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left text-xs font-bold text-slate-700 transition hover:bg-blue-50 hover:text-[#1f5f99]"
                title={`Court ${court.number} — tap to open its schedule`}
              >
                Court {court.number}
              </button>
              {cells.map((cell, cellIndex) => {
                const meta = STATUS_META[cell.status]
                const title = cellTitle({ court, time: cell.label, status: cell.status, players: cell.players })
                const hasPlayers = cell.status === 'partial' || cell.status === 'full'
                return (
                  <button
                    key={cell.label}
                    type="button"
                    onClick={() => onSelectCourt?.(court.id)}
                    disabled={cell.status === 'ended'}
                    title={hasPlayers ? undefined : title}
                    aria-label={title}
                    className={`group relative h-7 rounded-[3px] transition focus:outline-none focus:ring-2 focus:ring-blue-500/60 ${
                      cell.status === 'ended' ? `${meta.cell} cursor-default` : `${meta.cell} cursor-pointer hover:ring-2 hover:ring-blue-500/60`
                    }`}
                  >
                    {hasPlayers && (
                      <span
                        role="tooltip"
                        className={`pointer-events-none absolute bottom-full z-30 mb-1.5 hidden w-max max-w-[18rem] flex-col gap-0.5 whitespace-normal rounded-lg border border-slate-200 bg-slate-900/95 px-2.5 py-1.5 text-left shadow-xl backdrop-blur-sm group-hover:flex ${tooltipAlign(cellIndex, cells.length)}`}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-300">
                          Court {court.number} · {cell.label}
                        </span>
                        <span className="text-xs font-semibold text-white">
                          {cell.status === 'full'
                            ? `Full — ${cell.players.length}/${MAX_PLAYERS_PER_SLOT}:`
                            : `${cell.players.length}/${MAX_PLAYERS_PER_SLOT} booked — space left:`}
                        </span>
                        <span className="text-xs leading-snug text-slate-200">{cell.players.map(formatPlayerName).join(', ')}</span>
                      </span>
                    )}
                  </button>
                )
              })}
            </React.Fragment>
          ))}

          {/* Summary row: courts with space left at each time */}
          <div
            className="sticky left-0 z-10 bg-white px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"
            title="Number of courts with space left (not fully booked) at each time"
          >
            Space
          </div>
          {summary.map((cell) => {
            const s = summaryCell(cell)
            return (
              <div
                key={cell.label}
                title={s.title}
                className={`flex h-7 items-center justify-center rounded-[3px] text-[9px] font-bold ${s.className}`}
              >
                {s.text}
              </div>
            )
          })}
        </div>
      </div>

      <p className="mt-2 px-1 text-[11px] text-slate-400">
        Tap any square to open that court&apos;s schedule. The bottom row counts courts with space left at each time — a red <span className="font-semibold text-rose-600">0</span> means every court at this site is booked.
      </p>
    </div>
  )
})

export default SiteOverview
