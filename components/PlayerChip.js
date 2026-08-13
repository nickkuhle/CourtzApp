import React from 'react'
import { formatPlayerName, playerInitials, playerStyle } from '../lib/player-names'

export default function PlayerChip({ name, compact = false, highlight = false, className = '' }) {
  const style = playerStyle(name)
  return (
    <span
      className={`inline-flex min-w-0 items-center rounded-full border font-semibold ${style.chip} ${compact ? 'gap-1 px-1.5 py-0.5 text-[10px]' : 'gap-1.5 px-2 py-1 text-xs'} ${highlight ? 'ring-2 ring-emerald-400 ring-offset-1' : ''} ${className}`}
      title={formatPlayerName(name)}
    >
      <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${style.avatar} ${compact ? 'h-4 w-4 text-[8px]' : 'h-5 w-5 text-[9px]'}`}>
        {playerInitials(name)}
      </span>
      <span className="truncate">{formatPlayerName(name)}</span>
    </span>
  )
}
