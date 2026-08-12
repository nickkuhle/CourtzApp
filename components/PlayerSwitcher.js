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
    const q = query.trim().toLowerCase()
    return roster.filter((name) => !q || searchableName(name).includes(q)).slice(0, 30)
  }, [query, roster])

  const totalMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return roster.filter((name) => !q || searchableName(name).includes(q)).length
  }, [query, roster])

  function choose(name) {
    if (!name) return
    onSelect?.(name)
    setQuery(formatPlayerName(name))
    setOpen(false)
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
            blurTimer.current = setTimeout(() => setOpen(false), 150)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && filtered.length) {
              event.preventDefault()
              choose(filtered[0])
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
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
    </div>
  )
}
