import React, { useEffect, useMemo, useState } from 'react'

// Compact two-day carousel. Shows the selected day plus a neighbor; arrows
// reveal earlier/later dates. Used on the main page (every sheet date) and
// inside Find a Court (today + tomorrow only).
export default function DayCarousel({
  days = [],
  selectedDay,
  onSelect,
  visibleCount = 2,
  className = '',
}) {
  const selectedIndex = useMemo(
    () => Math.max(0, days.findIndex((d) => d.key === selectedDay)),
    [days, selectedDay]
  )

  const [start, setStart] = useState(() => Math.max(0, selectedIndex))

  useEffect(() => {
    setStart((prev) => {
      if (!days.length) return 0
      const maxStart = Math.max(0, days.length - visibleCount)
      if (selectedIndex < prev) return selectedIndex
      if (selectedIndex >= prev + visibleCount) return Math.min(selectedIndex, maxStart)
      return Math.min(prev, maxStart)
    })
  }, [selectedIndex, days.length, visibleCount])

  if (!days.length) return null

  const maxStart = Math.max(0, days.length - visibleCount)
  const windowDays = days.slice(start, start + visibleCount)
  const canPrev = start > 0
  const canNext = start < maxStart

  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <button
        type="button"
        aria-label="Previous days"
        disabled={!canPrev}
        onClick={() => setStart((s) => Math.max(0, s - 1))}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className="flex gap-2">
        {windowDays.map((d) => {
          const isActive = selectedDay === d.key
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onSelect?.(d.key)}
              className={`relative flex min-w-[6.5rem] flex-col items-center rounded-2xl border-2 px-4 py-2.5 transition-all duration-200 ${
                isActive
                  ? 'border-[#1f5f99] bg-[#1f5f99] text-white shadow-lg shadow-blue-900/20'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <span className={`text-xs font-medium ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>{d.dayName}</span>
              <span className="text-xl font-bold leading-tight">{d.dayNum}</span>
              {d.isToday && (
                <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isActive ? 'bg-emerald-400/30 text-emerald-200' : 'bg-emerald-100 text-emerald-700'}`}>
                  Today
                </span>
              )}
              {!d.isToday && d.offset === 1 && (
                <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isActive ? 'bg-white/15 text-blue-100' : 'bg-slate-100 text-slate-500'}`}>
                  Tomorrow
                </span>
              )}
              {!d.bookable && (
                <span className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${isActive ? 'bg-amber-300/25 text-amber-100' : 'bg-amber-100 text-amber-700'}`}>
                  View only
                </span>
              )}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        aria-label="Next days"
        disabled={!canNext}
        onClick={() => setStart((s) => Math.min(maxStart, s + 1))}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  )
}
