import { useEffect, useState } from 'react'

// Advances "now" so on-court overlays and the reserved-session carousel stay
// pointed at the live slot while the desk leaves the page open.
export default function useTickingNow(intervalMs = 30000) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setNowMs(Date.now())
    const id = window.setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])

  return nowMs
}
