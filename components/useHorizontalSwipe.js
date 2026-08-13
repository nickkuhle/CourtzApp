import { useCallback, useEffect, useRef, useState } from 'react'

// Swallow the click that follows a completed swipe so a court button or day
// pill is not activated after the user meant to flip the pager.
function suppressNextClick() {
  const stop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    document.removeEventListener('click', stop, true)
  }
  document.addEventListener('click', stop, true)
  window.setTimeout(() => document.removeEventListener('click', stop, true), 450)
}

// Shared pointer swipe used by the day pills, the court grid, and the court
// card carousel. Vertical movement is left to the browser so the page and the
// schedule list still scroll; only a clearly horizontal gesture flips pages.
export default function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
  canSwipeLeft = true,
  canSwipeRight = true,
  threshold = 52,
  ignoreSelector = '',
  enabled = true,
} = {}) {
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const session = useRef(null)
  const dragXRef = useRef(0)
  const options = useRef({ onSwipeLeft, onSwipeRight, canSwipeLeft, canSwipeRight, threshold, ignoreSelector, enabled })
  options.current = { onSwipeLeft, onSwipeRight, canSwipeLeft, canSwipeRight, threshold, ignoreSelector, enabled }

  const finish = useCallback((commit) => {
    const current = session.current
    session.current = null
    const dx = dragXRef.current
    dragXRef.current = 0
    setDragX(0)
    setDragging(false)
    if (!current || !commit || current.axis !== 'x') return
    const { threshold: distance, onSwipeLeft: left, onSwipeRight: right, canSwipeLeft: canLeft, canSwipeRight: canRight } = options.current
    if (dx <= -distance && canLeft) {
      left?.()
      suppressNextClick()
    } else if (dx >= distance && canRight) {
      right?.()
      suppressNextClick()
    }
  }, [])

  const bind = {
    onPointerDown(event) {
      const opts = options.current
      if (!opts.enabled || event.button !== 0) return
      const target = event.target
      if (typeof target.closest === 'function') {
        if (opts.ignoreSelector && target.closest(opts.ignoreSelector)) return
        if (target.closest('input, textarea, select, option, [data-no-swipe]')) return
      }
      session.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: null,
        target: event.currentTarget,
      }
    },
    onPointerMove(event) {
      const current = session.current
      if (!current || event.pointerId !== current.pointerId) return
      const dx = event.clientX - current.startX
      const dy = event.clientY - current.startY
      if (!current.axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        current.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y'
        if (current.axis === 'x') setDragging(true)
      }
      if (current.axis !== 'x') return
      // Wait until the gesture is clearly a swipe before capturing the
      // pointer so an ordinary tap on a court or day pill still clicks.
      if (!current.captured && Math.abs(dx) > 24) {
        current.captured = true
        try { current.target.setPointerCapture?.(event.pointerId) } catch {}
      }
      if (current.captured && event.cancelable) event.preventDefault()
      const opts = options.current
      let next = dx
      if (dx > 0 && !opts.canSwipeRight) next = dx * 0.28
      if (dx < 0 && !opts.canSwipeLeft) next = dx * 0.28
      dragXRef.current = next
      setDragX(next)
    },
    onPointerUp(event) {
      const current = session.current
      if (!current || event.pointerId !== current.pointerId) return
      try { current.target.releasePointerCapture?.(event.pointerId) } catch {}
      finish(true)
    },
    onPointerCancel(event) {
      const current = session.current
      if (!current || event.pointerId !== current.pointerId) return
      finish(false)
    },
  }

  useEffect(() => () => {
    session.current = null
    dragXRef.current = 0
  }, [])

  return { dragX, dragging, bind }
}
