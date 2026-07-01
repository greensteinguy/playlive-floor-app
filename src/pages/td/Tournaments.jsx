// Tournament list (task 2.2). Replaces the placeholder. Lists every active
// tournament (running, scheduled, finished, cancelled), filterable by status,
// with click-through to the detail page. Owns the "+ New tournament" entry
// point (manager-only; the create route is itself manager-gated). This is also
// where the cashier picks a tournament before registering a player into it.
//
// Read-only for all floor roles; the create action is the only manager-gated bit
// here. Data comes from useTournaments (one-shot fetch + reload).

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useTournaments } from '../../hooks/useTournaments'
import { formatMoney } from '../../lib/money'
import { GAME_TYPE_LABEL } from '../../lib/gameTypes'
import { downloadCsv, csvFilename } from '../../lib/csv'
import StatusBadge from '../../components/StatusBadge'
import { statusLabel } from '../../lib/tournamentStatus'

// Filter chips group the six statuses into the buckets the floor thinks in.
const STATUS_FILTERS = [
  { id: 'all',       label: 'All',       match: () => true },
  { id: 'live',      label: 'Live',      match: (s) => s === 'lateRegOpen' || s === 'lateRegClosed' },
  { id: 'scheduled', label: 'Scheduled', match: (s) => s === 'draft' || s === 'scheduled' },
  { id: 'finished',  label: 'Finished',  match: (s) => s === 'finished' },
  { id: 'cancelled', label: 'Cancelled', match: (s) => s === 'cancelled' },
]

const CSV_COLUMNS = [
  { key: 'id', label: 'Tournament ID' },
  { key: 'name', label: 'Name' },
  { key: 'gameType', label: 'Game type' },
  { key: 'status', label: 'Status' },
  { key: 'buyIn', label: 'Buy-in' },
  { key: 'guarantee', label: 'Guarantee' },
  { key: 'scheduledStartTime', label: 'Scheduled start' },
  { key: 'entryCount', label: 'Entries' },
  { key: 'uniquePlayerCount', label: 'Unique players' },
  { key: 'remainingPlayerCount', label: 'Remaining' },
  { key: 'totalPrizePool', label: 'Prize pool' },
  { key: 'createdAt', label: 'Created at' },
]

function fmtDateTime(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  return d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function Tournaments() {
  const { role } = useAuth()
  const toast = useToast()
  const { tournaments, loading, error, mockMode } = useTournaments()
  const [filter, setFilter] = useState('all')

  const canCreate = role === 'manager'

  const activeFilter = STATUS_FILTERS.find((f) => f.id === filter) ?? STATUS_FILTERS[0]
  const visible = useMemo(
    () => tournaments.filter((t) => activeFilter.match(t.status)),
    [tournaments, activeFilter]
  )

  // Per-status counts for the chip labels.
  const counts = useMemo(() => {
    const c = {}
    for (const f of STATUS_FILTERS) c[f.id] = tournaments.filter((t) => f.match(t.status)).length
    return c
  }, [tournaments])

  function handleExport() {
    if (visible.length === 0) {
      toast.info('Nothing to export — no tournaments in this view.')
      return
    }
    const rows = visible.map((t) => ({
      id: t.id,
      name: t.name,
      gameType: GAME_TYPE_LABEL[t.gameType] ?? t.gameType,
      status: statusLabel(t.status),
      buyIn: formatMoney(t.buyIn),
      guarantee: formatMoney(t.guarantee),
      scheduledStartTime: t.scheduledStartTime, // Timestamp → ISO via csv defaultCellFormat
      entryCount: t.entryCount,
      uniquePlayerCount: t.uniquePlayerCount,
      remainingPlayerCount: t.remainingPlayerCount,
      totalPrizePool: formatMoney(t.totalPrizePool),
      createdAt: t.createdAt,
    }))
    downloadCsv(rows, CSV_COLUMNS, csvFilename('tournaments'))
    toast.success(`Exported ${rows.length} tournament${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-7xl">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">Tournaments</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 2 — task 2.2
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        Every tournament — running, scheduled, and finished. Open one to manage its clock, tables,
        and payouts, or to register players.
      </p>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no tournament data available."
          body="Run npm run emulator + create a tournament (or seed) against the local Firestore emulator, then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load tournaments." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={
                    'px-3 py-1.5 rounded-full text-xs font-medium ' +
                    (filter === f.id
                      ? 'bg-gold-500/20 text-gold-300'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80')
                  }
                >
                  {f.label}
                  <span className="ml-1.5 text-white/30">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15"
              >
                Export CSV
              </button>
              {canCreate && (
                <Link
                  to="/td/tournaments/new"
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35"
                >
                  + New tournament
                </Link>
              )}
            </div>
          </div>

          {tournaments.length === 0 ? (
            <EmptyState
              title="No tournaments yet."
              body={
                canCreate
                  ? 'Create your first tournament to get started.'
                  : 'Tournaments created by a manager will appear here.'
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState title="No tournaments match this filter." body="Try a different status filter above." />
          ) : (
            <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
                  <tr>
                    <th className="text-left px-4 py-2">Name</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Type</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Buy-in</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Scheduled</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Status</th>
                    <th className="text-right px-4 py-2 whitespace-nowrap">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <tr
                      key={t.id}
                      className="relative border-t border-white/5 hover:bg-white/[0.04] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-white/90">
                        {/* Stretched link — makes the whole row clickable while staying a real
                            anchor (keyboard, middle-click / open-in-new-tab). */}
                        <Link
                          to={`/td/tournaments/${t.id}`}
                          className="font-medium text-white/90 hover:text-white after:absolute after:inset-0 after:content-['']"
                        >
                          {t.name}
                        </Link>
                        {(t.isMultiDay || t.isMultiFlight) && (
                          <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-white/30">
                            {t.isMultiFlight ? 'multi-flight' : 'multi-day'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                        {GAME_TYPE_LABEL[t.gameType] ?? t.gameType}
                      </td>
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap">{formatMoney(t.buyIn)}</td>
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap">{fmtDateTime(t.scheduledStartTime)}</td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                      <td className="px-4 py-3 text-right text-white/70 tabular-nums">{t.entryCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
