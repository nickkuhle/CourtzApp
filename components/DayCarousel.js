import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useHorizontalSwipe from './useHorizontalSwipe'

const GAP_PX = 8
const ITEM_WIDTH_PX = 112

const Arrow = React.memo(function Arrow({ direction, disabled, onClick, label }) {
  return (
    <button
      type="button"
      data-no-swipe
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {direction === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  )
})

// Compact two-day carousel with memoization for performance
const DayCarousel = React.memo(function DayCarousel({
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
  const itemRef = useRef(null)
  const [itemWidth, setItemWidth] = useState(ITEM_WIDTH_PX)

  useEffect(() => {
    const el = itemRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      const width = el.getBoundingClientRect().width
      if (width) setItemWidth(width)
    })
    observer.observe(el)
    const width = el.getBoundingClientRect().width
    if (width) setItemWidth(width)
    return () => observer.disconnect()
  }, [days.length])

  const shown = Math.max(1, Math.min(visibleCount, days.length || 1))
  const maxStart = Math.max(0, days.length - shown)
  const start = Math.min(selectedIndex, maxStart)
  const stride = itemWidth + GAP_PX
  const canPrev = selectedIndex > 0
  const canNext = selectedIndex < days.length - 1

  const selectOffset = useCallback((delta) => {
    const next = Math.min(days.length - 1, Math.max(0, selectedIndex + delta))
    if (days[next] && days[next].key !== selectedDay) onSelect?.(days[next].key)
  }, [days, selectedDay, selectedIndex, onSelect])

  const { dragX, dragging, bind } = useHorizontalSwipe({
    onSwipeLeft: () => selectOffset(1),
    onSwipeRight: () => selectOffset(-1),
    canSwipeLeft: canNext,
    canSwipeRight: canPrev,
    enabled: days.length > 1,
  })

  if (!days.length) return null

  const viewportWidth = shown * itemWidth + Math.max(0, shown - 1) * GAP_PX

  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <Arrow direction="left" label="Previous day" disabled={!canPrev} onClick={() => selectOffset(-1)} />

      <div
        className="overflow-hidden touch-pan-y overscroll-x-contain"
        style={{ width: viewportWidth }}
        {...bind}
      >
        <div
          className="flex"
          style={{
            gap: GAP_PX,
            transform: `translate3d(${-start * stride + dragX}px, 0, 0)`,
            transition: dragging ? 'none' : 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'transform',
          }}
        >
          {days.map((d, index) => {
            const isActive = selectedDay === d.key
            return (
              <button
                key={d.key}
                ref={index === 0 ? itemRef : null}
                type="button"
                onClick={() => onSelect?.(d.key)}
                style={{ width: itemWidth }}
                className={`relative flex shrink-0 flex-col items-center rounded-2xl border-2 px-4 py-2.5 transition-colors duration-200 ${
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
      </div>

      <Arrow direction="right" label="Next day" disabled={!canNext} onClick={() => selectOffset(1)} />
    </div>
  )
})

export default DayCarousel
