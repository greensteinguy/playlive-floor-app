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

// Sortable columns (A1). Default landing sort is alphabetical by name; clicking a
// header sorts by it, clicking again flips direction. Each column has a sensible
// first-click direction — buy-in / scheduled / entries lead high→low (biggest /
// newest first), text columns lead A→Z. Status sorts by lifecycle order.
const STATUS_ORDER = ['draft', 'scheduled', 'lateRegOpen', 'lateRegClosed', 'finished', 'cancelled']

function toMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  if (ts instanceof Date) return ts.getTime()
  return 0
}

const SORT_COLUMNS = [
  { key: 'name',               label: 'Name',      type: 'text', align: 'left',  defaultDir: 'asc',  get: (t) => t.name ?? '' },
  { key: 'gameType',           label: 'Type',      type: 'text', align: 'left',  defaultDir: 'asc',  get: (t) => GAME_TYPE_LABEL[t.gameType] ?? t.gameType ?? '' },
  { key: 'buyIn',              label: 'Buy-in',    type: 'num',  align: 'left',  defaultDir: 'desc', get: (t) => t.buyIn ?? 0 },
  { key: 'scheduledStartTime', label: 'Scheduled', type: 'num',  align: 'left',  defaultDir: 'desc', get: (t) => toMillis(t.scheduledStartTime) },
  { key: 'status',             label: 'Status',    type: 'num',  align: 'left',  defaultDir: 'asc',  get: (t) => STATUS_ORDER.indexOf(t.status) },
  { key: 'entryCount',         label: 'Entries',   type: 'num',  align: 'right', defaultDir: 'desc', get: (t) => t.entryCount ?? 0 },
]

function sortTournaments(rows, sortKey, sortDir) {
  const col = SORT_COLUMNS.find((c) => c.key === sortKey) ?? SORT_COLUMNS[0]
  const mul = sortDir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = col.get(a)
    const vb = col.get(b)
    let cmp
    if (col.type === 'text') cmp = String(va).localeCompare(String(vb), 'en', { sensitivity: 'base' })
    else cmp = va < vb ? -1 : va > vb ? 1 : 0
    if (cmp === 0) cmp = String(a.name ?? '').localeCompare(String(b.name ?? '')) // stable tiebreak by name
    return cmp * mul
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

  // Sort state (A1). Default: alphabetical by name.
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const sortedVisible = useMemo(
    () => sortTournaments(visible, sortKey, sortDir),
    [visible, sortKey, sortDir]
  )

  function handleSort(col) {
    if (col.key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(col.key)
      setSortDir(col.defaultDir)
    }
  }

  function handleExport() {
    if (sortedVisible.length === 0) {
      toast.info('Nothing to export — no tournaments in this view.')
      return
    }
    const rows = sortedVisible.map((t) => ({
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
    <div className="px-6 py-8 md:px-10 md:py-10">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">Tournaments</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/55 whitespace-nowrap">
          Phase 2 — task 2.2
        </span>
      </div>
      <p className="text-white/65 text-sm mb-6">
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
        <div className="py-12 text-center text-white/55 text-sm">Loading…</div>
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
                      : 'bg-white/5 text-white/65 hover:bg-white/10 hover:text-white/80')
                  }
                >
                  {f.label}
                  <span className="ml-1.5 text-white/45">{counts[f.id]}</span>
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
                <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/55">
                  <tr>
                    {SORT_COLUMNS.map((col) => {
                      const active = sortKey === col.key
                      return (
                        <th
                          key={col.key}
                          className={'px-4 py-2 whitespace-nowrap ' + (col.align === 'right' ? 'text-right' : 'text-left')}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(col)}
                            aria-label={`Sort by ${col.label}`}
                            className={
                              'inline-flex items-center gap-1 uppercase tracking-widest hover:text-white/70 active:text-white ' +
                              (active ? 'text-gold-300 ' : '') +
                              (col.align === 'right' ? 'flex-row-reverse' : '')
                            }
                          >
                            {col.label}
                            <span aria-hidden className="w-2 text-gold-300">
                              {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                            </span>
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedVisible.map((t) => (
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
                          <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-white/45">
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
      {body && <p className="text-sm text-white/65 max-w-md mx-auto">{body}</p>}
    </div>
  )
}
