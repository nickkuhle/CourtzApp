import React, { useMemo, useState } from 'react'

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

// Shared "who is booking?" dialog used by both the court schedule and Find a
// Court. It always starts with the signed-in player, lets the desk search the
// roster and add more players, then shows every selected player before the
// booking is confirmed. The parent performs the atomic write (bookGroup or
// cancelGroup) so the whole group succeeds or fails together.
export default function GroupBookingModal({
  title = 'Book a court',
  subtitle = '',
  slots = [],
  initialPlayers = [],
  roster = [],
  mode = 'book', // 'book' | 'cancel'
  confirmLabel,
  onConfirm,
  onClose,
  busy = false,
}) {
  const [players, setPlayers] = useState(() => [...new Set(initialPlayers.map(n => String(n).trim()).filter(Boolean))])
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const selected = new Set(players)
    return roster
      .filter(n => !selected.has(n))
      .filter(n => !q || n.toLowerCase().includes(q))
      .slice(0, 30)
  }, [roster, players, search])

  function addPlayer(name) {
    setPlayers(prev => (prev.includes(name) ? prev : [...prev, name]))
    setSearch('')
    setShowDropdown(false)
    setError(null)
  }

  function removePlayer(name) {
    if (mode === 'cancel') return // the whole group is canceled together
    setPlayers(prev => prev.filter(n => n !== name))
    setError(null)
  }

  async function handleConfirm() {
    if (players.length === 0) {
      setError(mode === 'cancel' ? 'There are no players to cancel.' : 'Add at least one player before confirming.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onConfirm(players)
      // Parent closes the modal on success; keep it open on failure so the desk
      // can retry or adjust the group.
    } catch (e) {
      setError(e?.message || 'The booking could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const label = confirmLabel || (mode === 'cancel' ? 'Cancel group booking' : `Book for ${players.length} player${players.length === 1 ? '' : 's'}`)

  return (
    <div className="fixed inset-0 z-[60] flex items-start md:items-center justify-center overflow-auto">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 my-8 overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-5 ${mode === 'cancel' ? 'bg-gradient-to-br from-rose-600 to-rose-800' : 'bg-gradient-to-br from-[#1f5f99] to-[#164a7a]'}`}>
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-white">{title}</h2>
              {subtitle && <p className="text-sm text-white/80 mt-1">{subtitle}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {slots.map(slot => (
                  <span key={slot} className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white">
                    {slot}
                  </span>
                ))}
              </div>
            </div>
            <button onClick={busy ? undefined : onClose} className="rounded-lg bg-white/10 hover:bg-white/20 p-2 text-white" aria-label="Close">
              <XIcon />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-auto">
          {/* Selected players */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {mode === 'cancel' ? 'Players being removed' : 'Players on this booking'}
            </div>
            {players.length === 0 ? (
              <p className="text-sm text-slate-400">No players selected yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {players.map(name => (
                  <span
                    key={name}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
                      mode === 'cancel' ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    <UserIcon />
                    {name}
                    {mode !== 'cancel' && (
                      <button
                        type="button"
                        onClick={() => removePlayer(name)}
                        className="rounded-full hover:bg-emerald-200/70 p-0.5 -mr-0.5"
                        aria-label={`Remove ${name}`}
                      >
                        <XIcon />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Roster search (book mode only) */}
          {mode === 'book' && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Add another player</div>
              <div className="relative">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <SearchIcon />
                  </span>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setShowDropdown(true) }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && filtered.length) { addPlayer(filtered[0]); e.preventDefault() }
                      if (e.key === 'Escape') setShowDropdown(false)
                    }}
                    placeholder="Search the roster…"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-sm text-slate-800 focus:border-emerald-400 focus:bg-white focus:outline-none"
                  />
                </div>
                {showDropdown && (
                  <div className="absolute top-full mt-1.5 w-full max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl z-10">
                    {filtered.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-400">No players found</div>
                    ) : (
                      filtered.map(name => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={() => addPlayer(name)}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 transition"
                        >
                          {name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                {players.length} of {roster.length} players selected
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4 bg-slate-50/60">
          <button
            type="button"
            onClick={onClose}
            disabled={busy || saving}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || saving}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${
              mode === 'cancel' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
            }`}
          >
            {saving ? 'Saving…' : label}
          </button>
        </div>
      </div>
    </div>
  )
}
