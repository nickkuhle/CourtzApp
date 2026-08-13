import React, { useRef } from 'react'
import useHorizontalSwipe from './useHorizontalSwipe'

// Wraps a day's court grid so changing days slides the new grid in, and a
// horizontal swipe on the grid flips to the previous or next date.
export default function DaySlide({
  dayKey,
  onSwipeLeft,
  onSwipeRight,
  canSwipeLeft = false,
  canSwipeRight = false,
  children,
  className = '',
}) {
  const { bind } = useHorizontalSwipe({
    onSwipeLeft,
    onSwipeRight,
    canSwipeLeft,
    canSwipeRight,
    enabled: Boolean(dayKey) && (canSwipeLeft || canSwipeRight),
  })

  const prevKeyRef = useRef(dayKey)
  const dirRef = useRef(1)
  if (prevKeyRef.current && dayKey && prevKeyRef.current !== dayKey) {
    dirRef.current = dayKey > prevKeyRef.current ? 1 : -1
    prevKeyRef.current = dayKey
  } else if (dayKey) {
    prevKeyRef.current = dayKey
  }

  return (
    <div className={`overflow-hidden touch-pan-y ${className}`} {...bind}>
      <div
        key={dayKey || 'empty'}
        className={dirRef.current >= 0 ? 'day-slide-next' : 'day-slide-prev'}
      >
        {children}
      </div>
    </div>
  )
}
