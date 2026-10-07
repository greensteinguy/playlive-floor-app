// TV screens (7 Oct 2026) — the venue's named TVs, managed from here.
//
// Each TV opens its permanent link (/display/<id>) once, signed in as the
// shared readonly account. From then on, what it shows — one tournament or a
// rotation of everything live; clock, prizes or both — is set on this page and
// lands on the TV live (it subscribes to its displayScreens doc). TD + manager.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useDisplayScreens, useLiveTournaments } from '../../hooks/useDisplay'
import { displayScreens as displayScreensApi } from '../../lib/firestore'
import { displayableTournaments, slugifyScreenId } from '../../lib/display'
import { EmptyState } from '../../components/FormFields'

// Tournaments worth assigning a TV to: anything not yet over.
const ASSIGNABLE_STATUSES = new Set(['scheduled', 'lateRegOpen', 'lateRegClosed'])

const SHOW_OPTIONS = [
  { value: '', label: 'Clock & prizes' },
  { value: 'clock', label: 'Clock only' },
  { value: 'prizes', label: 'Prizes only' },
]

const screenUrl = (id) => `${window.location.origin}/display/${id}`

function startLabel(t) {
  const ms = t.scheduledStartTime?.toMillis?.()
  if (ms == null) return ''
  return new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export default function Screens() {
  const { user } = useAuth()
  const toast = useToast()
  const { screens, mockMode, error } = useDisplayScreens()
  const { tournaments } = useLiveTournaments()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  const slug = slugifyScreenId(name)
  const taken = (screens ?? []).some((s) => s.id === slug)
  const canAdd = slug !== '' && !taken && !adding && !mockMode

  const assignable = useMemo(
    () =>
      (tournaments ?? [])
        .filter((t) => ASSIGNABLE_STATUSES.has(t.status))
        .sort((a, b) => (a.scheduledStartTime?.toMillis?.() ?? 0) - (b.scheduledStartTime?.toMillis?.() ?? 0)),
    [tournaments],
  )
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

  const add = async () => {
    if (!canAdd) return
    const submitted = name
    setAdding(true)
    try {
      await displayScreensApi.createDisplayScreen({ id: slug, name: submitted.trim() }, user.uid)
      // The field stays live while saving — only clear it if nobody typed on.
      setName((cur) => (cur === submitted ? '' : cur))
      toast.success(`Added ${submitted.trim()}.`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl text-gold-400 mb-2">TV screens</h1>
      <p className="text-white/65 text-sm mb-6 max-w-3xl">
        Give each TV in the venue a name and open its link on that TV once, signed in as the readonly account. After
        that, change what it shows here. The TV updates by itself within a second or two.
      </p>

      <section className="mb-8">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">Add a screen</h3>
        <div className="bg-felt-800 border border-white/5 rounded-lg p-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            disabled={mockMode}
            placeholder="e.g. Bar TV"
            aria-label="Screen name"
            className="w-64 px-3 py-2 rounded-lg text-sm bg-felt-900 border border-white/10 text-white/90 disabled:opacity-40"
          />
          <span className="text-xs font-mono text-white/55">
            {slug ? (
              taken ? (
                <span className="text-amber-200/80">/display/{slug} is already in use</span>
              ) : (
                <>/display/{slug}</>
              )
            ) : (
              'Link appears here'
            )}
          </span>
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="ml-auto px-4 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 disabled:opacity-40"
          >
            {adding ? 'Adding…' : '+ Add screen'}
          </button>
        </div>
      </section>

      {mockMode ? (
        <EmptyState title="TV screens need live data." body="Use the Firestore emulator or production to manage screens." />
      ) : error && screens === null ? (
        <EmptyState title="Couldn't load screens." body={error.message} tone="error" />
      ) : screens === null ? (
        <div className="py-12 text-center text-white/55 text-sm">Loading…</div>
      ) : screens.length === 0 ? (
        <EmptyState title="No TV screens yet." body="Add one above, then open its link on the TV." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {screens.map((s) => (
            <ScreenCard
              key={s.id}
              screen={s}
              assignable={assignable}
              tournaments={tournaments ?? []}
              onFloorIds={onFloorIds}
              actorId={user.uid}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ScreenCard({ screen, assignable, tournaments, onFloorIds, actorId }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const url = screenUrl(screen.id)

  const assigned = screen.tournamentId ? tournaments.find((t) => t.id === screen.tournamentId) : null
  // Keep the current pick selectable even after it finishes, so the select
  // never silently shows the wrong value.
  const options =
    screen.tournamentId && !assignable.some((t) => t.id === screen.tournamentId)
      ? [...assignable, assigned ?? { id: screen.tournamentId, name: 'Unknown tournament', missing: true }]
      : assignable
  const idleWarning =
    screen.tournamentId && !onFloorIds.has(screen.tournamentId)
      ? assigned
        ? `${assigned.name} isn't on the floor right now, so this TV shows the idle screen.`
        : "The assigned tournament no longer exists, so this TV shows the idle screen."
      : null

  const save = async (patch, message) => {
    setBusy(true)
    try {
      await displayScreensApi.updateDisplayScreen(screen.id, patch, actorId)
      toast.success(message)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied.')
    } catch {
      toast.error("Couldn't copy — select the link and copy it by hand.")
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await displayScreensApi.deleteDisplayScreen(screen.id)
      toast.success(`Removed ${screen.name}.`)
    } catch (e) {
      toast.error(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl text-white/90">{screen.name}</h2>
          <p className="text-xs font-mono text-white/55 break-all select-all">{url}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={copy}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10"
          >
            Copy link
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10"
          >
            Preview
          </a>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[10px] font-mono uppercase tracking-widest text-white/55 mb-1">Tournament</span>
          <select
            value={screen.tournamentId ?? ''}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value || null
              const label = id ? options.find((t) => t.id === id)?.name : 'all live tournaments'
              save({ tournamentId: id }, `${screen.name} now shows ${label}.`)
            }}
            className="w-full px-3 py-2 rounded-lg text-sm bg-felt-900 border border-white/10 text-white/90 disabled:opacity-40"
          >
            <option value="">All live tournaments (rotate)</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.missing ? '' : ` — ${startLabel(t)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-mono uppercase tracking-widest text-white/55 mb-1">Show</span>
          <select
            value={screen.screen ?? ''}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value || null
              save({ screen: v }, `${screen.name}: ${SHOW_OPTIONS.find((o) => o.value === (v ?? '')).label.toLowerCase()}.`)
            }}
            className="w-full px-3 py-2 rounded-lg text-sm bg-felt-900 border border-white/10 text-white/90 disabled:opacity-40"
          >
            {SHOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {idleWarning && <p className="text-[11px] text-amber-200/80">{idleWarning}</p>}

      <div className="flex justify-end gap-2">
        {confirmRemove ? (
          <>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-xs font-medium text-white/55 hover:text-white/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-40"
            >
              Remove {screen.name} — its TV will show &quot;Screen not set up&quot;
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-xs font-medium text-white/45 hover:text-red-200"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
