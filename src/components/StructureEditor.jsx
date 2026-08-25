// Reusable blind-structure editor — a controlled component over a `Structure`
// array (level | break entries). Used by the structure-template authoring page,
// the tournament-create wizard and the tournament detail page.
//
// blindNumber is never edited by hand: every mutation re-runs renumber() so the
// numbers stay sequential across level entries (breaks skipped) — exactly the
// invariant Structure.superRefine enforces. The component surfaces inline
// validation hints but leaves submit-gating to the parent (which holds value).
//
// MARKERS (floor feedback D1.3, 24 Aug 2026) — the structure array itself has
// no notion of "late reg closes here" or "the day ends here"; those live on the
// tournament (lateRegCutoffLevel / reentryCutoffLevel, both blindNumbers) and on
// the sessions (maximumEndIndex, a structure INDEX). This editor renders them as
// coloured rules between rows and lets the TD set them by right-click (or
// long-press on iPad) instead of hunting for a separate dropdown. Markers are
// optional: hosts with nothing to mark (structure templates) omit the props and
// get the plain editor.

import { useEffect, useMemo, useRef, useState } from 'react'
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

// Marker styling. Each kind gets its own colour so a glance at the ladder tells
// you which line is which (Guy: "different colour lines to represent each").
const MARKER_STYLES = {
  rego: { rule: 'bg-amber-400/70', chip: 'bg-amber-400/15 text-amber-200 border-amber-400/40' },
  reentry: { rule: 'bg-sky-400/70', chip: 'bg-sky-400/15 text-sky-200 border-sky-400/40' },
  dayEnd: { rule: 'bg-violet-400/70', chip: 'bg-violet-400/15 text-violet-200 border-violet-400/40' },
}

const LEVEL_NUM_FIELDS = [
  { field: 'smallBlind', label: 'Small' },
  { field: 'bigBlind', label: 'Big' },
  { field: 'ante', label: 'Ante' },
  { field: 'bringIn', label: 'Bring-in' },
]

function renumber(entries) {
  let n = 1
  return entries.map((e) => (e.type === 'level' ? { ...e, blindNumber: n++ } : e))
}

function levelCountOf(entries) {
  return entries.filter((e) => e.type === 'level').length
}

function formatTotal(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Move item `from` to position `to` in a copy of `list`. */
function reorder(list, from, to) {
  if (from === to) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Follow a pinned structure INDEX through a reorder, so a day-end line travels
 * with the row it was pinned to instead of silently re-pinning to whatever row
 * slid into that slot.
 */
function indexAfterMove(index, from, to) {
  if (index == null || from == null || to == null) return index
  if (index === from) return to
  if (from < index && index <= to) return index - 1
  if (to <= index && index < from) return index + 1
  return index
}

export default function StructureEditor({
  value,
  onChange,
  disabled = false,
  // { lateRegCutoffLevel, reentryCutoffLevel, dayEnds: [{ index, label }] }.
  // Omit entirely to hide the marker layer.
  markers = null,
  // (patch) => void, where patch is a subset of the markers shape. Omit to make
  // the markers read-only (the detail page can't edit day ends — sessions are
  // separate docs it doesn't load).
  onMarkersChange = null,
  // Which marker kinds this host lets the TD set: any of 'rego' | 'reentry' | 'dayEnd'.
  editableMarkers = [],
}) {
  const entries = useMemo(() => value ?? [], [value])
  const [menu, setMenu] = useState(null) // { index, x, y }
  const [drag, setDrag] = useState(null) // { from, over }
  const [bulkMinutes, setBulkMinutes] = useState('')
  const [bulkTarget, setBulkTarget] = useState('levels')
  const rootRef = useRef(null)
  // Focus is addressed by `data-cell="${rowIndex}:${field}"` rather than a ref
  // map: the cells are plain DOM, and a query keeps render free of ref access.
  const pendingFocus = useRef(null)

  const markersOn = markers != null
  const canEdit = (kind) => !disabled && onMarkersChange != null && editableMarkers.includes(kind)
  const menusEnabled = !disabled && editableMarkers.length > 0 && onMarkersChange != null

  const cellAt = (key) => rootRef.current?.querySelector(`[data-cell="${key}"]`) ?? null

  // After Enter appends a row, focus the new row's same field — it doesn't
  // exist until the parent re-renders with the longer array.
  useEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    const el = cellAt(key)
    if (el) {
      el.focus()
      el.select?.()
    }
  }, [entries])

  // Every mutation goes through here so renumbering AND marker clamping happen
  // in one place. Deleting levels can strand a cutoff past the end of the ladder
  // (which the Tournament schema rejects on write), so pull it back in.
  const emit = (next, movedFrom = null, movedTo = null) => {
    const renumbered = renumber(next)
    onChange(renumbered)
    if (!markersOn || onMarkersChange == null) return

    const patch = {}
    const levels = levelCountOf(renumbered)
    for (const key of ['lateRegCutoffLevel', 'reentryCutoffLevel']) {
      const current = markers[key]
      if (current != null && current > levels) patch[key] = levels > 0 ? levels : null
    }
    const dayEnds = markers.dayEnds
    if (Array.isArray(dayEnds) && dayEnds.length > 0) {
      const last = renumbered.length - 1
      const nextDayEnds = dayEnds.map((d) => {
        if (d.index == null) return d
        const moved = indexAfterMove(d.index, movedFrom, movedTo)
        return { ...d, index: Math.min(Math.max(moved, 0), Math.max(last, 0)) }
      })
      if (nextDayEnds.some((d, i) => d.index !== dayEnds[i].index)) patch.dayEnds = nextDayEnds
    }
    if (Object.keys(patch).length > 0) onMarkersChange(patch)
  }

  const lastLevel = () => [...entries].reverse().find((e) => e.type === 'level')

  const addLevel = () => {
    // Carry the previous level's blinds/duration forward — less typing when
    // building a progression. renumber() fixes blindNumber.
    const base = lastLevel() ?? DEFAULT_LEVEL
    emit([...entries, { ...base, type: 'level' }])
  }

  // D1.4 — the "smart key": the next level is the previous one with its blinds
  // doubled. The ante doubles with them, which keeps a BB-ante ladder (the venue
  // standard, where ante === bigBlind) self-consistent and leaves a zero ante at
  // zero. Duration and bring-in carry over untouched.
  const addDoubledLevel = () => {
    const base = lastLevel() ?? DEFAULT_LEVEL
    emit([
      ...entries,
      {
        ...base,
        type: 'level',
        smallBlind: base.smallBlind * 2,
        bigBlind: base.bigBlind * 2,
        ante: base.ante * 2,
      },
    ])
  }

  const addBreak = () => emit([...entries, { ...DEFAULT_BREAK }])
  const removeAt = (i) => emit(entries.filter((_, idx) => idx !== i))
  const patchAt = (i, patch) => emit(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= entries.length) return
    emit(reorder(entries, i, j), i, j)
  }

  // D1.5 — bulk minutes. Breaks are excluded by default: a 10-minute break
  // shouldn't become a 40-minute one just because the levels did.
  const bulkValue = parseInt(bulkMinutes, 10)
  const bulkValid = Number.isFinite(bulkValue) && bulkValue >= 1
  const applyBulkMinutes = () => {
    if (!bulkValid || disabled) return
    emit(
      entries.map((e) => {
        const hit =
          bulkTarget === 'all' ||
          (bulkTarget === 'levels' && e.type === 'level') ||
          (bulkTarget === 'breaks' && e.type === 'break')
        return hit ? { ...e, durationMinutes: bulkValue } : e
      })
    )
  }

  // D1.2 — Enter moves to the same field on the next row; Enter on the last row
  // appends a level and lands in it. Shift+Enter walks back up. Rows without
  // that field (a break has only Mins) are skipped.
  const handleFieldKeyDown = (e, rowIndex, field) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const step = e.shiftKey ? -1 : 1
    for (let i = rowIndex + step; i >= 0 && i < entries.length; i += step) {
      const el = cellAt(`${i}:${field}`)
      if (el) {
        el.focus()
        el.select?.()
        return
      }
    }
    if (step === 1 && !disabled) {
      addLevel()
      pendingFocus.current = `${entries.length}:${field}`
    }
  }

  // D1.6 — pointer-based drag reorder. Deliberately NOT HTML5 drag-and-drop,
  // which does nothing on iOS; pointer events + elementFromPoint work with a
  // mouse and a finger alike. The up/down buttons stay for keyboard users.
  const dragHandlers = (index) => ({
    onPointerDown: (e) => {
      if (disabled || e.button > 0) return
      e.preventDefault()
      // Capture keeps the move/up events coming even when the finger leaves the
      // handle. It throws if the pointer id isn't active (some synthetic events),
      // and losing capture is survivable — the drag still tracks via the row
      // hit-test — so never let it take the gesture down with it.
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } catch {
        // no capture; the drag still works while the pointer stays over the list
      }
      setDrag({ from: index, over: index })
    },
    onPointerMove: (e) => {
      if (!drag) return
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-row-index]')
      if (!el) return
      const over = Number(el.getAttribute('data-row-index'))
      if (!Number.isNaN(over) && over !== drag.over) setDrag((d) => (d ? { ...d, over } : d))
    },
    onPointerUp: (e) => {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      } catch {
        // nothing was captured
      }
      if (drag && drag.over !== drag.from) emit(reorder(entries, drag.from, drag.over), drag.from, drag.over)
      setDrag(null)
    },
    onPointerCancel: () => setDrag(null),
  })

  const openMenu = (e, index) => {
    if (!menusEnabled) return
    e.preventDefault?.()
    setMenu({ index, x: e.clientX, y: e.clientY })
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

  // Which marker lines sit UNDER each row index. Cutoffs are blindNumbers, day
  // ends are structure indices, so they resolve differently.
  const markersByRow = useMemo(() => {
    const map = new Map()
    if (!markersOn) return map
    const push = (idx, m) => {
      if (idx == null || idx < 0) return
      if (!map.has(idx)) map.set(idx, [])
      map.get(idx).push(m)
    }
    const indexOfLevel = (blindNumber) =>
      entries.findIndex((e) => e.type === 'level' && e.blindNumber === blindNumber)

    if (markers.lateRegCutoffLevel != null) {
      push(indexOfLevel(markers.lateRegCutoffLevel), {
        kind: 'rego',
        label: `Registration closes · end of level ${markers.lateRegCutoffLevel}`,
      })
    }
    if (markers.reentryCutoffLevel != null) {
      push(indexOfLevel(markers.reentryCutoffLevel), {
        kind: 'reentry',
        label: `Re-entry closes · end of level ${markers.reentryCutoffLevel}`,
      })
    }
    for (const d of markers.dayEnds ?? []) {
      push(d.index, { kind: 'dayEnd', label: `${d.label} ends here` })
    }
    return map
  }, [markersOn, markers, entries])

  const levelCount = levelCountOf(entries)
  const breakCount = entries.length - levelCount
  const totalMinutes = entries.reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0)

  return (
    <div className="space-y-2" ref={rootRef}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-white/55 font-mono">
          {levelCount} level{levelCount === 1 ? '' : 's'}
          {breakCount > 0 ? ` · ${breakCount} break${breakCount === 1 ? '' : 's'}` : ''}
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
            onClick={addDoubledLevel}
            disabled={disabled}
            title="Add a level with the blinds — and the ante — doubled from the last one"
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + Double ×2
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

      {entries.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 bg-felt-900/40 border border-white/5 rounded-lg px-3 py-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/55">Set all to</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={bulkMinutes}
              disabled={disabled}
              placeholder="20"
              onChange={(e) => setBulkMinutes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyBulkMinutes()
                }
              }}
              className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm w-20 disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/55">Minutes for</span>
            <select
              value={bulkTarget}
              disabled={disabled}
              onChange={(e) => setBulkTarget(e.target.value)}
              className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm disabled:opacity-50"
            >
              <option value="levels">every level</option>
              <option value="breaks">every break</option>
              <option value="all">levels and breaks</option>
            </select>
          </label>
          <button
            type="button"
            onClick={applyBulkMinutes}
            disabled={disabled || !bulkValid}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
          {menusEnabled && (
            <p className="text-[11px] text-white/45 ml-auto self-center max-w-sm">
              Right-click a level — or press and hold on iPad — to set the registration, re-entry and end-of-day lines.
            </p>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="bg-felt-800 border border-white/5 rounded-lg p-6 text-center text-sm text-white/55">
          No levels yet. Add a level to start the structure.
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, i) => {
            const rowIssues = issuesByIndex.get(i)
            const rowMarkers = markersByRow.get(i)
            const isDragging = drag?.from === i
            const isOver = drag != null && drag.over === i && drag.from !== i
            const tone = (isDragging ? 'opacity-40 ' : '') + (isOver ? 'ring-2 ring-gold-400/70 ' : '')
            const actions = (
              <RowActions
                index={i}
                count={entries.length}
                onMove={move}
                onRemove={removeAt}
                disabled={disabled}
                dragHandlers={dragHandlers(i)}
              />
            )
            return (
              <div key={i}>
                <div
                  data-row-index={i}
                  onContextMenu={(e) => openMenu(e, i)}
                  onPointerDown={makeLongPress(openMenu, i, menusEnabled)}
                >
                  {entry.type === 'level' ? (
                    <div className={`${tone}flex flex-wrap items-end gap-2 bg-felt-800 border border-white/5 rounded-lg px-3 py-2`}>
                      <div className="flex flex-col gap-0.5 w-12">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-white/55">Lvl</span>
                        <span className="font-display text-gold-300 text-lg leading-none">{entry.blindNumber}</span>
                      </div>
                      {LEVEL_NUM_FIELDS.map(({ field, label }) => (
                        <NumField
                          key={field}
                          label={label}
                          value={entry[field]}
                          disabled={disabled}
                          onChange={(v) => patchAt(i, { [field]: v })}
                          onKeyDown={(e) => handleFieldKeyDown(e, i, field)}
                          cellKey={`${i}:${field}`}
                        />
                      ))}
                      <NumField
                        label="Mins"
                        value={entry.durationMinutes}
                        min={1}
                        disabled={disabled}
                        onChange={(v) => patchAt(i, { durationMinutes: v })}
                        onKeyDown={(e) => handleFieldKeyDown(e, i, 'durationMinutes')}
                        cellKey={`${i}:durationMinutes`}
                        width="w-16"
                      />
                      {actions}
                    </div>
                  ) : (
                    <div className={`${tone}flex flex-wrap items-end gap-2 bg-felt-900/60 border border-gold-500/20 rounded-lg px-3 py-2`}>
                      <div className="flex flex-col gap-0.5 w-12">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-white/55">Brk</span>
                        <span className="text-gold-300/60 text-lg leading-none">—</span>
                      </div>
                      <NumField
                        label="Mins"
                        value={entry.durationMinutes}
                        min={1}
                        disabled={disabled}
                        onChange={(v) => patchAt(i, { durationMinutes: v })}
                        onKeyDown={(e) => handleFieldKeyDown(e, i, 'durationMinutes')}
                        cellKey={`${i}:durationMinutes`}
                        width="w-16"
                      />
                      <label className="flex flex-col gap-0.5 grow min-w-[8rem]">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-white/55">Label</span>
                        <input
                          type="text"
                          value={entry.label ?? ''}
                          disabled={disabled}
                          onChange={(e) => patchAt(i, { label: e.target.value === '' ? null : e.target.value })}
                          placeholder="Break"
                          className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm w-full disabled:opacity-50"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 pb-1 text-xs text-white/70 cursor-pointer">
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
                </div>
                {rowIssues && (
                  <p className="text-[11px] text-red-300 font-mono mt-0.5 ml-3">{rowIssues.join('; ')}</p>
                )}
                {rowMarkers?.map((m) => (
                  <MarkerRule key={`${m.kind}-${m.label}`} kind={m.kind} label={m.label} />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {menu && (
        <MarkerMenu
          menu={menu}
          entry={entries[menu.index]}
          markers={markers}
          canEdit={canEdit}
          onClose={() => setMenu(null)}
          onSet={(patch) => {
            onMarkersChange?.(patch)
            setMenu(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Long-press opens the same menu right-click does. iPad has no right-click and
 * the TD persona is touch-first, so the gesture has to exist on both devices.
 * Mouse pointers are ignored here — they get onContextMenu instead.
 */
function makeLongPress(openMenu, index, enabled) {
  return (e) => {
    if (!enabled || e.pointerType === 'mouse') return
    const { clientX, clientY, currentTarget } = e
    const timer = setTimeout(() => openMenu({ clientX, clientY }, index), 500)
    const cancel = () => {
      clearTimeout(timer)
      currentTarget.removeEventListener('pointerup', cancel)
      currentTarget.removeEventListener('pointercancel', cancel)
      currentTarget.removeEventListener('pointermove', cancel)
    }
    currentTarget.addEventListener('pointerup', cancel)
    currentTarget.addEventListener('pointercancel', cancel)
    currentTarget.addEventListener('pointermove', cancel)
  }
}

/** One coloured rule + chip drawn under the row it marks. */
function MarkerRule({ kind, label }) {
  const style = MARKER_STYLES[kind] ?? MARKER_STYLES.rego
  return (
    <div className="flex items-center gap-2 my-1" aria-label={label}>
      <div className={`h-0.5 flex-1 rounded ${style.rule}`} />
      <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${style.chip}`}>
        {label}
      </span>
      <div className={`h-0.5 flex-1 rounded ${style.rule}`} />
    </div>
  )
}

/** Right-click / long-press menu for setting the marker lines. */
function MarkerMenu({ menu, entry, markers, canEdit, onClose, onSet }) {
  const isLevel = entry?.type === 'level'
  const blindNumber = entry?.blindNumber ?? null
  const items = []

  if (isLevel && canEdit('rego')) {
    const already = markers?.lateRegCutoffLevel === blindNumber
    items.push({
      key: 'rego',
      kind: 'rego',
      label: already ? 'Clear registration close' : `Registration closes after level ${blindNumber}`,
      patch: { lateRegCutoffLevel: already ? null : blindNumber },
    })
  }
  if (isLevel && canEdit('reentry')) {
    const already = markers?.reentryCutoffLevel === blindNumber
    items.push({
      key: 'reentry',
      kind: 'reentry',
      label: already ? 'Clear re-entry close' : `Re-entry closes after level ${blindNumber}`,
      patch: { reentryCutoffLevel: already ? null : blindNumber },
    })
  }
  if (canEdit('dayEnd')) {
    const dayEnds = markers?.dayEnds ?? []
    dayEnds.forEach((d, i) => {
      const already = d.index === menu.index
      items.push({
        key: `day-${i}`,
        kind: 'dayEnd',
        label: already ? `Clear ${d.label} end` : `${d.label} ends here`,
        patch: {
          dayEnds: dayEnds.map((x, j) => (j === i ? { ...x, index: already ? null : menu.index } : x)),
        },
      })
    })
  }

  // Keep the popover on screen: 15rem wide, ~44px per item.
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 260))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 24 - Math.max(items.length, 1) * 44))

  return (
    <>
      {/* Click-away shield. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div role="menu" className="fixed z-50 min-w-[15rem] bg-felt-800 border border-white/10 rounded-lg shadow-xl py-1" style={{ left, top }}>
        {items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-white/55">
            {isLevel ? 'Nothing to mark here.' : 'Registration and re-entry lines can only sit on a level.'}
          </p>
        ) : (
          items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => onSet(it.patch)}
              className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 flex items-center gap-2"
            >
              <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${MARKER_STYLES[it.kind].rule}`} />
              {it.label}
            </button>
          ))
        )}
      </div>
    </>
  )
}

function NumField({ label, value, onChange, min = 0, width = 'w-20', disabled = false, onKeyDown, cellKey }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-white/55">{label}</span>
      <input
        data-cell={cellKey}
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isNaN(n) ? 0 : n)
        }}
        className={`bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm ${width} disabled:opacity-50`}
      />
    </label>
  )
}

function RowActions({ index, count, onMove, onRemove, disabled, dragHandlers }) {
  // 44px targets — × deletes a blind level (iPad pass 2026-08-10, finding M8)
  const btn = 'w-11 h-11 rounded flex items-center justify-center text-sm disabled:opacity-30 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center gap-2 ml-auto pb-0.5">
      <div
        {...dragHandlers}
        aria-hidden="true"
        title="Drag to reorder"
        style={{ touchAction: 'none' }}
        className={`${btn} ${disabled ? 'opacity-30' : 'cursor-grab active:cursor-grabbing bg-white/5 text-white/45 hover:bg-white/10 hover:text-white/80'}`}
      >
        ⠿
      </div>
      <button
        type="button"
        aria-label="Move up"
        disabled={disabled || index === 0}
        onClick={() => onMove(index, -1)}
        className={`${btn} bg-white/5 text-white/70 hover:bg-white/10 hover:text-white`}
      >
        ▲
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index, 1)}
        className={`${btn} bg-white/5 text-white/70 hover:bg-white/10 hover:text-white`}
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
