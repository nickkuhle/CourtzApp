import React, { useEffect } from 'react'
import CourtSchedule from './CourtSchedule'
import useHorizontalSwipe from './useHorizontalSwipe'

function Chevron({ direction }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {direction === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  )
}

// Full-screen pager of court cards for one location. Opening a court from the
// grid lands on that card; swiping or the arrows move between every court at
// the site without leaving the booking UI.
export default function CourtCardCarousel({
  courts = [],
  selectedCourt,
  onSelectCourt,
  onClose,
  date,
  location,
  reservations,
  roster,
  currentPlayer,
  onSelectPlayer,
  pendingReservations,
  practiceLocations,
  viewOnly,
  completedSlots,
  barnesOnly30,
  onOpenBooking,
}) {
  const count = courts.length
  const index = Math.max(0, courts.findIndex((court) => court.id === selectedCourt))

  const { dragX, dragging, bind } = useHorizontalSwipe({
    onSwipeLeft: () => {
      if (index < count - 1) onSelectCourt?.(courts[index + 1].id)
    },
    onSwipeRight: () => {
      if (index > 0) onSelectCourt?.(courts[index - 1].id)
    },
    canSwipeLeft: index < count - 1,
    canSwipeRight: index > 0,
    enabled: count > 1,
    ignoreSelector: '[data-horizontal-carousel]',
  })

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        if (document.querySelector('[data-booking-modal]')) return
        onClose?.()
        return
      }
      if (event.key === 'ArrowLeft' && index > 0) onSelectCourt?.(courts[index - 1].id)
      if (event.key === 'ArrowRight' && index < count - 1) onSelectCourt?.(courts[index + 1].id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [index, count, courts, onSelectCourt, onClose])

  if (!count || selectedCourt == null) return null

  const trackPercent = Math.max(count, 1) * 100
  const slidePercent = 100 / Math.max(count, 1)

  return (
    <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true" aria-label="Court schedules">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="relative flex min-h-0 flex-1 touch-pan-y items-stretch overflow-hidden overscroll-x-contain"
          {...bind}
        >
          <div
            className="flex h-full shrink-0"
            style={{
              width: `${trackPercent}%`,
              transform: `translate3d(calc(${-index * slidePercent}% + ${dragX}px), 0, 0)`,
              transition: dragging ? 'none' : 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: 'transform',
            }}
          >
            {courts.map((court, courtIndex) => (
              <div
                key={court.id}
                data-court-id={court.id}
                className="flex h-full shrink-0 items-stretch justify-center px-2 py-5 sm:px-4 sm:py-6"
                style={{ width: `${slidePercent}%` }}
                aria-hidden={court.id !== selectedCourt}
                {...(court.id !== selectedCourt ? { inert: '' } : {})}
              >
                <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl">
                <CourtSchedule
                  court={court.id}
                  date={date}
                  location={location}
                  reservations={reservations}
                  roster={roster}
                  currentPlayer={currentPlayer}
                  onSelectPlayer={onSelectPlayer}
                  pendingReservations={pendingReservations}
                  practiceLocations={practiceLocations}
                  viewOnly={viewOnly}
                  completedSlots={completedSlots}
                  barnesOnly30={barnesOnly30}
                  onOpenBooking={(payload) => onOpenBooking?.({
                    ...payload,
                    courtId: court.id,
                    location,
                    date,
                  })}
                  canGoPrevious={courtIndex > 0}
                  canGoNext={courtIndex < count - 1}
                  onPreviousCourt={() => courtIndex > 0 && onSelectCourt?.(courts[courtIndex - 1].id)}
                  onNextCourt={() => courtIndex < count - 1 && onSelectCourt?.(courts[courtIndex + 1].id)}
                  onClose={onClose}
                />
                </div>
              </div>
            ))}
          </div>
        </div>

        {count > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4">
            <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full bg-slate-950/75 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm">
              <button
                type="button"
                data-no-swipe
                onClick={() => index > 0 && onSelectCourt?.(courts[index - 1].id)}
                disabled={index <= 0}
                aria-label="Previous court"
                className="rounded-full p-0.5 text-white/80 transition hover:text-white disabled:opacity-30"
              >
                <Chevron direction="left" />
              </button>
              <span className="whitespace-nowrap">Court {selectedCourt}</span>
              <span className="text-white/50">{index + 1}/{count}</span>
              <button
                type="button"
                data-no-swipe
                onClick={() => index < count - 1 && onSelectCourt?.(courts[index + 1].id)}
                disabled={index >= count - 1}
                aria-label="Next court"
                className="rounded-full p-0.5 text-white/80 transition hover:text-white disabled:opacity-30"
              >
                <Chevron direction="right" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
