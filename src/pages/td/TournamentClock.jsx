// TD clock control screen (task 2.6) at /td/tournaments/:id/clock.
//
// The TD's own big, cross-the-room clock + the controls to drive it. It mirrors
// the live server state via useClock (a real-time subscription to the session +
// tournament) and derives the blind level + countdown locally, so the level
// auto-advances at zero with no writes. Controls (start / pause / resume /
// advance / rewind / finish) are gated to manager + TD; everyone else sees the
// clock read-only. The player-facing TV display (a static-URL, read-only mirror
// of this same state) is Phase 5 — this screen is the operator console.
//
// For a multi-day / multi-flight tournament there are several sessions; a picker
// chooses which one's clock to run (defaulting to one in progress, else the
// earliest). The clock runs per session.

import { useEffect, useReducer, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useClock } from '../../hooks/useClock'
import { sessions as sessionsApi, MockModeError } from '../../lib/firestore'
import { formatRemaining, clockSliceEndIndex, CLOCK_RUNNING, CLOCK_PAUSED, CLOCK_STOPPED } from '../../lib/clock'
import { formatMoney } from '../../lib/money'
import { TournamentError } from '../../lib/tournaments'

// A short ascending beep on each level change (auto-advance or manual). Wrapped
// so a browser without Web Audio (or an autoplay block) never breaks the clock.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.08
    osc.start()
    osc.stop(ctx.currentTime + 0.18)
    osc.onended = () => ctx.close()
  } catch {
    /* audio unavailable — non-fatal */
  }
}

function entryBlinds(entry) {
  if (!entry || entry.type !== 'level') return null
  return `${entry.smallBlind.toLocaleString()} / ${entry.bigBlind.toLocaleString()}`
}

function entryLabel(entry) {
  if (!entry) return ''
  if (entry.type === 'break') return entry.label || 'Break'
  return `Level ${entry.blindNumber}`
}

// The one-shot session list for the picker (loaded once per tournament id).
// A reducer keeps state changes out of the effect body (the active clock is live
// via useClock; this only needs to be fresh enough to pick a session).
const INITIAL_SESSIONS = { list: null, mock: false }
function sessionsReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return INITIAL_SESSIONS
    case 'LOADED':
      return { list: action.list, mock: false }
    case 'MOCK':
      return { list: null, mock: true }
    case 'EMPTY':
      return { list: [], mock: false }
    default:
      return state
  }
}

export default function TournamentClock() {
  const { id } = useParams()
  const { role } = useAuth()
  const toast = useToast()
  const canControl = role === 'manager' || role === 'td'

  // One-shot session list (for the picker). The active session's clock is live
  // via useClock; this list only needs to be fresh enough to choose a session.
  const [sx, sxDispatch] = useReducer(sessionsReducer, INITIAL_SESSIONS)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    sxDispatch({ type: 'RESET' })
    sessionsApi
      .listSessions(id)
      .then((list) => {
        if (cancelled) return
        const sorted = [...list].sort(
          (a, b) => a.dayNumber - b.dayNumber || (a.flightLabel || '').localeCompare(b.flightLabel || ''),
        )
        sxDispatch({ type: 'LOADED', list: sorted })
        const active = sorted.find((s) => s.status === 'inProgress') || sorted[0]
        setSelectedId(active?.id ?? null)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) sxDispatch({ type: 'MOCK' })
        else sxDispatch({ type: 'EMPTY' })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const clock = useClock(id, selectedId)
  const { tournament, session, derived, actions } = clock

  const [busy, setBusy] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : e?.message || 'Clock action failed')
    } finally {
      setBusy(false)
    }
  }

  // Beep on level change while running.
  const prevIdx = useRef(null)
  useEffect(() => {
    if (!derived) return
    const idx = derived.currentIndex
    if (prevIdx.current !== null && idx !== null && idx !== prevIdx.current && derived.state === CLOCK_RUNNING) {
      beep()
    }
    prevIdx.current = idx
  }, [derived])

  if (sx.mock || clock.mockMode) {
    return (
      <Shell id={id}>
        <Notice title="Clock needs live data">
          The clock runs against real session data. Switch off pure-mock mode (use the Firestore emulator or
          production) to drive it.
        </Notice>
      </Shell>
    )
  }
  if (sx.list === null || (selectedId && clock.loading)) {
    return (
      <Shell id={id}>
        <p className="text-white/65">Loading clock…</p>
      </Shell>
    )
  }
  if (sx.list.length === 0) {
    return (
      <Shell id={id}>
        <Notice title="No sessions">This tournament has no sessions to run a clock against.</Notice>
      </Shell>
    )
  }
  if (clock.notFound) {
    return (
      <Shell id={id}>
        <Notice title="Session not found">The selected session no longer exists.</Notice>
      </Shell>
    )
  }
  if (!clock.ready || !tournament || !session || !derived) {
    return (
      <Shell id={id}>
        <p className="text-white/65">Loading clock…</p>
      </Shell>
    )
  }

  const st = derived.state
  const isFinished = session.status === 'finished'

  // Resolve the hero display (badge + the level/break index + countdown to show
  // big). heroIndex drives both the current entry and the "next" preview, so the
  // not-started preview shows the real upcoming level (not derived.nextEntry,
  // which is null while the clock is stopped).
  let badge
  let heroIndex
  let heroRemainingMs
  if (isFinished) {
    badge = 'FINISHED'
    heroIndex = session.actualEndIndex ?? session.maximumStartIndex
    heroRemainingMs = 0
  } else if (st === CLOCK_STOPPED) {
    badge = 'NOT STARTED'
    heroIndex = session.maximumStartIndex
    heroRemainingMs = (tournament.structure[heroIndex]?.durationMinutes ?? 0) * 60_000
  } else if (derived.isComplete) {
    badge = 'LEVEL COMPLETE'
    heroIndex = derived.currentIndex
    heroRemainingMs = 0
  } else {
    badge = st === CLOCK_PAUSED ? 'PAUSED' : 'RUNNING'
    heroIndex = derived.currentIndex
    heroRemainingMs = derived.remainingMs
  }

  const heroEntry = heroIndex != null ? tournament.structure[heroIndex] ?? null : null
  const sliceEnd = clockSliceEndIndex(session, tournament.structure.length)
  const heroNext = heroIndex != null && heroIndex + 1 <= sliceEnd ? tournament.structure[heroIndex + 1] : null

  const onBreak = heroEntry?.type === 'break'
  const blinds = entryBlinds(heroEntry)
  const reentries = Math.max(0, tournament.entryCount - tournament.uniquePlayerCount)
  const avgStack =
    tournament.remainingPlayerCount > 0
      ? Math.round((tournament.entryCount * tournament.startingStack) / tournament.remainingPlayerCount)
      : null

  const badgeColor =
    badge === 'RUNNING'
      ? 'text-emerald-300'
      : badge === 'PAUSED'
        ? 'text-amber-300'
        : badge === 'FINISHED'
          ? 'text-white/55'
          : 'text-sky-300'

  return (
    <Shell id={id}>
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <h1 className="font-display text-xl md:text-2xl text-gold-400">{tournament.name}</h1>
        {sx.list.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {sx.list.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={
                  'text-xs px-3 py-1.5 rounded-lg border ' +
                  (s.id === selectedId
                    ? 'bg-gold-500/20 border-gold-500/40 text-gold-100'
                    : 'bg-felt-900 border-white/10 text-white/70 hover:bg-white/5')
                }
              >
                {s.sessionLabel}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The clock face */}
      <div className="bg-felt-900 border border-white/10 rounded-2xl px-6 py-10 text-center">
        <div className={'font-mono uppercase tracking-[0.3em] text-sm mb-4 ' + badgeColor}>
          {badge} · {session.sessionLabel}
        </div>

        <div className="text-gold-300/80 font-display text-2xl md:text-3xl mb-1">
          {onBreak ? entryLabel(heroEntry) : `${entryLabel(heroEntry)}`}
        </div>

        {onBreak ? (
          <div className="font-display text-5xl md:text-7xl text-sky-200 mb-2">Break</div>
        ) : (
          <div className="font-display text-6xl md:text-8xl text-white mb-2 tabular-nums">{blinds ?? '—'}</div>
        )}
        {!onBreak && heroEntry?.ante > 0 && (
          <div className="text-white/65 text-lg md:text-xl mb-2">ante {heroEntry.ante.toLocaleString()}</div>
        )}

        <div className="font-display text-7xl md:text-[10rem] leading-none text-white tabular-nums my-4">
          {formatRemaining(heroRemainingMs)}
        </div>

        {heroNext ? (
          <div className="text-white/55 text-sm">
            Next: {heroNext.type === 'break' ? entryLabel(heroNext) : entryBlinds(heroNext)}
          </div>
        ) : (
          <div className="text-white/45 text-sm">Final level of this session</div>
        )}
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
        <Stat label="Entries" value={tournament.entryCount} />
        <Stat label="Remaining" value={tournament.remainingPlayerCount} />
        <Stat label="Re-entries" value={reentries} />
        <Stat label="Prize pool" value={formatMoney(tournament.totalPrizePool)} />
        <Stat label="Avg stack" value={avgStack != null ? avgStack.toLocaleString() : '—'} />
      </div>

      {/* Controls */}
      {canControl ? (
        <div className="flex flex-wrap items-center gap-3 mt-6">
          {st === CLOCK_STOPPED && !isFinished && (
            <Ctrl onClick={() => run(actions.start)} disabled={busy} primary>
              ▶ Start clock
            </Ctrl>
          )}
          {st === CLOCK_RUNNING && (
            <Ctrl onClick={() => run(actions.pause)} disabled={busy}>
              ❙❙ Pause
            </Ctrl>
          )}
          {st === CLOCK_PAUSED && (
            <Ctrl onClick={() => run(actions.resume)} disabled={busy} primary>
              ▶ Resume
            </Ctrl>
          )}
          {(st === CLOCK_RUNNING || st === CLOCK_PAUSED) && (
            <>
              <Ctrl onClick={() => run(actions.rewind)} disabled={busy}>
                ◀ Back
              </Ctrl>
              <Ctrl onClick={() => run(actions.advance)} disabled={busy}>
                Advance ▶
              </Ctrl>
              {confirmFinish ? (
                <>
                  <Ctrl
                    onClick={() => {
                      setConfirmFinish(false)
                      run(actions.finish)
                    }}
                    disabled={busy}
                    danger
                  >
                    Confirm finish
                  </Ctrl>
                  <Ctrl onClick={() => setConfirmFinish(false)} disabled={busy}>
                    Cancel
                  </Ctrl>
                </>
              ) : (
                <Ctrl onClick={() => setConfirmFinish(true)} disabled={busy}>
                  Finish session
                </Ctrl>
              )}
            </>
          )}
          {isFinished && <p className="text-white/55 text-sm">This session has finished.</p>}
        </div>
      ) : (
        <p className="text-white/55 text-sm mt-6">Read-only — a manager or TD controls the clock.</p>
      )}
    </Shell>
  )
}

function Shell({ id, children }) {
  return (
    <div className=" mx-auto px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Link to={`/td/tournaments/${id}`} className="text-sm text-white/65 hover:text-white">
          ← Back to tournament
        </Link>
        {/* The venue TV view, pinned to this tournament — opened on the TV's
            browser (or for a quick check from the floor). */}
        <a
          href={`/display?tournamentId=${id}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-white/65 hover:text-white"
        >
          TV display ↗
        </a>
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg px-3 py-2 text-center">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/45">{label}</div>
      <div className="text-lg text-white/90 tabular-nums">{value}</div>
    </div>
  )
}

function Ctrl({ onClick, disabled, primary, danger, children }) {
  const tone = danger
    ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30 border-red-500/30'
    : primary
      ? 'bg-gold-500/20 text-gold-100 hover:bg-gold-500/30 border-gold-500/40'
      : 'bg-white/5 text-white/80 hover:bg-white/10 border-white/10'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={'px-5 py-3 rounded-lg border text-base font-medium disabled:opacity-40 disabled:cursor-not-allowed ' + tone}
    >
      {children}
    </button>
  )
}

function Notice({ title, children }) {
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg px-5 py-8 text-center">
      <h2 className="font-display text-xl text-gold-300 mb-2">{title}</h2>
      <p className="text-white/65 text-sm max-w-md mx-auto">{children}</p>
    </div>
  )
}
