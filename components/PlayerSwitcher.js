import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatPlayerName, matchRosterQuery, normalizeNameKey } from '../lib/player-names'

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

// Shared identity picker used wherever the desk changes the player for whom it
// is acting: the navbar, Find a Court, the court schedule and the reservation
// search. The value passed to onSelect is always the untouched, canonical
// roster name; only the text shown to people is reformatted.
export default function PlayerSwitcher({
  currentPlayer,
  roster = [],
  onSelect,
  label = 'Booking Courts As',
  appearance = 'navbar',
  className = '',
  inputClassName = '',
  dropdownAlign = 'right',
}) {
  const styles = APPEARANCE[appearance] || APPEARANCE.navbar
  const [query, setQuery] = useState(() => formatPlayerName(currentPlayer))
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)
  const listId = useId()

  useEffect(() => {
    if (!open) setQuery(formatPlayerName(currentPlayer))
  }, [currentPlayer, open])

  useEffect(() => () => clearTimeout(blurTimer.current), [])

  const filtered = useMemo(() => {
    const q = normalizeNameKey(query)
    if (!q) return roster
    return matchRosterQuery(roster, query)
  }, [query, roster])

  const visible = useMemo(() => filtered.slice(0, 30), [filtered])

  function choose(name) {
    if (!name) return
    clearTimeout(blurTimer.current)
    // Always hand back the canonical Sheet value, never the typed text.
    onSelect?.(name)
    setQuery(formatPlayerName(name))
    setOpen(false)
  }

  // Typed text is only ever committed through a roster entry, so the selected
  // player always resolves back to a real canonical Sheet value.
  function commitQuery() {
    if (filtered.length) {
      choose(filtered[0])
      return true
    }
    setQuery(formatPlayerName(currentPlayer))
    setOpen(false)
    return false
  }

  function openAndSelect(event) {
    clearTimeout(blurTimer.current)
    setQuery(formatPlayerName(currentPlayer))
    setOpen(true)
    event.currentTarget.select()
  }

  return (
    <div className={`relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 ${styles.root} ${className}`}>
      <span className={`whitespace-nowrap text-[11px] font-semibold ${styles.label}`}>{label}</span>
      <div className="relative min-w-0">
        <input
          type="text"
          role="combobox"
          aria-label={`${label} player search`}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={open ? query : formatPlayerName(currentPlayer)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={openAndSelect}
          onClick={(event) => event.currentTarget.select()}
          onBlur={() => {
            // Leaving the field without picking anything reverts to the current
            // player rather than leaving an uncommitted name behind.
            blurTimer.current = setTimeout(() => {
              setOpen(false)
              setQuery(formatPlayerName(currentPlayer))
            }, 150)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitQuery()
            }
            if (event.key === 'Escape') {
              // Escape closes only the dropdown — never the surrounding modal.
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              setQuery(formatPlayerName(currentPlayer))
            }
          }}
          placeholder="Search player…"
          className={`w-32 rounded-full border px-2.5 py-1 text-xs focus:outline-none sm:w-40 ${styles.input} ${inputClassName}`}
        />
        {open && (
          <div
            id={listId}
            role="listbox"
            className={`absolute top-full z-[80] mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-2xl ${dropdownAlign === 'left' ? 'left-0' : 'right-0'}`}
          >
            <div className="max-h-64 overflow-auto py-1">
              {visible.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={name === currentPlayer}
                  // onMouseDown fires before the input's blur on desktop and
                  // onPointerDown covers touch, so a tap always registers.
                  onPointerDown={(event) => {
                    event.preventDefault()
                    choose(name)
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(name)}
                  className={`w-full px-3 py-2 text-left text-sm transition hover:bg-emerald-50 ${name === currentPlayer ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-700'}`}
                >
                  {formatPlayerName(name)}
                </button>
              ))}
              {visible.length === 0 && (
                <div className="px-4 py-3 text-sm text-slate-400">No players found</div>
              )}
            </div>
            <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400">
              {filtered.length} of {roster.length} players
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
