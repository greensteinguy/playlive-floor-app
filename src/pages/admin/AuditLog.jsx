// Manager-only audit log viewer.
//
// Route is gated in App.jsx; this page assumes a manager. Reads from the
// auditLog collection via `useAuditLog`, which handles filter state, pagination,
// and mock-mode. CSV export hits the same filter set with a higher limit and
// downloads via the generic CSV utility.

import { useMemo, useState } from 'react'
import { useAuditLog } from '../../hooks/useAuditLog'
import { useToast } from '../../shell/useToast'
import { downloadCsv, csvFilename } from '../../lib/csv'
import { WELL_KNOWN_ACTION_TYPES } from '../../lib/schema'

// Action-type options for the filter dropdown, sorted alphabetically (A6).
const SORTED_ACTION_TYPES = [...WELL_KNOWN_ACTION_TYPES].sort((a, b) => a.localeCompare(b))

const DATE_PRESETS = [
  { id: 'all',  label: 'All time',  days: null },
  { id: '24h',  label: 'Last 24h',  days: 1 },
  { id: '7d',   label: 'Last 7 days',  days: 7 },
  { id: '30d',  label: 'Last 30 days', days: 30 },
  { id: 'custom', label: 'Custom', days: null },
]

const CSV_COLUMNS = [
  { key: 'timestamp', label: 'Timestamp' }, // default formatter → ISO
  { key: 'actorId',   label: 'Actor ID' },
  { key: 'actorRole', label: 'Actor role' },
  { key: 'actionType', label: 'Action' },
  { key: 'targetType', label: 'Target type' },
  { key: 'targetId',   label: 'Target ID' },
  { key: 'metadata',   label: 'Metadata' }, // default formatter → JSON
]

const ROLE_CLASSES = {
  manager: 'bg-gold-500/15 text-gold-300',
  td:      'bg-emerald-500/15 text-emerald-300',
  cashier: 'bg-sky-500/15 text-sky-300',
  readonly:'bg-white/10 text-white/60',
  system:  'bg-violet-500/15 text-violet-300',
}

export default function AuditLog() {
  const toast = useToast()

  // Filter inputs as raw strings; we derive the typed filters in `filters`.
  const [datePresetId, setDatePresetId] = useState('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [actionType, setActionType] = useState('')
  const [actorId,    setActorId]    = useState('')
  const [targetType, setTargetType] = useState('')
  const [targetId,   setTargetId]   = useState('')

  // Derive the active { since, until } from the preset choice (or custom inputs).
  // Memoized so the relative "now" baseline (e.g. "last 7 days") is stable across
  // renders — otherwise every paint produces a fresh Date and the hook's effect
  // sees the filter set as "changed" each tick, causing an infinite refetch loop.
  const { since, until } = useMemo(
    () => deriveDateRange(datePresetId, customFrom, customTo),
    [datePresetId, customFrom, customTo]
  )

  // Server-side filters (indexed): action type (exact) + date range.
  const serverFilters = useMemo(
    () => ({
      actionType: actionType.trim() || null,
      since,
      until,
    }),
    [actionType, since, until]
  )

  // Client-side substring filters (case-insensitive). Firestore can't do
  // substring/"contains" queries, and the old exact `==` match meant nothing
  // showed until the value was typed in full. These now filter as-you-type over
  // the fetched rows instead (A5, floor feedback).
  const textFilters = useMemo(
    () => ({
      actorId:    actorId.trim().toLowerCase(),
      targetType: targetType.trim().toLowerCase(),
      targetId:   targetId.trim().toLowerCase(),
    }),
    [actorId, targetType, targetId]
  )

  const { entries, loading, error, mockMode, hasMore, loadMore, exportAll } =
    useAuditLog(serverFilters)

  const visibleEntries = useMemo(
    () => entries.filter((e) => matchesTextFilters(e, textFilters)),
    [entries, textFilters]
  )

  const [expandedId, setExpandedId] = useState(null)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const { rows, truncated, limit } = await exportAll()
      // Apply the same client-side substring filters as the table (A5).
      const filtered = rows.filter((e) => matchesTextFilters(e, textFilters))
      if (filtered.length === 0) {
        toast.info('Nothing to export — current filters returned no rows.')
        return
      }
      downloadCsv(filtered, CSV_COLUMNS, csvFilename('audit-log'))
      if (truncated) {
        toast.info(`Export capped at ${limit} rows. Narrow the date or filters to see the rest.`)
      } else {
        toast.success(`Exported ${filtered.length} row${filtered.length === 1 ? '' : 's'} to CSV.`)
      }
    } catch (e) {
      toast.error(`Export failed: ${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  function clearFilters() {
    setDatePresetId('7d')
    setCustomFrom('')
    setCustomTo('')
    setActionType('')
    setActorId('')
    setTargetType('')
    setTargetId('')
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-7xl">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">Audit log</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 1 — task 1.9
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        Every staff action is logged here. Manager-only.
      </p>

      {/* Filter bar */}
      <div className="bg-felt-800 border border-white/5 rounded-lg p-4 md:p-5 mb-4 space-y-3">
        {/* Row 1: date presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 mr-2">Date</span>
          {/* py-2 chips ≈ 36px tap height — wider gives the iPad finger room. */}
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDatePresetId(p.id)}
              className={
                'px-3 py-2 rounded-full text-xs font-mono uppercase tracking-wider ' +
                (datePresetId === p.id
                  ? 'bg-gold-500/20 text-gold-300'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white active:bg-white/15')
              }
            >
              {p.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={clearFilters}
              className="px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/5 active:bg-white/10"
            >
              Clear filters
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || mockMode}
              className={
                'px-3 py-2 rounded-lg text-xs font-medium ' +
                (exporting || mockMode
                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                  : 'bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35')
              }
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* Row 2: custom date pickers, only when preset='custom' */}
        {datePresetId === 'custom' && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-white/60 flex items-center gap-2">
              From
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-white/60 flex items-center gap-2">
              To
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
        )}

        {/* Row 3: other filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-white/60 flex flex-col gap-1">
            Action type
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
            >
              <option value="">All actions</option>
              {SORTED_ACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-white/60 flex flex-col gap-1">
            Actor ID
            <input
              type="text"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="e.g. user-123"
              className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <label className="text-xs text-white/60 flex flex-col gap-1">
            Target type
            <input
              type="text"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              placeholder="e.g. player, tournament"
              className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <label className="text-xs text-white/60 flex flex-col gap-1">
            Target ID
            <input
              type="text"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="e.g. tournament-abc"
              className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      </div>

      {/* Results */}
      {mockMode ? (
        <EmptyState
          title="Mock mode — no audit log data available."
          body="Set VITE_USE_MOCK_DATA=false in .env.local (and configure a real Firebase project) to read live auditLog entries."
        />
      ) : error ? (
        <EmptyState
          title="Couldn't load audit log."
          body={error.message}
          tone="error"
        />
      ) : visibleEntries.length === 0 && !loading ? (
        <EmptyState
          title="No entries match the current filters."
          body="Try widening the date range or clearing the filters."
        />
      ) : (
        <EntriesTable
          entries={visibleEntries}
          expandedId={expandedId}
          onToggleExpand={(id) => setExpandedId((curr) => (curr === id ? null : id))}
        />
      )}

      {/* Load more */}
      {hasMore && !mockMode && !error && (
        <div className="flex justify-center py-6">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-50 text-sm"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {loading && entries.length === 0 && !mockMode && (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveDateRange(presetId, customFromIso, customToIso) {
  if (presetId === 'all') return { since: undefined, until: undefined }
  if (presetId === 'custom') {
    return {
      since: customFromIso ? new Date(customFromIso + 'T00:00:00') : undefined,
      until: customToIso   ? new Date(customToIso   + 'T23:59:59') : undefined,
    }
  }
  const preset = DATE_PRESETS.find((p) => p.id === presetId)
  if (!preset || preset.days == null) return { since: undefined, until: undefined }
  const since = new Date()
  since.setDate(since.getDate() - preset.days)
  return { since, until: undefined }
}

// Case-insensitive substring match for the free-text filters (A5). Firestore
// has no `contains` operator, so these are applied client-side over the fetched
// rows — filtering as the manager types rather than requiring an exact value.
function matchesTextFilters(entry, { actorId, targetType, targetId }) {
  if (actorId && !String(entry.actorId ?? '').toLowerCase().includes(actorId)) return false
  if (targetType && !String(entry.targetType ?? '').toLowerCase().includes(targetType)) return false
  if (targetId && !String(entry.targetId ?? '').toLowerCase().includes(targetId)) return false
  return true
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

function EntriesTable({ entries, expandedId, onToggleExpand }) {
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
            <tr>
              <th className="text-left px-4 py-2 whitespace-nowrap">Timestamp</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Actor</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Action</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Target</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const expanded = expandedId === e.id
              return (
                <Row
                  key={e.id}
                  entry={e}
                  expanded={expanded}
                  onToggle={() => onToggleExpand(e.id)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ entry, expanded, onToggle }) {
  const roleClass = ROLE_CLASSES[entry.actorRole] ?? 'bg-white/10 text-white/60'
  const isoTs = entry.timestamp?.toDate?.().toISOString?.() ?? '—'

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-t border-white/5 hover:bg-white/[0.03] active:bg-white/[0.06] cursor-pointer"
      >
        <td className="px-4 py-3 font-mono text-xs text-white/70 whitespace-nowrap">
          {isoTs}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="font-mono text-xs text-white/80 truncate max-w-[12rem]" title={entry.actorId}>
            {entry.actorId}
          </div>
          <span
            className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${roleClass}`}
          >
            {entry.actorRole}
          </span>
        </td>
        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gold-300/90">
          {entry.actionType}
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-xs text-white/70">
          {entry.targetType ? (
            <>
              <span className="text-white/40">{entry.targetType}</span>
              <span className="mx-1 text-white/20">/</span>
              <span className="font-mono">{entry.targetId ?? '—'}</span>
            </>
          ) : (
            <span className="text-white/30">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right text-xs text-white/40">
          {entry.metadata && Object.keys(entry.metadata).length > 0
            ? expanded
              ? 'Hide'
              : 'View'
            : '—'}
        </td>
      </tr>
      {expanded && entry.metadata && Object.keys(entry.metadata).length > 0 && (
        <tr className="border-t border-white/5 bg-felt-900/40">
          <td colSpan={5} className="px-4 py-3">
            <pre className="text-xs font-mono text-white/70 whitespace-pre-wrap break-words">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}
