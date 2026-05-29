// Reusable blind-structure editor — a controlled component over a `Structure`
// array (level | break entries). Used by the structure-template authoring page
// and, later, by the tournament-create wizard (task 2.1).
//
// blindNumber is never edited by hand: every mutation re-runs renumber() so the
// numbers stay sequential across level entries (breaks skipped) — exactly the
// invariant Structure.superRefine enforces. The component surfaces inline
// validation hints but leaves submit-gating to the parent (which holds value).

import { useMemo } from 'react'
import { Structure } from '../lib/schema'

const DEFAULT_LEVEL = {
  type: 'level',
  blindNumber: 1,
  smallBlind: 100,
  bigBlind: 200,
  ante: 0,
  bringIn: 0,
  durationMinutes: 20,
}

const DEFAULT_BREAK = {
  type: 'break',
  durationMinutes: 10,
  label: 'Break',
  isColorUp: false,
}

function renumber(entries) {
  let n = 1
  return entries.map((e) => (e.type === 'level' ? { ...e, blindNumber: n++ } : e))
}

function formatTotal(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export default function StructureEditor({ value, onChange, disabled = false }) {
  const entries = useMemo(() => value ?? [], [value])

  const emit = (next) => onChange(renumber(next))

  const addLevel = () => {
    // Carry the previous level's blinds/duration forward — less typing when
    // building a progression. renumber() fixes blindNumber.
    const lastLevel = [...entries].reverse().find((e) => e.type === 'level')
    const base = lastLevel ?? DEFAULT_LEVEL
    emit([...entries, { ...base, type: 'level' }])
  }
  const addBreak = () => emit([...entries, { ...DEFAULT_BREAK }])
  const removeAt = (i) => emit(entries.filter((_, idx) => idx !== i))
  const patchAt = (i, patch) =>
    emit(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= entries.length) return
    const next = [...entries]
    ;[next[i], next[j]] = [next[j], next[i]]
    emit(next)
  }

  // Map Structure validation issues onto their entry index for inline hints.
  const issuesByIndex = useMemo(() => {
    const map = new Map()
    const result = Structure.safeParse(entries)
    if (!result.success) {
      for (const issue of result.error.issues) {
        const idx = issue.path[0]
        if (typeof idx === 'number') {
          if (!map.has(idx)) map.set(idx, [])
          map.get(idx).push(issue.message)
        }
      }
    }
    return map
  }, [entries])

  const levelCount = entries.filter((e) => e.type === 'level').length
  const totalMinutes = entries.reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-white/40 font-mono">
          {levelCount} level{levelCount === 1 ? '' : 's'}
          {entries.length > levelCount ? ` · ${entries.length - levelCount} break${entries.length - levelCount === 1 ? '' : 's'}` : ''}
          {' · '}~{formatTotal(totalMinutes)} total
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addLevel}
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Level
          </button>
          <button
            type="button"
            onClick={addBreak}
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Break
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="bg-felt-800 border border-white/5 rounded-lg p-6 text-center text-sm text-white/40">
          No levels yet. Add a level to start the structure.
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, i) => {
            const rowIssues = issuesByIndex.get(i)
            const actions = (
              <RowActions
                index={i}
                count={entries.length}
                onMove={move}
                onRemove={removeAt}
                disabled={disabled}
              />
            )
            return (
              <div key={i}>
                {entry.type === 'level' ? (
                  <div className="flex flex-wrap items-end gap-2 bg-felt-800 border border-white/5 rounded-lg px-3 py-2">
                    <div className="flex flex-col gap-0.5 w-12">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">Lvl</span>
                      <span className="font-display text-gold-300 text-lg leading-none">{entry.blindNumber}</span>
                    </div>
                    <NumField label="Small" value={entry.smallBlind} disabled={disabled} onChange={(v) => patchAt(i, { smallBlind: v })} />
                    <NumField label="Big" value={entry.bigBlind} disabled={disabled} onChange={(v) => patchAt(i, { bigBlind: v })} />
                    <NumField label="Ante" value={entry.ante} disabled={disabled} onChange={(v) => patchAt(i, { ante: v })} />
                    <NumField label="Bring-in" value={entry.bringIn} disabled={disabled} onChange={(v) => patchAt(i, { bringIn: v })} />
                    <NumField label="Mins" value={entry.durationMinutes} min={1} disabled={disabled} onChange={(v) => patchAt(i, { durationMinutes: v })} width="w-16" />
                    {actions}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-2 bg-felt-900/60 border border-gold-500/20 rounded-lg px-3 py-2">
                    <div className="flex flex-col gap-0.5 w-12">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">Brk</span>
                      <span className="text-gold-300/60 text-lg leading-none">—</span>
                    </div>
                    <NumField label="Mins" value={entry.durationMinutes} min={1} disabled={disabled} onChange={(v) => patchAt(i, { durationMinutes: v })} width="w-16" />
                    <label className="flex flex-col gap-0.5 grow min-w-[8rem]">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">Label</span>
                      <input
                        type="text"
                        value={entry.label ?? ''}
                        disabled={disabled}
                        onChange={(e) => patchAt(i, { label: e.target.value === '' ? null : e.target.value })}
                        placeholder="Break"
                        className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm w-full disabled:opacity-50"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 pb-1 text-xs text-white/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entry.isColorUp}
                        disabled={disabled}
                        onChange={(e) => patchAt(i, { isColorUp: e.target.checked })}
                        className="accent-gold-500"
                      />
                      Color-up
                    </label>
                    {actions}
                  </div>
                )}
                {rowIssues && (
                  <p className="text-[11px] text-red-300 font-mono mt-0.5 ml-3">{rowIssues.join('; ')}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NumField({ label, value, onChange, min = 0, width = 'w-20', disabled = false }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isNaN(n) ? 0 : n)
        }}
        className={`bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm ${width} disabled:opacity-50`}
      />
    </label>
  )
}

function RowActions({ index, count, onMove, onRemove, disabled }) {
  const btn = 'w-7 h-7 rounded flex items-center justify-center text-sm disabled:opacity-30 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center gap-1 ml-auto pb-0.5">
      <button
        type="button"
        aria-label="Move up"
        disabled={disabled || index === 0}
        onClick={() => onMove(index, -1)}
        className={`${btn} bg-white/5 text-white/60 hover:bg-white/10 hover:text-white`}
      >
        ▲
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index, 1)}
        className={`${btn} bg-white/5 text-white/60 hover:bg-white/10 hover:text-white`}
      >
        ▼
      </button>
      <button
        type="button"
        aria-label="Remove"
        disabled={disabled}
        onClick={() => onRemove(index)}
        className={`${btn} bg-red-500/10 text-red-300/70 hover:bg-red-500/20 hover:text-red-200`}
      >
        ×
      </button>
    </div>
  )
}
