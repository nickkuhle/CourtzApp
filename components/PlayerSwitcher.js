import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatPlayerName, normalizeNameKey, resolveCanonicalName } from '../lib/schedule-display'

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

// A roster entry matches when the query appears in EITHER the canonical
// "Last, First" Sheet value or the displayed "First Last" form. Both forms are
// normalized first so stray punctuation, casing and double spaces never hide a
// player who really is on the roster.
function searchIndexFor(name) {
  return `${normalizeNameKey(name)} \u0001 ${normalizeNameKey(formatPlayerName(name))}`
}

// Shared identity picker used wherever the desk changes the player it is acting
// for: the navbar, Find a Court, the court-schedule modal and the reservation
// search. The value handed to onSelect is ALWAYS the untouched canonical roster
// name; only the text shown to people is reformatted.
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

  const searchable = useMemo(
    () => roster.map((name) => ({ name, index: searchIndexFor(name) })),
    [roster]
  )

  const matches = useMemo(() => {
    const q = normalizeNameKey(query)
    if (!q) return roster
    return searchable.filter((entry) => entry.index.includes(q)).map((entry) => entry.name)
  }, [query, roster, searchable])

  const filtered = useMemo(() => matches.slice(0, 30), [matches])

  const choose = useCallback(
    (name) => {
      if (!name) return
      // Always emit the canonical roster value, never the typed text.
      onSelect?.(name)
      setQuery(formatPlayerName(name))
      setOpen(false)
    },
    [onSelect]
  )

  // Typed text is only a search term until it is committed. Committing accepts
  // the first visible match, or — when the field was typed in full and then
  // blurred — an exact canonical/display-form hit anywhere in the roster.
  const commitTypedText = useCallback(() => {
    const exact = resolveCanonicalName(query, roster)
    if (exact) {
      choose(exact)
      return true
    }
    if (matches.length) {
      choose(matches[0])
      return true
    }
    // Nothing resolved: fall back to the current player so the field never
    // shows a name that is not actually selected.
    setQuery(formatPlayerName(currentPlayer))
    setOpen(false)
    return false
  }, [query, roster, matches, choose, currentPlayer])

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
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={open ? query : formatPlayerName(currentPlayer)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={(event) => {
            clearTimeout(blurTimer.current)
            setQuery(formatPlayerName(currentPlayer))
            setOpen(true)
            event.currentTarget.select()
          }}
          onClick={(event) => event.currentTarget.select()}
          onBlur={() => {
            // Delayed so a click/tap on a result still lands first (the result
            // buttons also commit on mousedown/touchstart for mobile Safari).
            blurTimer.current = setTimeout(() => {
              if (open) commitTypedText()
            }, 180)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitTypedText()
            }
            if (event.key === 'Escape') {
              // Escape closes only the dropdown; it must never bubble up and
              // close the surrounding modal.
              event.preventDefault()
              event.stopPropagation()
              setQuery(formatPlayerName(currentPlayer))
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
                  onTouchStart={() => {
                    clearTimeout(blurTimer.current)
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    choose(name)
                  }}
                  className={`w-full px-3 py-2.5 text-left text-sm transition hover:bg-emerald-50 ${name === currentPlayer ? 'bg-emerald-100 font-semibold text-emerald-800' : 'text-slate-700'}`}
                >
                  {formatPlayerName(name)}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-3 text-sm text-slate-400">No players found</div>
              )}
            </div>
            <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400">
              {matches.length} of {roster.length} players
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
