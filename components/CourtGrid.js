import React from 'react'

function CourtGraphic() {
  return (
    <svg viewBox="0 0 140 220" className="w-full aspect-[11/7] rounded-md overflow-hidden">
      <defs>
        <linearGradient id="hardCourt" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#38a169" />
          <stop offset="100%" stopColor="#2f855a" />
        </linearGradient>
      </defs>

      <rect x="6" y="6" width="128" height="208" rx="10" fill="url(#hardCourt)" />

      {/* Doubles court boundary */}
      <rect x="10" y="10" width="120" height="200" rx="8" fill="none" stroke="#fef3c7" strokeWidth="2" />

      {/* Singles court boundaries (4.5 ft inside doubles) */}
      <line x1="25" y1="10" x2="25" y2="210" stroke="#fef3c7" strokeWidth="1.6" />
      <line x1="115" y1="10" x2="115" y2="210" stroke="#fef3c7" strokeWidth="1.6" />

      {/* Net */}
      <line x1="10" y1="110" x2="130" y2="110" stroke="#fef3c7" strokeWidth="2" />

      {/* Service lines (21 ft from net) */}
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

export default function CourtGrid({ courts, reservations, onSelect }) {
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
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className="group w-full max-w-[320px] min-h-[260px] bg-[#1f5f99] rounded-3xl shadow-xl border border-blue-300/40 p-3 text-left hover:shadow-[0_20px_45px_rgba(15,23,42,0.25)] hover:-translate-y-2 hover:scale-[1.02] hover:border-emerald-400 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-emerald-400/40 focus:ring-offset-2 transition-all duration-500 ease-out relative overflow-hidden animate-[fadeIn_0.35s_ease-out]"
                >
                  <div className="absolute top-3 left-3 bg-slate-950/70 text-white text-sm px-2 py-1 rounded">Court {c.number}</div>
                  <div className="absolute top-3 right-3 text-right">
                    <div className="text-xs text-slate-200">Reserved</div>
                    <div className="text-lg font-bold text-emerald-300">{count}</div>
                  </div>

                  <div className="pt-6 transition-all duration-500 ease-out group-hover:scale-[1.04] group-hover:rotate-[0.5deg]">
                    <CourtGraphic />
                  </div>

                  <div className="mt-3 text-sm text-gray-500">{c.location}</div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
