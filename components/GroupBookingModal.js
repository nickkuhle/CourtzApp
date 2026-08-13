import React, { useEffect, useMemo, useState } from 'react'
import PlayerChip from './PlayerChip'
import { formatPlayerName } from '../lib/schedule-display'

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

function ShieldAlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

// Shared "who is booking?" dialog used by both the court schedule and Find a
// Court. Now includes proper staff-code prompt: when a booking is within 1 hour
// of the SAME player's own session, it requires staff approval; if a staff code
// is configured, the prompt asks for that code to bypass.
export default function GroupBookingModal({
  title = 'Book a court',
  subtitle = '',
  slots = [],
  initialPlayers = [],
  roster = [],
  mode = 'book', // 'book' | 'cancel'
  confirmLabel,
  evaluate = null,
  requiresStaffCode = false,
  onConfirm,
  onClose,
  busy = false,
}) {
  const [players, setPlayers] = useState(() => [...new Set(initialPlayers.map(n => String(n).trim()).filter(Boolean))])
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [staffStep, setStaffStep] = useState(false)
  const [staffCodeRequired, setStaffCodeRequired] = useState(Boolean(requiresStaffCode))
  const [staffCode, setStaffCode] = useState('')

  useEffect(() => {
    setStaffCodeRequired(Boolean(requiresStaffCode))
  }, [requiresStaffCode])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const selected = new Set(players)
    return roster
      .filter(n => !selected.has(n))
      .filter(n => !q || `${n} ${formatPlayerName(n)}`.toLowerCase().includes(q))
      .slice(0, 30)
  }, [roster, players, search])

  const evaluation = useMemo(() => {
    if (mode !== 'book' || !evaluate) return { ok: true, warning: null, error: null }
    return evaluate(players)
  }, [mode, evaluate, players])

  function addPlayer(name) {
    setPlayers(prev => (prev.includes(name) ? prev : [...prev, name]))
    setSearch('')
    setShowDropdown(false)
    setError(null)
  }

  function removePlayer(name) {
    if (mode === 'cancel') return
    setPlayers(prev => prev.filter(n => n !== name))
    setError(null)
  }

  async function handleConfirm() {
    if (mode === 'book') {
      if (players.length === 0) {
        setError('Add at least one player before confirming.')
        return
      }
      if (!evaluation.ok) {
        setError(evaluation.error || 'This booking is not allowed.')
        return
      }
      if (evaluation.warning) {
        setStaffStep(true)
        return
      }
    } else if (players.length === 0) {
      setError('There are no players to cancel.')
      return
    }
    await runConfirm(false)
  }

  async function runConfirm(staffApproved) {
    setSaving(true)
    setError(null)
    try {
      await onConfirm(players, { staffApproved, staffCode: staffApproved ? staffCode : null })
    } catch (e) {
      const code = e?.code
      const needsCode = e?.staffCodeRequired || code === 'STAFF_APPROVAL_CODE_REQUIRED' || code === 'STAFF_APPROVAL_CODE_INVALID' || code === 'STAFF_APPROVAL_REQUIRED'
      if (needsCode) {
        // Ensure we stay on staff approval step and prompt for code if required by server
        if (e?.staffCodeRequired) setStaffCodeRequired(true)
        // If server said STAFF_APPROVAL_REQUIRED but we weren't in staff step, move to it
        if (code === 'STAFF_APPROVAL_REQUIRED') {
          // Keep existing staffCodeRequired value (may be true if env configured)
          setStaffStep(true)
        }
        if (code === 'STAFF_APPROVAL_CODE_REQUIRED' || code === 'STAFF_APPROVAL_CODE_INVALID') {
          setStaffCodeRequired(true)
          setStaffStep(true)
        }
      }
      // If error is about staff approval, ensure we are in staff step to show code prompt
      if (code === 'STAFF_APPROVAL_REQUIRED' || code === 'STAFF_APPROVAL_CODE_REQUIRED' || code === 'STAFF_APPROVAL_CODE_INVALID' || e?.staffCodeRequired) {
        setStaffStep(true)
        if (e?.staffCodeRequired) setStaffCodeRequired(true)
      }
      setError(e?.message || 'The booking could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const label = confirmLabel || (mode === 'cancel' ? 'Cancel group booking' : `Book for ${players.length} player${players.length === 1 ? '' : 's'}`)

  return (
    <div data-booking-modal className="fixed inset-0 z-[60] flex items-start md:items-center justify-center overflow-auto">
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

        {staffStep && mode === 'book' ? (
          <div className="p-5 space-y-4 max-h-[65vh] overflow-auto">
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-4">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-500 mt-0.5 shrink-0">
                  <ShieldAlertIcon />
                </span>
                <div>
                  <div className="text-sm font-bold text-amber-900">Tournament staff approval required</div>
                  <p className="mt-1 text-sm text-amber-800 leading-relaxed">
                    {evaluation.warning || 'This booking is within one hour of another session for the same player.'} Back-to-back or bookings within one hour for the <span className="font-bold">same player only</span> need staff approval. If Player A has a session ending at 12:00 and tries to book 12:30, it needs approval. If a different player has a session at that time, it does NOT trigger this warning.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Booking <span className="font-semibold text-slate-800">{slots.join(' and ')}</span> on{' '}
              <span className="font-semibold text-slate-800">{subtitle}</span> for{' '}
              <span className="font-semibold text-slate-800">{players.map(formatPlayerName).join(', ')}</span>.
            </div>

            {/* Staff code prompt — always visible when approval needed, required indicator when server says code needed */}
            <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
              <label htmlFor="staff-approval-code" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                Staff approval code {staffCodeRequired ? <span className="text-rose-600 normal-case">(required)</span> : <span className="text-slate-400 normal-case">(optional unless configured)</span>}
              </label>
              <input
                id="staff-approval-code"
                type="password"
                autoComplete="off"
                autoFocus
                value={staffCode}
                onChange={(event) => { setStaffCode(event.target.value); setError(null) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !saving && !busy) {
                    event.preventDefault()
                    // Allow confirm with empty code only if not required
                    if (!staffCodeRequired || staffCode.trim()) runConfirm(true)
                  }
                }}
                placeholder={staffCodeRequired ? "Enter the tournament staff code to bypass" : "Enter staff code if configured, or leave blank to confirm approval"}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                {staffCodeRequired
                  ? 'A staff approval code is configured for this tournament. Ask tournament staff for the code, then verify to continue.'
                  : 'If no staff code is configured, you can confirm staff approval without a code. If a code IS configured, you must enter it here.'}
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setStaffStep(false)}
                disabled={busy || saving}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => runConfirm(true)}
                disabled={busy || saving || (staffCodeRequired && !staffCode.trim())}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm shadow-amber-600/20 transition disabled:opacity-60"
              >
                {saving ? 'Saving…' : staffCodeRequired ? 'Verify code and confirm' : 'Confirm — staff approved'}
              </button>
            </div>
          </div>
        ) : (
          <>
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
                      <span key={name} className="inline-flex items-center gap-1 rounded-full">
                        <PlayerChip name={name} />
                        {mode !== 'cancel' && !staffStep && (
                          <button
                            type="button"
                            onClick={() => removePlayer(name)}
                            className="-ml-3 rounded-full border border-white bg-slate-200 p-1 text-slate-600 shadow-sm hover:bg-rose-100 hover:text-rose-700"
                            aria-label={`Remove ${formatPlayerName(name)}`}
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
                              {formatPlayerName(name)}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {players.length} of {roster.length} players selected — each slot holds up to 4 players.
                  </p>
                </div>
              )}

              {mode === 'book' && evaluation.error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
                  {evaluation.error}
                </div>
              )}
              {mode === 'book' && !evaluation.error && evaluation.warning && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800" role="alert">
                  <span className="font-semibold">Staff approval needed (same player only):</span> {evaluation.warning} You will be asked to confirm tournament staff approval and enter a staff code if required.
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
                disabled={busy || saving || (mode === 'book' && !evaluation.ok)}
                title={mode === 'book' && !evaluation.ok ? (evaluation.error || 'This booking is not allowed.') : ''}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${
                  mode === 'cancel' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                }`}
              >
                {saving ? 'Saving…' : label}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
