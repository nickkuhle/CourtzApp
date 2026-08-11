import React from 'react'

function CourtGraphic({ highlight }) {
  return (
    <svg viewBox="0 0 140 220" className="w-full aspect-[11/7] rounded-md overflow-hidden">
      <defs>
        <linearGradient id={highlight ? "hardCourtActive" : "hardCourt"} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={highlight ? "#4ade80" : "#38a169"} />
          <stop offset="100%" stopColor={highlight ? "#22c55e" : "#2f855a"} />
        </linearGradient>
      </defs>

      <rect x="6" y="6" width="128" height="208" rx="10" fill={`url(#${highlight ? 'hardCourtActive' : 'hardCourt'})`} />

      {/* Doubles court boundary */}
      <rect x="10" y="10" width="120" height="200" rx="8" fill="none" stroke="#fef3c7" strokeWidth="2" />

      {/* Singles court boundaries */}
      <line x1="25" y1="10" x2="25" y2="210" stroke="#fef3c7" strokeWidth="1.6" />
      <line x1="115" y1="10" x2="115" y2="210" stroke="#fef3c7" strokeWidth="1.6" />

      {/* Net */}
      <line x1="10" y1="110" x2="130" y2="110" stroke="#fef3c7" strokeWidth="2" />

      {/* Service lines */}
      <line x1="25" y1="56.15" x2="115" y2="56.15" stroke="#fef3c7" strokeWidth="1.6" />
      <line x1="25" y1="163.85" x2="115" y2="163.85" stroke="#fef3c7" strokeWidth="1.6" />

      {/* Center service line */}
      <line x1="70" y1="56.15" x2="70" y2="163.85" stroke="#fef3c7" strokeWidth="1.6" />

      {/* Baseline center marks */}
      <line x1="70" y1="10" x2="70" y2="16" stroke="#fef3c7" strokeWidth="1.6" />
      <line x1="70" y1="204" x2="70" y2="210" stroke="#fef3c7" strokeWidth="1.6" />
    </svg>
  )
}

function ReservationDots({ count }) {
  const maxDots = 6
  const dots = Math.min(count, maxDots)
  const extra = count > maxDots ? count - maxDots : 0

  if (count === 0) {
    return <span className="text-xs text-slate-300 italic">No bookings</span>
  }

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className="w-2 h-2 rounded-full bg-emerald-400 opacity-80" />
      ))}
      {extra > 0 && <span className="text-xs text-slate-400 ml-0.5">+{extra}</span>}
    </div>
  )
}

export default function CourtGrid({ courts, reservations, onSelect, selectedCourt }) {
  const rows = []
  for (let i = 0; i < courts.length; i += 3) {
    rows.push(courts.slice(i, i + 3))
  }

  return (
    <div className="w-full max-w-6xl mx-auto transition-all duration-700 ease-out">
      <div className="flex flex-col items-center gap-4 transition-all duration-700 ease-out">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex flex-wrap justify-center items-center gap-4 w-full transition-all duration-700 ease-out">
            {row.map((c) => {
              const key = `${c.location}|${c.date}|${c.id}`
              const reserved = reservations[key] || {}
              const count = Object.values(reserved).reduce((acc, v) => acc + (Array.isArray(v) ? v.length : 0), 0)
              const isSelected = selectedCourt === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={`group w-full max-w-[320px] min-h-[260px] rounded-3xl shadow-xl border p-3 text-left focus:outline-none focus:ring-4 focus:ring-emerald-400/40 focus:ring-offset-2 transition-all duration-300 ease-out relative overflow-hidden animate-[fadeIn_0.35s_ease-out] ${
                    isSelected
                      ? 'bg-[#164a7a] border-emerald-400 shadow-emerald-400/20 scale-[1.03] ring-2 ring-emerald-400/50'
                      : 'bg-[#1f5f99] border-blue-300/40 hover:shadow-[0_20px_45px_rgba(15,23,42,0.25)] hover:-translate-y-2 hover:scale-[1.02] hover:border-emerald-400 active:scale-[0.98]'
                  }`}
                >
                  {/* Court number badge */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-slate-950/70 text-white text-sm px-2.5 py-1 rounded-full">
                    <span className="font-semibold">Court {c.number}</span>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>

                  {/* Reservation count */}
                  <div className="absolute top-3 right-3 text-right">
                    <div className="text-xs text-slate-300">Reserved</div>
                    <div className={`text-lg font-bold ${count > 0 ? 'text-emerald-300' : 'text-slate-400'}`}>{count}</div>
                  </div>

                  <div className="pt-8 transition-all duration-300 ease-out group-hover:scale-[1.04] group-hover:rotate-[0.5deg]">
                    <CourtGraphic highlight={isSelected} />
                  </div>

                  {/* Footer */}
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs text-slate-300 truncate pr-2">{c.location}</div>
                    <ReservationDots count={count} />
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
