// Manager-only template authoring hub. Two tabs share one route (/td/templates):
//   - Blind structures   → reusable level/break sequences
//   - Tournament configs  → reusable tournament setups that seed the create wizard
//
// Each tab toggles its own list ↔ editor in-page (no nested routes), matching
// the Dedupe page pattern.

import { useState } from 'react'
import StructureTemplatesPanel from './templates/StructureTemplatesPanel'
import TournamentTemplatesPanel from './templates/TournamentTemplatesPanel'

const TABS = [
  { id: 'structures', label: 'Blind structures' },
  { id: 'tournaments', label: 'Tournament configs' },
]

export default function Templates() {
  const [tab, setTab] = useState('structures')

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-7xl">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">Templates</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 2 — task 2.5
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        Reusable building blocks for tournament setup. Manager-only.
      </p>

      <div className="flex items-center gap-1 mb-6 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              'px-4 py-2 text-sm font-medium -mb-px border-b-2 ' +
              (tab === t.id
                ? 'border-gold-400 text-gold-300'
                : 'border-transparent text-white/50 hover:text-white/80')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'structures' ? <StructureTemplatesPanel /> : <TournamentTemplatesPanel />}
    </div>
  )
}
