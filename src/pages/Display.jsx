// Venue TV display (Phase 5, tasks 5.1–5.3) at /display.
//
// A read-only, full-screen rotation for the tournament TVs: per displayable
// tournament, a blind-countdown screen and a prize-pool screen, crossfading
// on a timer; multiple live tournaments rotate through the same deck. The
// stats screen is v1.5+ (SOW v0.5) — deliberately absent.
//
// The clock face DERIVES level + countdown from the session's anchor fields
// (lib/clock.js) with a local 250ms tick, exactly like the TD control screen —
// no per-tick writes, and every TV showing the same anchor shows the same
// time. Read-only means no optimistic anchor machinery: the server session is
// the only source, so nothing here can snap the countdown (see
// [[clock-time-is-gospel]] — the smoothness risk only exists around writes).
//
// Auth: the route requires a signed-in user (any role — TVs use the shared
// readonly account) but renders OUTSIDE the AppShell, so no sidebar chrome.
// Pinning for dedicated TVs via query params:
//   /display?tournamentId=<id>   only that tournament
//   /display?screen=clock        only that screen kind
//
// Dev note: with VITE_USE_MOCK_DATA=true this page shows a "needs live data"
// notice (same rule as the TD clock).

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveTournaments, useSessionsByTournament } from '../hooks/useDisplay'
import {
  deriveClock,
  formatRemaining,
  clockSliceEndIndex,
  CLOCK_PAUSED,
  CLOCK_STOPPED,
} from '../lib/clock'
import {
  displayableTournaments,
  pickDisplaySession,
  buildSlides,
  slideDurationMs,
  nextSlideIndex,
  displayCounters,
  msUntilStart,
  formatStartTime,
  formatUntilStart,
  formatDisplayMoney,
} from '../lib/display'
import { materializePayouts } from '../lib/payouts'

const TICK_MS = 250
const CROSSFADE_MS = 700

function ordinal(place) {
  const mod100 = place % 100
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] ?? 'th'
  return `${place}${suffix}`
}

function entryLabel(entry) {
  if (!entry) return ''
  if (entry.type === 'break') return entry.label || 'Break'
  return `Level ${entry.blindNumber}`
}

function entryBlinds(entry) {
  if (!entry || entry.type !== 'level') return null
  return `${entry.smallBlind.toLocaleString()} / ${entry.bigBlind.toLocaleString()}`
}

export default function Display() {
  const [params] = useSearchParams()
  const { tournaments, mockMode } = useLiveTournaments()

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Keep the TV awake (best-effort; silently unsupported on older browsers).
  useEffect(() => {
    let lock = null
    let disposed = false
    const acquire = async () => {
      try {
        if (!disposed && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock?.request('screen')
        }
      } catch {
        /* denied/unsupported — non-fatal */
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', acquire)
      lock?.release?.().catch(() => {})
    }
  }, [])

  // The rotation set. Bucketed to the minute so the day-boundary/starts-passed
  // checks don't recompute the deck 4×/second.
  const nowMinute = Math.floor(nowMs / 60_000)
  const displayable = useMemo(
    () => displayableTournaments(tournaments, nowMinute * 60_000),
    [tournaments, nowMinute],
  )
  const sessionIds = useMemo(() => displayable.map((t) => t.id), [displayable])
  const sessionsBy = useSessionsByTournament(sessionIds)

  const pinnedTournamentId = params.get('tournamentId')
  const pinnedScreen = params.get('screen')
  const slides = useMemo(
    () => buildSlides(displayable, { tournamentId: pinnedTournamentId, screen: pinnedScreen }),
    [displayable, pinnedTournamentId, pinnedScreen],
  )

  // Rotation. A deck-shape change resets the index during render (React's
  // sanctioned adjust-state-on-prop-change pattern — no effect round-trip);
  // modulo clamps so a shrinking deck never strands us.
  const slidesKey = slides.map((s) => `${s.tournamentId}:${s.screen}`).join('|')
  const [slideIndex, setSlideIndex] = useState(0)
  const [deckKey, setDeckKey] = useState(slidesKey)
  if (deckKey !== slidesKey) {
    setDeckKey(slidesKey)
    setSlideIndex(0)
  }
  const safeIndex = slides.length > 0 ? slideIndex % slides.length : 0
  const slide = slides.length > 0 ? slides[safeIndex] : null
  useEffect(() => {
    if (slides.length <= 1) return undefined
    const t = setTimeout(
      () => setSlideIndex((i) => nextSlideIndex(i, slides.length)),
      slideDurationMs(slides[safeIndex]),
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex, slidesKey])

  // Crossfade layers: the current slide fades in over the outgoing one, which
  // unmounts once the fade completes. At most two layers ever exist. The push
  // happens during render (same pattern as above); the trim is timer-driven.
  const slideKey = slide ? `${slide.tournamentId}:${slide.screen}` : 'idle'
  const [layers, setLayers] = useState([{ key: slideKey, slide }])
  if (layers[layers.length - 1]?.key !== slideKey) {
    setLayers([...layers.slice(-1), { key: slideKey, slide }])
  }
  useEffect(() => {
    if (layers.length <= 1) return undefined
    const t = setTimeout(() => setLayers((prev) => prev.slice(-1)), CROSSFADE_MS)
    return () => clearTimeout(t)
  }, [layers])

  const timeOfDay = new Date(nowMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  if (mockMode) {
    return (
      <FullScreen timeOfDay={timeOfDay}>
        <div className="text-center max-w-xl mx-auto">
          <h1 className="font-display text-3xl text-gold-300 mb-3">Display needs live data</h1>
          <p className="text-white/50">
            The venue display runs against real tournament data. Switch off pure-mock mode (use the
            Firestore emulator or production) to drive it.
          </p>
        </div>
      </FullScreen>
    )
  }

  if (tournaments === null) {
    return (
      <FullScreen timeOfDay={timeOfDay}>
        <p className="text-white/40 font-mono uppercase tracking-[0.3em]">Connecting…</p>
      </FullScreen>
    )
  }

  return (
    <FullScreen timeOfDay={timeOfDay} rotation={slides.length > 1 ? { index: safeIndex, count: slides.length } : null}>
      {layers.map((layer, i) => {
        const isTop = i === layers.length - 1
        const t = layer.slide ? displayable.find((x) => x.id === layer.slide.tournamentId) : null
        return (
          <div
            key={layer.key}
            className={
              'absolute inset-0 flex items-center justify-center px-[4vw] py-[6vh] ' +
              (isTop ? 'display-fade-in' : 'display-fade-out pointer-events-none')
            }
          >
            {!layer.slide || !t ? (
              <IdleScreen />
            ) : layer.slide.screen === 'prizes' ? (
              <PrizesSlide tournament={t} />
            ) : (
              <ClockSlide tournament={t} sessions={sessionsBy[t.id]} nowMs={nowMs} />
            )}
          </div>
        )
      })}
    </FullScreen>
  )
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function FullScreen({ timeOfDay, rotation, children }) {
  return (
    <div className="fixed inset-0 overflow-hidden text-white font-body select-none">
      {/* brand + clock-of-day, kept clear of the slide content */}
      <div className="absolute top-[3vh] left-[4vw] right-[4vw] flex items-baseline justify-between z-10">
        <span className="font-brand text-[2.2vh] tracking-[0.22em] text-brand-400 [text-shadow:0_0_20px_rgba(239,43,43,0.55)]">
          PLAYLIVE
        </span>
        <span className="font-display text-[2.6vh] text-white/60 tabular-nums">{timeOfDay}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      {rotation && (
        <div className="absolute bottom-[2.5vh] left-0 right-0 flex justify-center gap-2 z-10">
          {Array.from({ length: rotation.count }, (_, i) => (
            <span
              key={i}
              className={
                'h-[0.8vh] w-[0.8vh] rounded-full ' +
                (i === rotation.index ? 'bg-brand-400' : 'bg-white/15')
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function IdleScreen() {
  return (
    <div className="text-center">
      <div className="font-brand text-[6vh] tracking-[0.3em] text-brand-400 [text-shadow:0_0_40px_rgba(239,43,43,0.5)] mb-[2vh]">
        PLAYLIVE
      </div>
      <p className="font-mono uppercase tracking-[0.4em] text-[1.8vh] text-white/35">
        No tournaments on the floor
      </p>
    </div>
  )
}

function CounterStrip({ tournament }) {
  const { entries, remaining, reentries, avgStack } = displayCounters(tournament)
  const cells = [
    ['Entries', entries.toLocaleString()],
    ['Remaining', remaining.toLocaleString()],
    ['Re-entries', reentries.toLocaleString()],
    ['Avg stack', avgStack != null ? avgStack.toLocaleString() : '—'],
    ['Prize pool', formatDisplayMoney(tournament.totalPrizePool)],
  ]
  return (
    <div className="flex justify-center gap-[3vw] mt-[4vh]">
      {cells.map(([label, value]) => (
        <div key={label} className="text-center">
          <div className="font-mono uppercase tracking-[0.25em] text-[1.4vh] text-white/35 mb-[0.6vh]">{label}</div>
          <div className="font-display text-[3.4vh] text-white/90 tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  )
}

/* ── Blind countdown ─────────────────────────────────────────────────────── */

function ClockSlide({ tournament, sessions, nowMs }) {
  const session = pickDisplaySession(sessions)
  const multiSession = (sessions ?? []).filter((s) => s.status !== 'cancelled').length > 1
  const derived = session ? deriveClock(session, tournament.structure, nowMs) : null

  // Hero resolution mirrors the TD clock screen (TournamentClock.jsx): the
  // not-started preview shows the session's real first level, finished shows
  // where it ended, running/paused show the derived live entry.
  let badge
  let badgeTone
  let heroIndex
  let heroRemainingMs
  if (!session) {
    badge = 'STARTS SOON'
    badgeTone = 'text-sky-300'
    heroIndex = null
    heroRemainingMs = null
  } else if (session.status === 'finished') {
    badge = 'FINISHED'
    badgeTone = 'text-white/40'
    heroIndex = session.actualEndIndex ?? session.maximumStartIndex
    heroRemainingMs = 0
  } else if (derived.state === CLOCK_STOPPED) {
    badge = 'STARTS SOON'
    badgeTone = 'text-sky-300'
    heroIndex = session.maximumStartIndex
    heroRemainingMs = (tournament.structure[heroIndex]?.durationMinutes ?? 0) * 60_000
  } else if (derived.isComplete) {
    badge = 'LEVEL COMPLETE'
    badgeTone = 'text-amber-300'
    heroIndex = derived.currentIndex
    heroRemainingMs = 0
  } else {
    badge = derived.state === CLOCK_PAUSED ? 'PAUSED' : 'RUNNING'
    badgeTone = derived.state === CLOCK_PAUSED ? 'text-amber-300' : 'text-emerald-300'
    heroIndex = derived.currentIndex
    heroRemainingMs = derived.remainingMs
  }

  const heroEntry = heroIndex != null ? tournament.structure[heroIndex] ?? null : null
  const sliceEnd = session ? clockSliceEndIndex(session, tournament.structure.length) : -1
  const heroNext = heroIndex != null && heroIndex + 1 <= sliceEnd ? tournament.structure[heroIndex + 1] : null
  const onBreak = heroEntry?.type === 'break'
  const startTime = formatStartTime(tournament)
  const untilStart = formatUntilStart(msUntilStart(tournament, nowMs))
  const progress =
    derived && derived.levelDurationMs > 0 && badge !== 'STARTS SOON'
      ? Math.min(1, derived.elapsedInLevelMs / derived.levelDurationMs)
      : 0

  return (
    <div className="text-center w-full max-w-[92vw]">
      <div className="font-display text-[4.2vh] text-gold-300 mb-[1vh] truncate">{tournament.name}</div>
      <div className={'font-mono uppercase tracking-[0.35em] text-[1.8vh] mb-[3vh] ' + badgeTone}>
        {badge}
        {multiSession && session ? ` · ${session.sessionLabel}` : ''}
      </div>

      {heroEntry ? (
        <>
          <div className="font-display text-[3vh] text-white/60 mb-[0.5vh]">{entryLabel(heroEntry)}</div>
          {onBreak ? (
            <div className="font-display text-[9vh] leading-tight text-sky-200">Break</div>
          ) : (
            <div className="font-display text-[9vh] leading-tight text-white tabular-nums">
              {entryBlinds(heroEntry)}
            </div>
          )}
          {!onBreak && heroEntry.ante > 0 && (
            <div className="text-white/50 text-[2.6vh]">ante {heroEntry.ante.toLocaleString()}</div>
          )}
          <div className="font-display text-[22vh] leading-none text-white tabular-nums my-[2vh]">
            {formatRemaining(heroRemainingMs)}
          </div>
          {/* level progress */}
          <div className="mx-auto w-[46vw] h-[0.5vh] rounded-full bg-white/10 overflow-hidden mb-[2vh]">
            <div
              className="h-full bg-gradient-to-r from-brand-500 to-brand-400 transition-[width] duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-white/40 text-[2.2vh]">
            {heroNext
              ? `Next: ${heroNext.type === 'break' ? entryLabel(heroNext) : entryBlinds(heroNext)}`
              : 'Final level'}
          </div>
        </>
      ) : (
        <>
          {startTime && (
            <div className="font-display text-[16vh] leading-none text-white tabular-nums my-[3vh]">{startTime}</div>
          )}
          <div className="text-white/50 text-[2.6vh]">{untilStart ?? 'Registration at the desk'}</div>
        </>
      )}

      <CounterStrip tournament={tournament} />
    </div>
  )
}

/* ── Prize pool ──────────────────────────────────────────────────────────── */

function PrizesSlide({ tournament }) {
  const payouts = useMemo(() => {
    if (!tournament.payoutStructure || tournament.totalPrizePool <= 0) return []
    try {
      return materializePayouts(tournament.payoutStructure, tournament.totalPrizePool)
    } catch {
      return [] // a malformed structure must never take down the TV
    }
  }, [tournament.payoutStructure, tournament.totalPrizePool])
  const shown = payouts.slice(0, 9)
  const guaranteed = tournament.guarantee > 0

  return (
    <div className="text-center w-full max-w-[92vw]">
      <div className="font-display text-[4.2vh] text-gold-300 mb-[1vh] truncate">{tournament.name}</div>
      <div className="font-mono uppercase tracking-[0.35em] text-[1.8vh] text-white/40 mb-[3vh]">Prize pool</div>

      <div className="font-display text-[16vh] leading-none text-white tabular-nums">
        {formatDisplayMoney(tournament.totalPrizePool)}
      </div>
      {guaranteed && (
        <div className="text-[2.4vh] text-brand-300 mt-[1vh]">
          {formatDisplayMoney(tournament.guarantee)} guaranteed
        </div>
      )}

      {shown.length > 0 && (
        <div
          className={
            'mx-auto mt-[4vh] grid gap-x-[4vw] gap-y-[1.2vh] w-fit ' +
            (shown.length > 5 ? 'grid-cols-2' : 'grid-cols-1')
          }
        >
          {shown.map(({ place, amount }) => (
            <div key={place} className="flex items-baseline gap-[1.5vw] justify-between">
              <span className="font-mono uppercase tracking-[0.2em] text-[2vh] text-white/45">{ordinal(place)}</span>
              <span className="font-display text-[3.4vh] text-white/90 tabular-nums">
                {formatDisplayMoney(amount)}
              </span>
            </div>
          ))}
          {payouts.length > shown.length && (
            <div className="col-span-full font-mono text-[1.6vh] text-white/30 uppercase tracking-[0.25em]">
              {payouts.length - shown.length} more places paid
            </div>
          )}
        </div>
      )}

      <CounterStrip tournament={tournament} />
    </div>
  )
}
