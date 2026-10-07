// TV screens (7 Oct 2026) — the venue's named TVs and the sets they sit in.
//
// Each TV opens its permanent link (/display/<id>) once, signed in as the
// shared readonly account; from then on it subscribes to its displayScreens
// doc (and its set's displayGroups doc) and changes land live.
//
// Two panes, drag and drop (@dnd-kit — mouse on the venue PC, touch on iPad):
//   left  — tournaments, filterable by state, plus a "Rotate all live" tile
//   right — the sets, each a list of its TVs, plus "Not in a set"
// Drop a tournament on a set's header → the whole set shows it. Drop it on
// one TV → that TV gets its own pick ("Follow set" undoes it). Drag a TV by
// its handle into another set. A TV is in at most one set. TD + manager.

import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useDisplayGroups, useDisplayScreens, useLiveTournaments } from '../../hooks/useDisplay'
import { displayGroups as displayGroupsApi, displayScreens as displayScreensApi } from '../../lib/firestore'
import {
  TOURNAMENT_FILTERS,
  displayableTournaments,
  pickerTournaments,
  planMoveScreen,
  planScreenOverride,
  resolveScreenConfig,
  slugifyScreenId,
} from '../../lib/display'
import StatusBadge from '../../components/StatusBadge'
import { EmptyState } from '../../components/FormFields'

const ROTATE_ALL = '__all__'
const NO_SET = '__none__'
const COLLAPSED_KEY = 'tvScreens.collapsed'

const SHOW_OPTIONS = [
  { value: '', label: 'Clock & prizes' },
  { value: 'clock', label: 'Clock only' },
  { value: 'prizes', label: 'Prizes only' },
]
const showLabel = (v) => SHOW_OPTIONS.find((o) => o.value === (v ?? '')).label

const screenUrl = (id) => `${window.location.origin}/display/${id}`

function startLabel(t) {
  const ms = t.scheduledStartTime?.toMillis?.()
  if (ms == null) return ''
  return new Date(ms).toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Drag ids are "<kind>:<id>". Tournament drags prefer the TV under the
// pointer (then its set); TV drags prefer the set (a TV dropped on another
// set's row joins that set). Exactly one target, so only it highlights.
const kindOf = (id) => String(id ?? '').split(':')[0]
const idOf = (id) => String(id ?? '').slice(kindOf(id).length + 1)

function collide(args) {
  const hits = pointerWithin(args)
  const list = hits.length ? hits : rectIntersection(args)
  const order = kindOf(args.active.id) === 'tour' ? ['screen', 'set'] : ['set', 'screen']
  for (const kind of order) {
    const hit = list.find((c) => kindOf(c.id) === kind)
    if (hit) return [hit]
  }
  return []
}

function readCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export default function Screens() {
  const { user } = useAuth()
  const toast = useToast()
  const { rows: screens, mockMode, error: screensError } = useDisplayScreens()
  const { rows: groups, error: groupsError } = useDisplayGroups()
  const { tournaments } = useLiveTournaments()

  const [filter, setFilter] = useState('active')
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggleCollapsed = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        /* storage unavailable — collapse just won't persist */
      }
      return next
    })

  // What the TVs would actually show right now (same rule as /display),
  // re-checked each minute so a start-day rollover is picked up.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const onFloorIds = useMemo(
    () => new Set(displayableTournaments(tournaments, nowMs).map((t) => t.id)),
    [tournaments, nowMs],
  )

  const tournamentsById = useMemo(() => Object.fromEntries((tournaments ?? []).map((t) => [t.id, t])), [tournaments])
  const groupsById = useMemo(() => Object.fromEntries((groups ?? []).map((g) => [g.id, g])), [groups])
  const screensById = useMemo(() => Object.fromEntries((screens ?? []).map((s) => [s.id, s])), [screens])

  // How many TVs show each pick (ROTATE_ALL for "rotate all live").
  const tvCounts = useMemo(() => {
    const counts = {}
    for (const s of screens ?? []) {
      const key = resolveScreenConfig(s, groupsById).tournamentId ?? ROTATE_ALL
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, [screens, groupsById])

  const pickName = (tournamentId) =>
    tournamentId == null ? 'Rotating all live' : (tournamentsById[tournamentId]?.name ?? 'Unknown tournament')

  const membersOf = (groupId) => (screens ?? []).filter((s) => s.groupId === groupId)
  // A TV whose set was deleted under it shows in "Not in a set".
  const ungrouped = (screens ?? []).filter((s) => !s.groupId || !groupsById[s.groupId])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // A short press-and-hold on iPad, so a normal swipe still scrolls.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor),
  )

  const run = async (promise, message) => {
    try {
      await promise
      if (message) toast.success(message)
    } catch (e) {
      toast.error(e.message)
    }
  }

  const onDragEnd = ({ active, over }) => {
    setActiveId(null)
    if (!over) return
    const dragKind = kindOf(active.id)
    const dragId = idOf(active.id)
    const overKind = kindOf(over.id)
    const overId = idOf(over.id)

    if (dragKind === 'tour') {
      const tournamentId = dragId === ROTATE_ALL ? null : dragId
      if (overKind === 'set' && overId !== NO_SET) {
        const g = groupsById[overId]
        if (!g || (g.tournamentId ?? null) === tournamentId) return
        run(
          displayGroupsApi.updateDisplayGroup(overId, { tournamentId }, user.uid),
          `${g.name} → ${pickName(tournamentId)}.`,
        )
      } else if (overKind === 'screen') {
        const s = screensById[overId]
        if (!s) return
        run(
          displayScreensApi.updateDisplayScreen(overId, planScreenOverride(s, groupsById, { tournamentId }), user.uid),
          `${s.name} → ${pickName(tournamentId)}.`,
        )
      }
      return
    }

    if (dragKind === 'tv') {
      const s = screensById[dragId]
      if (!s) return
      let target = overKind === 'set' ? overId : (screensById[overId]?.groupId ?? NO_SET)
      if (target !== NO_SET && !groupsById[target]) target = NO_SET
      const patch = planMoveScreen(s, target === NO_SET ? null : target, groupsById)
      if (!patch) return
      run(
        displayScreensApi.updateDisplayScreen(s.id, patch, user.uid),
        target === NO_SET ? `${s.name} is no longer in a set.` : `${s.name} moved to ${groupsById[target].name}.`,
      )
    }
  }

  const actions = {
    renameScreen: (s, name) => run(displayScreensApi.updateDisplayScreen(s.id, { name }, user.uid)),
    setScreenShow: (s, kind) =>
      run(
        displayScreensApi.updateDisplayScreen(s.id, planScreenOverride(s, groupsById, { screen: kind }), user.uid),
        `${s.name}: ${showLabel(kind).toLowerCase()}.`,
      ),
    followSet: (s) =>
      run(
        displayScreensApi.updateDisplayScreen(s.id, { followGroup: true }, user.uid),
        `${s.name} follows its set again.`,
      ),
    removeScreen: (s) => run(displayScreensApi.deleteDisplayScreen(s.id), `Removed ${s.name}.`),
    addScreen: (name, groupId) =>
      run(
        displayScreensApi.createDisplayScreen({ id: slugifyScreenId(name), name: name.trim(), groupId }, user.uid),
        `Added ${name.trim()}.`,
      ),
    renameSet: (g, name) => run(displayGroupsApi.updateDisplayGroup(g.id, { name }, user.uid)),
    setSetShow: (g, kind) =>
      run(
        displayGroupsApi.updateDisplayGroup(g.id, { screen: kind }, user.uid),
        `${g.name}: ${showLabel(kind).toLowerCase()}.`,
      ),
    removeSet: (g) =>
      run(
        displayGroupsApi.deleteDisplayGroup(g, membersOf(g.id), user.uid),
        `Removed ${g.name}. Its TVs keep showing what they were.`,
      ),
    addSet: (name) =>
      run(displayGroupsApi.createDisplayGroup({ name: name.trim() }, user.uid), `Added ${name.trim()}.`),
  }

  const takenIds = useMemo(() => new Set((screens ?? []).map((s) => s.id)), [screens])
  const shared = { groupsById, onFloorIds, pickName, actions, takenIds }

  const loading = screens === null || groups === null
  const error = screensError ?? groupsError

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl text-gold-400 mb-2">TV screens</h1>
      <p className="text-white/65 text-sm mb-6 max-w-3xl">
        Drag a tournament onto a set to put it on every TV in that set, or onto one TV to change just that one. Drag TVs
        by their handle (⋮⋮) to move them between sets. Open each TV&apos;s link on that TV once, signed in as the
        readonly account. It updates by itself from then on.
      </p>

      {mockMode ? (
        <EmptyState
          title="TV screens need live data."
          body="Use the Firestore emulator or production to manage screens."
        />
      ) : error && loading ? (
        <EmptyState title="Couldn't load screens." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-12 text-center text-white/55 text-sm">Loading…</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collide}
          onDragStart={({ active }) => setActiveId(active.id)}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={onDragEnd}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr] items-start">
            <TournamentPanel
              tournaments={pickerTournaments(tournaments, filter, search)}
              filter={filter}
              setFilter={setFilter}
              search={search}
              setSearch={setSearch}
              tvCounts={tvCounts}
              onFloorIds={onFloorIds}
            />

            <div className="space-y-4 min-w-0">
              <NewSetForm onAdd={actions.addSet} />
              {groups.map((g) => (
                <SetCard
                  key={g.id}
                  group={g}
                  members={membersOf(g.id)}
                  collapsed={collapsed.has(g.id)}
                  onToggle={() => toggleCollapsed(g.id)}
                  activeKind={kindOf(activeId)}
                  {...shared}
                />
              ))}
              <SetCard
                group={null}
                members={ungrouped}
                collapsed={collapsed.has(NO_SET)}
                onToggle={() => toggleCollapsed(NO_SET)}
                activeKind={kindOf(activeId)}
                {...shared}
              />
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeId ? (
              <div className="px-3 py-2 rounded-lg bg-felt-700 border border-gold-500/40 text-sm text-white/90 shadow-xl max-w-xs truncate">
                {kindOf(activeId) === 'tour'
                  ? idOf(activeId) === ROTATE_ALL
                    ? 'Rotate all live'
                    : tournamentsById[idOf(activeId)]?.name
                  : screensById[idOf(activeId)]?.name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}

// ── Left pane ──────────────────────────────────────────────────────────────

function TournamentPanel({ tournaments, filter, setFilter, search, setSearch, tvCounts, onFloorIds }) {
  return (
    <aside className="bg-felt-800 border border-white/5 rounded-lg p-4 lg:sticky lg:top-6 flex flex-col max-h-[60vh] lg:max-h-[calc(100vh-3rem)]">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">Tournaments</h3>
      <div className="flex flex-wrap gap-1 mb-2">
        {TOURNAMENT_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={
              'px-2.5 py-1 rounded-full text-[11px] font-medium ' +
              (filter === f.id ? 'bg-gold-500/20 text-gold-200' : 'bg-white/5 text-white/60 hover:bg-white/10')
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tournaments"
        aria-label="Search tournaments"
        className="w-full px-3 py-2 mb-3 rounded-lg text-sm bg-felt-900 border border-white/10 text-white/90"
      />
      <div className="space-y-2 overflow-y-auto -mr-2 pr-2">
        <TournamentTile
          id={ROTATE_ALL}
          title="Rotate all live"
          subtitle="Every tournament on the floor, in turn"
          tvCount={tvCounts[ROTATE_ALL]}
        />
        {tournaments.length === 0 ? (
          <p className="text-xs text-white/45 py-4 text-center">No tournaments match.</p>
        ) : (
          tournaments.map((t) => (
            <TournamentTile
              key={t.id}
              id={t.id}
              title={t.name}
              subtitle={startLabel(t)}
              status={t.status}
              tvCount={tvCounts[t.id]}
              offFloor={!onFloorIds.has(t.id)}
            />
          ))
        )}
      </div>
    </aside>
  )
}

function TournamentTile({ id, title, subtitle, status, tvCount, offFloor }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tour:${id}`,
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={
        'px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing select-none [touch-action:manipulation] ' +
        (isDragging ? 'opacity-40 ' : '') +
        (id === ROTATE_ALL
          ? 'bg-brand-500/10 border-brand-500/30'
          : 'bg-felt-900 border-white/10 hover:border-white/25')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-white/90 leading-snug">{title}</span>
        {status && <StatusBadge status={status} />}
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="text-[11px] text-white/50">
          {subtitle}
          {offFloor && status !== 'finished' ? ' · not on today' : ''}
        </span>
        {tvCount ? (
          <span className="text-[11px] text-gold-200/80 whitespace-nowrap">
            On {tvCount} TV{tvCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ── Right pane ─────────────────────────────────────────────────────────────

function NewSetForm({ onAdd }) {
  const [name, setName] = useState('')
  const submit = () => {
    if (!name.trim()) return
    onAdd(name)
    setName('')
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="New set, e.g. Main room"
        aria-label="New set name"
        className="w-64 px-3 py-2 rounded-lg text-sm bg-felt-900 border border-white/10 text-white/90"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!name.trim()}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 disabled:opacity-40"
      >
        + New set
      </button>
    </div>
  )
}

function SetCard({
  group,
  members,
  collapsed,
  onToggle,
  activeKind,
  groupsById,
  onFloorIds,
  pickName,
  actions,
  takenIds,
}) {
  const setId = group?.id ?? NO_SET
  const { setNodeRef, isOver } = useDroppable({ id: `set:${setId}` })
  const [confirmRemove, setConfirmRemove] = useState(false)
  // "Not in a set" takes TVs but has no pick of its own to drop a tournament on.
  const accepts = activeKind === 'tv' || (activeKind === 'tour' && group)
  const idle = group?.tournamentId && !onFloorIds.has(group.tournamentId)

  return (
    <section
      ref={setNodeRef}
      className={
        'rounded-lg border transition-colors ' +
        (isOver && accepts
          ? 'border-gold-400/70 bg-gold-500/5'
          : group
            ? 'border-white/5 bg-felt-800'
            : 'border-dashed border-white/10 bg-felt-800/50')
      }
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand set' : 'Collapse set'}
          aria-expanded={!collapsed}
          className="w-7 h-7 -ml-1 rounded flex items-center justify-center text-white/55 hover:bg-white/10"
        >
          <span className={'transition-transform ' + (collapsed ? '-rotate-90' : '')}>▾</span>
        </button>
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-baseline gap-2 flex-wrap">
            {group ? (
              <InlineName
                value={group.name}
                onSave={(n) => actions.renameSet(group, n)}
                className="font-display text-xl text-white/90"
              />
            ) : (
              <span className="font-display text-xl text-white/60">Not in a set</span>
            )}
            <span className="text-xs text-white/45">
              {members.length} TV{members.length === 1 ? '' : 's'}
            </span>
          </div>
          {group ? (
            <p className="text-sm text-gold-200/90">
              {pickName(group.tournamentId)}
              {idle ? (
                <span className="text-amber-200/80 text-xs"> · not on today, these TVs show the idle screen</span>
              ) : null}
            </p>
          ) : (
            <p className="text-xs text-white/45">Each TV here shows its own pick. Drag TVs into a set to group them.</p>
          )}
        </div>
        {group && (
          <div className="flex items-center gap-2">
            <ShowSelect
              value={group.screen}
              onChange={(v) => actions.setSetShow(group, v)}
              label={`${group.name} shows`}
            />
            {confirmRemove ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="px-2 py-2 text-xs text-white/55 hover:text-white/80"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => actions.removeSet(group)}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30"
                >
                  Remove set
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="px-2 py-2 text-xs text-white/45 hover:text-red-200"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </header>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-2">
          {members.length === 0 ? (
            <p className="text-xs text-white/40 border border-dashed border-white/10 rounded-lg py-4 text-center">
              {group ? 'Drag TVs here, or add one below.' : 'Every TV is in a set.'}
            </p>
          ) : (
            members.map((s) => (
              <ScreenRow
                key={s.id}
                screen={s}
                inSet={!!group}
                groupsById={groupsById}
                onFloorIds={onFloorIds}
                pickName={pickName}
                actions={actions}
              />
            ))
          )}
          <AddScreenForm groupId={group?.id ?? null} takenIds={takenIds} onAdd={actions.addScreen} />
        </div>
      )}
    </section>
  )
}

function ScreenRow({ screen, inSet, groupsById, onFloorIds, pickName, actions }) {
  const toast = useToast()
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({ id: `tv:${screen.id}` })
  const { setNodeRef: setDropRef, isOver, active } = useDroppable({ id: `screen:${screen.id}` })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const shows = resolveScreenConfig(screen, groupsById)
  const ownPick = inSet && shows.source === 'own'
  const idle = shows.tournamentId && !onFloorIds.has(shows.tournamentId)
  const url = screenUrl(screen.id)
  const isTourOver = isOver && kindOf(active?.id) === 'tour'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied.')
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.")
    }
  }

  return (
    <div
      ref={(node) => {
        setDragRef(node)
        setDropRef(node)
      }}
      className={
        'flex items-start gap-2 rounded-lg border px-2 py-2 ' +
        (isDragging ? 'opacity-40 ' : '') +
        (isTourOver ? 'border-gold-400/70 bg-gold-500/10' : 'border-white/10 bg-felt-900')
      }
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move ${screen.name}`}
        className="w-8 h-10 rounded flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 cursor-grab active:cursor-grabbing [touch-action:none]"
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-2 py-0.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-baseline gap-2 flex-wrap">
            <InlineName
              value={screen.name}
              onSave={(n) => actions.renameScreen(screen, n)}
              className="text-sm text-white/90"
            />
            <span className="text-[11px] font-mono text-white/40 break-all">/display/{screen.id}</span>
          </div>
          <div className="text-xs flex items-center gap-2 flex-wrap">
            <span className={ownPick || !inSet ? 'text-white/75' : 'text-white/50'}>
              {pickName(shows.tournamentId)}
            </span>
            {ownPick && (
              <>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 text-[10px] uppercase tracking-wider">
                  Own pick
                </span>
                <button
                  type="button"
                  onClick={() => actions.followSet(screen)}
                  className="text-[11px] text-gold-200 hover:underline"
                >
                  Follow set
                </button>
              </>
            )}
            {idle && <span className="text-amber-200/80">· not on today, idle screen</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ShowSelect
            value={shows.screen}
            onChange={(v) => actions.setScreenShow(screen, v)}
            label={`${screen.name} shows`}
            muted={inSet && !ownPick}
          />
          <button
            type="button"
            onClick={copy}
            className="px-2.5 py-2 rounded-lg text-xs whitespace-nowrap bg-white/5 text-white/70 hover:bg-white/10"
          >
            Copy link
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-2 rounded-lg text-xs whitespace-nowrap bg-white/5 text-white/70 hover:bg-white/10"
          >
            Preview
          </a>
          {confirmRemove ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="px-2 py-2 text-xs text-white/55 hover:text-white/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => actions.removeScreen(screen)}
                className="px-2.5 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30"
              >
                Remove TV
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="px-2 py-2 text-xs text-white/45 hover:text-red-200"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ShowSelect({ value, onChange, label, muted = false }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={label}
      className={
        'px-2 py-2 rounded-lg text-xs bg-felt-900 border border-white/10 ' + (muted ? 'text-white/50' : 'text-white/90')
      }
    >
      {SHOW_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function AddScreenForm({ groupId, takenIds, onAdd }) {
  const [name, setName] = useState('')
  const slug = slugifyScreenId(name)
  const taken = takenIds.has(slug)
  const ok = slug !== '' && !taken
  const submit = () => {
    if (!ok) return
    onAdd(name, groupId)
    setName('')
  }
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Add a TV, e.g. Bar TV"
        aria-label="New TV name"
        className="w-52 px-3 py-1.5 rounded-lg text-xs bg-felt-900 border border-white/10 text-white/90"
      />
      {name && (
        <span className={'text-[11px] font-mono ' + (taken ? 'text-amber-200/80' : 'text-white/45')}>
          {slug ? (taken ? `/display/${slug} is already in use` : `/display/${slug}`) : 'needs a letter or number'}
        </span>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!ok}
        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40"
      >
        + Add TV
      </button>
    </div>
  )
}

/** Click to rename; Enter or blur saves, Escape cancels. The TV's link never changes. */
function InlineName({ value, onSave, className }) {
  const [draft, setDraft] = useState(null)
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(value)}
        title="Rename"
        className={'text-left hover:underline decoration-white/30 ' + className}
      >
        {value}
      </button>
    )
  }
  const commit = () => {
    const next = draft.trim()
    setDraft(null)
    if (next && next !== value) onSave(next)
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          setDraft(null)
        }
      }}
      aria-label="Name"
      className={'bg-felt-900 border border-white/20 rounded px-1.5 py-0.5 ' + className}
    />
  )
}
