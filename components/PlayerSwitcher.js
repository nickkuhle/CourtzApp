import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatPlayerName } from '../lib/schedule-display'

const APPEARANCE = {
  navbar: {
    root: 'border-emerald-400/70 bg-emerald-500 shadow-sm shadow-emerald-500/20',
    label: 'text-white',
    input: 'border-emerald-200 bg-white text-slate-800 focus:border-emerald-600',
  },
  header: {
    root: 'border-white/20 bg-white/10',
    label: 'text-white',
    input: 'border-white/30 bg-white text-slate-800 focus:border-emerald-400',
  },
  light: {
    root: 'border-slate-200 bg-slate-50',
    label: 'text-slate-600',
    input: 'border-slate-200 bg-white text-slate-800 focus:border-emerald-500',
  },
}

function searchableName(name) {
  return `${name} ${formatPlayerName(name)}`.toLowerCase()
}

// Shared identity picker used wherever the desk changes the player for whom it
// is acting. The selected value passed to onSelect is always the untouched,
// canonical roster name; only the text shown to people is reformatted.
// Now supports blank initial state — field is blank until typing and selecting.
// Memoized so an unrelated parent re-render (e.g. typing in Find-a-Court) does
// not rebuild the roster dropdown here.
const PlayerSwitcher = React.memo(function PlayerSwitcher({
  currentPlayer,
  roster = [],
  onSelect,
  label = 'Booking Courts As',
  appearance = 'navbar',
  className = '',
  inputClassName = '',
  dropdownAlign = 'right',
  sessionsLabel = null,
  onOpenReservations = null,
}) {
  const styles = APPEARANCE[appearance] || APPEARANCE.navbar
  const [query, setQuery] = useState(() => formatPlayerName(currentPlayer || ''))
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)
  const listId = useId()

  useEffect(() => {
    if (!open) setQuery(formatPlayerName(currentPlayer || ''))
  }, [currentPlayer, open])

  useEffect(() => () => clearTimeout(blurTimer.current), [])

  // One pass over the roster serves both the dropdown (first 30 hits) and the
  // \"n of N players\" footer count.
  const { filtered, totalMatches } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q ? roster.filter((name) => searchableName(name).includes(q)) : roster
    return { filtered: matches.slice(0, 30), totalMatches: matches.length }
  }, [query, roster])

  function choose(name) {
    if (name === '') {
      onSelect?.('')
      setQuery('')
      setOpen(false)
      return
    }
    if (!name) return
    onSelect?.(name)
    setQuery(formatPlayerName(name))
    setOpen(false)
  }

  function clearSelection() {
    onSelect?.('')
    setQuery('')
    setOpen(false)
  }

  function openAndSelect(event) {
    clearTimeout(blurTimer.current)
    setQuery(formatPlayerName(currentPlayer || ''))
    setOpen(true)
    event.currentTarget.select()
  }

  return (
    <div className={`relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 ${styles.root} ${className}`}>
      <span className={`whitespace-nowrap text-[11px] font-semibold ${styles.label}`}>{label}</span>
      <div className="relative min-w-0 flex items-center gap-1">
        <input
          type="text"
          role="combobox"
          aria-label={`${label} player search`}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={open ? query : formatPlayerName(currentPlayer || '')}
          onChange={(event) => {
            const val = event.target.value
            setQuery(val)
            setOpen(true)
            if (val.trim() === '') {
              // Clearing the input clears the selection, making field blank
              onSelect?.('')
            }
          }}
          onFocus={openAndSelect}
          onClick={(event) => event.currentTarget.select()}
          onBlur={() => {
            blurTimer.current = setTimeout(() => {
              // If left blank, keep it blank; otherwise restore formatted name
              if (query.trim() === '' && !currentPlayer) {
                setQuery('')
              }
              setOpen(false)
            }, 150)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query.trim() !== '' && filtered.length) {
              event.preventDefault()
              choose(filtered[0])
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
            }
            if (event.key === 'Backspace' && query === '' && currentPlayer) {
              // Allow quick clear of selected player
              event.preventDefault()
              clearSelection()
            }
          }}
          placeholder="Search player…"
          className={`w-28 rounded-full border px-2.5 py-1 text-xs focus:outline-none sm:w-36 ${styles.input} ${inputClassName}`}
        />
        {currentPlayer ? (
          <button
            type="button"
            onClick={clearSelection}
            title="Clear selected player"
            aria-label="Clear selected player"
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition ${
              appearance === 'light'
                ? 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                : 'border-white/30 bg-white/15 text-white hover:bg-white/25'
            }`}
          >
            ×
          </button>
        ) : null}
        {open && (
          <div
            id={listId}
            role="listbox"
            className={`absolute top-full z-[80] mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-2xl ${dropdownAlign === 'left' ? 'left-0' : 'right-0'}`}
          >
            <div className="max-h-64 overflow-auto py-1">
              {filtered.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={name === currentPlayer}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(name)
                  }}
                  onClick={() => choose(name)}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-emerald-50 ${name === currentPlayer ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-700'}`}
                >
                  {formatPlayerName(name)}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-3 text-sm text-slate-400">No players found</div>
              )}
            </div>
            <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400">
              {totalMatches} of {roster.length} players
            </div>
          </div>
        )}
      </div>
      {sessionsLabel ? (
        <span
          className={`whitespace-nowrap border-l pl-2 text-[11px] font-semibold ${appearance === 'light' ? 'border-slate-200 text-slate-600' : 'border-white/25 text-white/90'}`}
          title="Practice sessions used by this player on the selected day (max 2)"
        >
          {sessionsLabel}
        </span>
      ) : null}
      {typeof onOpenReservations === 'function' ? (
        <button
          type="button"
          onClick={onOpenReservations}
          title="Search past, current and upcoming player reservations"
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
            appearance === 'light'
              ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              : 'border-white/25 bg-white/15 text-white hover:bg-white/25'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Reservations
        </button>
      ) : null}
    </div>
  )
})

export default PlayerSwitcher
