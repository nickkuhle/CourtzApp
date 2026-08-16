// lib/schedule-cache.js
//
// A client-side snapshot of the last successful schedule load, persisted in
// localStorage. Returning to the page paints instantly from this snapshot and
// then refreshes in the background, so the desk never stares at a spinner on a
// repeat visit (the single biggest perceived slowdown on a slow tournament
// wifi). The snapshot is versioned and age-limited so an old or structurally
// changed entry is ignored instead of breaking the app, and every read/write is
// guarded because localStorage can throw in private/incognito sessions.

const KEY = 'courtz.scheduleCache.v1'
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7 // ignore snapshots older than a week

// Returns the cached schedule object, or null when there is nothing usable.
export function loadCachedSchedule() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > MAX_AGE_MS) return null
    if (!parsed.schedule || typeof parsed.schedule !== 'object') return null
    return parsed.schedule
  } catch {
    return null
  }
}

// Best-effort: never let a full or blocked localStorage stop the app.
export function saveCachedSchedule(schedule) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), schedule }))
  } catch {
    /* caching is optional */
  }
}
