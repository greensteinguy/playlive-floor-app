// Manager-only duplicate-player merge tool.
//
// Two views: a list of candidate groups (phone-normalized matches), and a
// side-by-side compare view for a single group with per-pair merge buttons.
// Merge requires typing "MERGE" to confirm.

import { useMemo, useState } from 'react'
import { useDuplicateCandidates } from '../../hooks/useDuplicateCandidates'
import { useToast } from '../../shell/useToast'
import { mergePlayer, PlayerMergeError } from '../../lib/players'
import { downloadCsv, csvFilename } from '../../lib/csv'

const CSV_COLUMNS = [
  { key: 'groupKey',       label: 'Group key (normalized phone)' },
  { key: 'memberCount',    label: 'Member count' },
  { key: 'playerId',       label: 'Player ID' },
  { key: 'firstName',      label: 'First name' },
  { key: 'lastName',       label: 'Last name' },
  { key: 'phone',          label: 'Phone' },
  { key: 'email',          label: 'Email' },
  { key: 'walletBalance',  label: 'Wallet balance (cents)' },
  { key: 'ticketBalance',  label: 'Ticket balance (cents)' },
  { key: 'totalDeposited', label: 'Total deposited (cents)' },
  { key: 'createdAt',      label: 'Created at' },
]

function fmtMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

export default function Dedupe() {
  const { groups, loading, error, mockMode, reload } = useDuplicateCandidates()
  const toast = useToast()
  const [selectedKey, setSelectedKey] = useState(null)

  const selectedGroup = useMemo(
    () => (selectedKey ? groups.find((g) => g.key === selectedKey) : null),
    [groups, selectedKey]
  )

  function handleExport() {
    const rows = []
    for (const g of groups) {
      for (const m of g.members) {
        rows.push({
          groupKey: g.key,
          memberCount: g.members.length,
          playerId: m.id,
          firstName: m.firstName,
          lastName: m.lastName,
          phone: m.phone,
          email: m.email,
          walletBalance: m.walletBalance,
          ticketBalance: m.ticketBalance,
          totalDeposited: m.totalDeposited,
          createdAt: m.createdAt,
        })
      }
    }
    if (rows.length === 0) {
      toast.info('Nothing to export — no candidate duplicates.')
      return
    }
    downloadCsv(rows, CSV_COLUMNS, csvFilename('dedupe-candidates'))
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">Dedupe players</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 1 — task 1.8
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        Suspected duplicates by normalized phone number. Manager-only. Merges are permanent.
      </p>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no player data available."
          body="Run npm run emulator + npm run seed:dedupe to populate the local Firestore emulator with a few duplicate-pair scenarios. Then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load players." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : selectedGroup ? (
        <CompareView
          group={selectedGroup}
          onBack={() => setSelectedKey(null)}
          onMerged={() => {
            setSelectedKey(null)
            reload()
          }}
        />
      ) : (
        <ListView
          groups={groups}
          onPick={(k) => setSelectedKey(k)}
          onExport={handleExport}
        />
      )}
    </div>
  )
}

// ── List view ────────────────────────────────────────────────────────────────

function ListView({ groups, onPick, onExport }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No duplicate candidates found."
        body="Every player has a unique normalized phone number (or no phone at all). Nice work."
      />
    )
  }
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-white/40 font-mono">
          {groups.length} group{groups.length === 1 ? '' : 's'} found · {groups.reduce((n, g) => n + g.members.length, 0)} players involved
        </div>
        <button
          type="button"
          onClick={onExport}
          className="px-3 py-2 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35"
        >
          Export CSV
        </button>
      </div>

      <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
            <tr>
              <th className="text-left px-4 py-2 whitespace-nowrap">Phone key</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Members</th>
              <th className="text-left px-4 py-2">Players</th>
              <th className="text-right px-4 py-2 whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-xs text-white/70">{g.key}</td>
                <td className="px-4 py-3 text-white/80">{g.members.length}</td>
                <td className="px-4 py-3 text-xs text-white/70">
                  {g.members.map((m) => `${m.firstName} ${m.lastName}`).join(' · ')}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onPick(g.key)}
                    className="px-3 py-2 rounded text-xs bg-white/5 text-white/70 hover:bg-white/10 hover:text-white active:bg-white/15"
                  >
                    Inspect →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Compare view ─────────────────────────────────────────────────────────────

function CompareView({ group, onBack, onMerged }) {
  const toast = useToast()
  const [keepId, setKeepId] = useState(group.members[0].id)
  const [mergeId, setMergeId] = useState(group.members.length > 1 ? group.members[1].id : null)
  const [confirmText, setConfirmText] = useState('')
  const [mergeError, setMergeError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const keep = group.members.find((m) => m.id === keepId)
  const merge = group.members.find((m) => m.id === mergeId)

  const canMerge =
    keep && merge && keepId !== mergeId && confirmText === 'MERGE' && !submitting

  async function handleMerge() {
    if (!canMerge) return
    setSubmitting(true)
    setMergeError(null)
    try {
      const result = await mergePlayer({
        sourceId: mergeId,
        targetId: keepId,
        actorId: 'manager-1', // TODO: wire to real auth user when production auth lands
        actorRole: 'manager',
      })
      toast.success(
        `Merged ${merge.firstName} ${merge.lastName} → ${keep.firstName} ${keep.lastName}. ` +
        `Transferred $${(result.transferred.walletBalance / 100).toFixed(2)} wallet + ` +
        `${result.transferred.ticketsMoved} ticket${result.transferred.ticketsMoved === 1 ? '' : 's'}.`
      )
      onMerged()
    } catch (e) {
      setMergeError(e)
      if (e instanceof PlayerMergeError) {
        toast.error(e.message)
      } else {
        toast.error(`Merge failed: ${e.message}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-white/50 hover:text-white mb-4"
      >
        ← Back to candidates
      </button>

      <div className="mb-3 text-xs font-mono text-white/40">
        Group key: {group.key} · {group.members.length} member{group.members.length === 1 ? '' : 's'}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <PlayerColumn
          label="Keep (target)"
          tone="keep"
          members={group.members}
          selectedId={keepId}
          otherId={mergeId}
          onSelect={setKeepId}
        />
        <PlayerColumn
          label="Merge in (source)"
          tone="merge"
          members={group.members}
          selectedId={mergeId}
          otherId={keepId}
          onSelect={setMergeId}
        />
      </div>

      <div className="bg-felt-800 border border-red-500/30 rounded-lg p-5">
        <h3 className="font-display text-lg text-red-200 mb-2">Confirm merge</h3>
        <p className="text-sm text-white/70 mb-4">
          {merge && keep ? (
            <>
              Merge <strong>{merge.firstName} {merge.lastName}</strong> ({merge.id.slice(0, 8)}…) into{' '}
              <strong>{keep.firstName} {keep.lastName}</strong> ({keep.id.slice(0, 8)}…). Source's wallet
              and tickets transfer; source is marked merged. Permanent.
            </>
          ) : (
            'Pick a different player for each column.'
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-white/60 flex items-center gap-2">
            Type <code className="bg-felt-950/80 px-1 py-0.5 rounded text-red-200">MERGE</code> to confirm
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="MERGE"
              className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm font-mono w-32"
              disabled={submitting}
            />
          </label>
          <button
            type="button"
            onClick={handleMerge}
            disabled={!canMerge}
            className={
              'px-4 py-2 rounded-lg text-sm font-medium ' +
              (canMerge
                ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                : 'bg-white/5 text-white/30 cursor-not-allowed')
            }
          >
            {submitting ? 'Merging…' : 'Commit merge'}
          </button>
        </div>
        {mergeError && (
          <p className="mt-3 text-xs text-red-300 font-mono">{mergeError.message}</p>
        )}
      </div>
    </>
  )
}

function PlayerColumn({ label, tone, members, selectedId, otherId, onSelect }) {
  const accent =
    tone === 'keep'
      ? 'border-emerald-500/30 ring-emerald-500/20'
      : 'border-red-500/30 ring-red-500/20'
  const selected = members.find((m) => m.id === selectedId) ?? null
  return (
    <div className={`bg-felt-800 border rounded-lg p-4 ${accent}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">
        {label}
      </div>
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm mb-4"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id} disabled={m.id === otherId}>
            {m.firstName} {m.lastName} — {m.id.slice(0, 8)}…
          </option>
        ))}
      </select>
      {selected ? <PlayerFacts player={selected} /> : <div className="text-white/40 text-sm">Pick one.</div>}
    </div>
  )
}

function PlayerFacts({ player }) {
  const rows = [
    ['ID',              <span className="font-mono text-xs">{player.id}</span>],
    ['Name',            `${player.firstName} ${player.lastName}`],
    ['Phone',           player.phone],
    ['Email',           player.email ?? '—'],
    ['Wallet balance',  fmtMoney(player.walletBalance)],
    ['Ticket balance',  fmtMoney(player.ticketBalance)],
    ['Total deposited', fmtMoney(player.totalDeposited)],
    ['Created',         player.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) ?? '—'],
  ]
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-4">
          <dt className="text-white/40 text-xs uppercase tracking-wider">{k}</dt>
          <dd className="text-white/80 text-right truncate">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Shared ───────────────────────────────────────────────────────────────────

function EmptyState({ title, body, tone = 'neutral' }) {
  const border = tone === 'error' ? 'border-red-500/30' : 'border-white/5'
  return (
    <div className={`bg-felt-800 border ${border} rounded-lg p-8 text-center`}>
      <div className="font-display text-lg text-white mb-1">{title}</div>
      {body && <p className="text-sm text-white/50 max-w-md mx-auto">{body}</p>}
    </div>
  )
}
