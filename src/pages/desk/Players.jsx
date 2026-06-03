// Player search (task 3.2). Replaces the placeholder. The registration desk's
// entry point: search the players collection by name / phone / email and open a
// player to view their profile + wallet, or register them into a tournament.
//
// Read-only for the read-only role; manager + cashier additionally get the
// "+ New player" quick-create entry point. Data comes from usePlayers (one-shot
// fetch + reload); filtering/ranking is client-side via lib/players/search.js.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { usePlayers } from '../../hooks/usePlayers'
import { searchPlayers, playerDisplayName } from '../../lib/players'
import { formatMoney } from '../../lib/money'
import { downloadCsv, csvFilename } from '../../lib/csv'

const RESULT_LIMIT = 100

const CSV_COLUMNS = [
  { key: 'id', label: 'Player ID' },
  { key: 'name', label: 'Name' },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'walletBalance', label: 'Wallet balance' },
  { key: 'ticketBalance', label: 'Ticket balance' },
  { key: 'totalDeposited', label: 'Total deposited' },
  { key: 'createdAt', label: 'Created at' },
]

export default function Players() {
  const { role } = useAuth()
  const toast = useToast()
  const { players, loading, error, mockMode } = usePlayers()
  const [q, setQ] = useState('')

  const canCreate = role === 'manager' || role === 'cashier'

  const results = useMemo(() => searchPlayers(players, q, { limit: RESULT_LIMIT }), [players, q])

  function handleExport() {
    if (results.length === 0) {
      toast.info('Nothing to export — no players in this view.')
      return
    }
    const rows = results.map((p) => ({
      id: p.id,
      name: playerDisplayName(p),
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email ?? '',
      walletBalance: formatMoney(p.walletBalance),
      ticketBalance: formatMoney(p.ticketBalance),
      totalDeposited: formatMoney(p.totalDeposited),
      createdAt: p.createdAt,
    }))
    downloadCsv(rows, CSV_COLUMNS, csvFilename('players'))
    toast.success(`Exported ${rows.length} player${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-7xl">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">Players</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 3 — task 3.2
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        Search by name, phone, or email. Open a player to view their profile and wallet.
      </p>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no player data available."
          body="Run npm run emulator + seed or create players against the local Firestore emulator, then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load players." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search players…"
              autoFocus
              aria-label="Search players"
              className="flex-1 min-w-[14rem] bg-felt-900 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:text-white/30"
            />
            <button
              type="button"
              onClick={handleExport}
              className="px-3 py-3 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15"
            >
              Export CSV
            </button>
            {canCreate && (
              <Link
                to="/desk/players/new"
                className="px-3 py-3 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35"
              >
                + New player
              </Link>
            )}
          </div>

          {players.length === 0 ? (
            <EmptyState
              title="No players yet."
              body={canCreate ? 'Add your first player to get started.' : 'Players added by the desk will appear here.'}
            />
          ) : results.length === 0 ? (
            <div className="bg-felt-800 border border-white/5 rounded-lg p-8 text-center">
              <div className="font-display text-lg text-white mb-1">No players match "{q}".</div>
              <p className="text-sm text-white/50 mb-4">Check the spelling, or add them as a new player.</p>
              {canCreate && (
                <Link
                  to="/desk/players/new"
                  className="inline-block px-4 py-2 rounded-lg text-sm font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25"
                >
                  + New player
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="text-[11px] font-mono uppercase tracking-widest text-white/30 mb-2">
                {results.length}{results.length === RESULT_LIMIT ? '+' : ''} {results.length === 1 ? 'player' : 'players'}
              </div>
              <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
                    <tr>
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-left px-4 py-2 whitespace-nowrap">Phone</th>
                      <th className="text-left px-4 py-2 whitespace-nowrap">Email</th>
                      <th className="text-right px-4 py-2 whitespace-nowrap">Wallet</th>
                      <th className="text-right px-4 py-2 whitespace-nowrap">Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((p) => (
                      <tr
                        key={p.id}
                        className="relative border-t border-white/5 hover:bg-white/[0.04] cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-white/90">
                          {/* Stretched link — whole row is clickable, but still a real anchor
                              (keyboard, middle-click / open-in-new-tab). */}
                          <Link
                            to={`/desk/players/${p.id}`}
                            className="font-medium text-white/90 hover:text-white after:absolute after:inset-0 after:content-['']"
                          >
                            {playerDisplayName(p)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-white/70 whitespace-nowrap">{p.phone}</td>
                        <td className="px-4 py-3 text-white/50 whitespace-nowrap">{p.email ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-white/70 tabular-nums whitespace-nowrap">{formatMoney(p.walletBalance)}</td>
                        <td className="px-4 py-3 text-right text-white/70 tabular-nums whitespace-nowrap">{formatMoney(p.ticketBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function EmptyState({ title, body, tone = 'neutral' }) {
  const border = tone === 'error' ? 'border-red-500/30' : 'border-white/5'
  return (
    <div className={`bg-felt-800 border ${border} rounded-lg p-8 text-center`}>
      <div className="font-display text-lg text-white mb-1">{title}</div>
      {body && <p className="text-sm text-white/50 max-w-md mx-auto">{body}</p>}
    </div>
  )
}
