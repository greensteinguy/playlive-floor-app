// Shared player picker (floor feedback A3/A4), extracted from the deposit page
// so the withdrawal queue (task 4.8) reuses it instead of copy-pasting.
//
// Behaviour per A3/A4: the whole player base shows alphabetically and narrows
// as you type (searchPlayers returns everyone for an empty query); each result
// row is fully clickable — no separate Select button. Owns its own query state,
// so it resets naturally when the parent swaps it out for the selected-player
// view and back.
//
// `action` is an optional node rendered beside the search input (the deposit
// page puts its "+ New player" button there); `emptyHint` extends the empty-state
// copy (e.g. "Add them with + New player.").

import { useState } from 'react'
import { searchPlayers, playerDisplayName } from '../lib/players'
import { formatMoney } from '../lib/money'

const RESULT_LIMIT = 100

export default function PlayerPicker({ players, onSelect, action = null, emptyHint = '' }) {
  const [q, setQ] = useState('')

  // Empty query returns the whole base sorted by name (searchPlayers), so the
  // list shows everyone alphabetically and narrows as the cashier types (A3).
  const results = searchPlayers(players, q, { limit: RESULT_LIMIT })

  const withHint = (msg) => (emptyHint ? `${msg} ${emptyHint}` : msg)

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, phone, or email…"
          autoFocus
          aria-label="Search players"
          className="flex-1 min-w-[14rem] bg-felt-900 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:text-white/45"
        />
        {action}
      </div>
      {players.length === 0 ? (
        <p className="text-xs text-white/55 mt-3">{withHint('No players yet.')}</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-white/55 mt-3">{withHint(`No players match "${q}".`)}</p>
      ) : (
        <>
          <div className="text-[11px] font-mono uppercase tracking-widest text-white/45 mt-3 mb-1">
            {results.length}
            {results.length === RESULT_LIMIT ? '+' : ''} {results.length === 1 ? 'player' : 'players'}
            {q.trim() === '' ? ' · alphabetical' : ''}
          </div>
          {/* Whole base, alphabetical, filtering as you type (A3); each
              row is fully clickable — no separate Select button (A4). */}
          <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto rounded-lg border border-white/5">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  className="w-full flex items-center justify-between gap-3 text-left px-3 py-2.5 hover:bg-white/5 active:bg-white/10"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-white/90 truncate">{playerDisplayName(p)}</span>
                    <span className="block text-xs text-white/55 truncate">
                      {p.phone}
                      {p.email ? ` · ${p.email}` : ''} · Wallet {formatMoney(p.walletBalance)}
                    </span>
                  </span>
                  <span aria-hidden className="text-xs text-white/45 shrink-0">
                    Select →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
