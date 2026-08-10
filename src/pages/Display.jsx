// Venue TV display (Phase 5, tasks 5.1–5.3; v2 pass per docs/display-design-notes.md).
//
// A read-only, full-screen rotation for the tournament TVs: per displayable
// tournament, a blind-countdown screen and a prize-pool screen, crossfading
// on a timer; multiple live tournaments rotate through the same deck. The
// stats screen is v1.5+ (SOW v0.5) — deliberately absent.
//
// v2 additions (all stage-aware, all degrade to nothing rather than a gap):
//   - segmented level track under the progress bar (levels until next break)
//   - final-minute warning state + level-change pulse on the blinds row
//   - break mode: cool-toned full-screen shift with a "back at H:MM" line
//   - late-reg slot (closes-in countdown → "registration closed · paying N")
//   - bottom ticker strip (payouts, guarantee, late-reg/buy-in info)
//   - total chips in the counter strip; prizes slide sits out while pool is $0
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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveTournaments, useSessionsByTournament } from '../hooks/useDisplay'
import {
  deriveClock,
  formatRemaining,
  clockSliceEndIndex,
  CLOCK_PAUSED,
  CLOCK_RUNNING,
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
  formatWallTime,
  levelTrackSegment,
  msUntilLateRegClose,
  msUntilNextBreak,
  formatCloseIn,
  tickerItems,
  ordinalPlace,
} from '../lib/display'
import { materializePayouts } from '../lib/payouts'

const TICK_MS = 250
const CROSSFADE_MS = 700
const FINAL_MINUTE_MS = 60_000
const LEVEL_TRACK_MAX_BLOCKS = 14

function entryLabel(entry) {
  if (!entry) return ''
  if (entry.type === 'break') return entry.label || 'Break'
  return `Level ${entry.blindNumber}`
}

function entryBlinds(entry) {
  if (!entry || entry.type !== 'level') return null
  return `${entry.smallBlind.toLocaleString()} / ${entry.bigBlind.toLocaleString()}`
}

// A malformed payout structure must never take down the TV.
function safePayouts(tournament) {
  if (!tournament?.payoutStructure || tournament.totalPrizePool <= 0) return []
  try {
    return materializePayouts(tournament.payoutStructure, tournament.totalPrizePool)
  } catch {
    return []
  }
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
              'absolute inset-0 flex items-center justify-center px-[4vw] pt-[6vh] pb-[8vh] ' +
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
        <span className="font-brand text-[2.3vmin] tracking-[0.22em] text-brand-400 [text-shadow:0_0_20px_rgba(239,43,43,0.55)]">
          PLAYLIVE
        </span>
        <span className="font-display text-[2.7vmin] text-white/60 tabular-nums">{timeOfDay}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      {rotation && (
        <div className="absolute bottom-[5.4vh] left-0 right-0 flex justify-center gap-2 z-10">
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

function CounterStrip({ tournament, withPool = false }) {
  const { entries, remaining, reentries, avgStack, totalChips } = displayCounters(tournament)
  const cells = [
    ['Entries', entries.toLocaleString()],
    ['Remaining', remaining.toLocaleString()],
    ['Re-entries', reentries.toLocaleString()],
    ['Avg stack', avgStack != null ? avgStack.toLocaleString() : '—'],
    ['Total chips', totalChips != null ? totalChips.toLocaleString() : '—'],
    // The clock slide carries the pool in its money rail; the prizes slide
    // (no rails) keeps it in the strip.
    ...(withPool ? [['Prize pool', formatDisplayMoney(tournament.totalPrizePool)]] : []),
  ]
  return (
    <div className="flex flex-wrap justify-center gap-x-[2vw] gap-y-[1.5vh] mt-[3vh]">
      {cells.map(([label, value]) => (
        <div key={label} className="text-center">
          <div className="font-mono uppercase tracking-[0.2em] text-[1.5vmin] text-white/35 mb-[0.5vh] whitespace-nowrap">
            {label}
          </div>
          <div className="font-display text-[3.4vmin] text-white/90 tabular-nums whitespace-nowrap">{value}</div>
        </div>
      ))}
    </div>
  )
}

/* ── v2 furniture ────────────────────────────────────────────────────────── */

/**
 * Segmented level track: one block per level in the current between-breaks
 * stretch. Hidden when the segment is trivial or absurdly long (a wall of
 * slivers reads worse than nothing).
 */
function LevelTrack({ structure, heroIndex, sliceEnd }) {
  const segment = levelTrackSegment(structure, heroIndex, sliceEnd)
  if (!segment || segment.blocks.length > LEVEL_TRACK_MAX_BLOCKS) return null
  return (
    <div className="mx-auto w-[42vw] flex items-center gap-[0.5vw] mb-[2vh]">
      {segment.blocks.map((b) => (
        <span
          key={b.index}
          className={
            'h-[1vh] flex-1 rounded-[0.3vh] ' +
            (b.state === 'done'
              ? 'bg-brand-500/70'
              : b.state === 'current'
                ? 'bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]'
                : 'bg-white/12')
          }
        />
      ))}
      <span className="font-mono uppercase tracking-[0.2em] text-[1.4vmin] text-sky-300/80 ml-[0.6vw] whitespace-nowrap">
        {segment.endsInBreak ? 'Break' : 'End'}
      </span>
    </div>
  )
}

/** One label-over-value block in a side rail. */
function RailRow({ label, value, tone = 'text-white/90' }) {
  return (
    <div>
      <div className="font-mono uppercase tracking-[0.22em] text-[1.5vmin] text-white/35 mb-[0.4vh]">{label}</div>
      <div className={'font-display tabular-nums leading-tight text-[3.1vmin] ' + tone}>{value}</div>
    </div>
  )
}

/**
 * Left rail — the game's story: cost to play, what you get, where the
 * structure is heading, and whether you can still enter. Rows self-hide when
 * they have nothing to say.
 */
function GameRail({ tournament, derived, badge, onBreak, heroNext, sliceEnd }) {
  const rows = []
  if (tournament.buyIn > 0) rows.push({ label: 'Buy-in', value: formatDisplayMoney(tournament.buyIn) })
  if (tournament.startingStack > 0)
    rows.push({ label: 'Starting stack', value: tournament.startingStack.toLocaleString() })
  const firstLevel = (tournament.structure ?? []).find((e) => e.type === 'level')
  if (firstLevel?.durationMinutes > 0) rows.push({ label: 'Levels', value: `${firstLevel.durationMinutes} min` })

  if (heroNext) {
    rows.push({
      label: onBreak ? 'Back to' : 'Next level',
      value:
        heroNext.type === 'break'
          ? entryLabel(heroNext)
          : entryBlinds(heroNext) + (heroNext.ante > 0 ? ` (${heroNext.ante.toLocaleString()})` : ''),
    })
  }

  const live = derived && derived.state !== CLOCK_STOPPED && badge !== 'STARTS SOON'
  if (live && !onBreak) {
    const breakMs = msUntilNextBreak(tournament.structure, derived.currentIndex, derived.remainingMs, sliceEnd)
    if (breakMs != null) rows.push({ label: 'Next break', value: `in ${formatCloseIn(breakMs)}` })
  }

  if (tournament.status === 'lateRegOpen') {
    const closeMs = live
      ? msUntilLateRegClose(
          tournament.structure,
          derived.currentIndex,
          derived.remainingMs,
          tournament.lateRegCutoffLevel,
        )
      : null
    let value
    if (closeMs != null && closeMs > 0) value = `closes in ${formatCloseIn(closeMs)}`
    else if (closeMs === 0) value = 'closing'
    else if (tournament.lateRegCutoffLevel != null) value = `thru level ${tournament.lateRegCutoffLevel}`
    else value = 'open'
    rows.push({ label: 'Late reg', value, tone: 'text-emerald-300' })
  } else if (tournament.status === 'lateRegClosed') {
    rows.push({ label: 'Late reg', value: 'closed', tone: 'text-white/40' })
  }

  return (
    <div className="w-[20vw] shrink-0 self-stretch flex flex-col justify-evenly text-left py-[2vh]">
      {rows.map((r) => (
        <RailRow key={r.label} label={r.label} value={r.value} tone={r.tone} />
      ))}
    </div>
  )
}

/**
 * Right rail — the money's story: pool, guarantee, and the payout ladder.
 * Right-aligned so the numbers sit on the screen edge.
 */
function MoneyRail({ tournament, payouts }) {
  const shown = payouts.slice(0, 6)
  return (
    <div
      className={
        'w-[20vw] shrink-0 self-stretch flex flex-col text-right py-[2vh] ' +
        (shown.length > 0 ? '' : 'justify-center')
      }
    >
      <div>
        <div className="font-mono uppercase tracking-[0.22em] text-[1.5vmin] text-white/35 mb-[0.4vh]">
          Prize pool
        </div>
        <div className="font-display text-[5.5vmin] leading-tight text-gold-300 tabular-nums">
          {formatDisplayMoney(tournament.totalPrizePool)}
        </div>
        {tournament.guarantee > 0 && (
          <div className="text-[1.9vmin] text-brand-300 mt-[0.4vh]">
            {formatDisplayMoney(tournament.guarantee)} GTD
          </div>
        )}
      </div>
      {shown.length > 0 && (
        <div className="flex-1 flex flex-col justify-evenly mt-[2vh]">
          {shown.map(({ place, amount }) => (
            <div key={place} className="flex items-baseline justify-end gap-[1vw]">
              <span className="font-mono uppercase tracking-[0.2em] text-[1.8vmin] text-white/45">
                {ordinalPlace(place)}
              </span>
              <span className="font-display text-[2.8vmin] text-white/90 tabular-nums">
                {formatDisplayMoney(amount)}
              </span>
            </div>
          ))}
          {payouts.length > shown.length && (
            <div className="font-mono uppercase tracking-[0.22em] text-[1.5vmin] text-white/30">
              +{payouts.length - shown.length} more places
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Bottom ticker strip. The item run is repeated until it is comfortably wider
 * than the screen, then rendered twice — the -50% marquee loops seamlessly.
 * No items → no ticker.
 */
function Ticker({ tournament, payouts }) {
  const items = tickerItems(tournament, payouts)
  if (items.length === 0) return null
  const chars = items.join('').length
  const reps = Math.max(1, Math.ceil(140 / Math.max(1, chars)))
  const run = Array.from({ length: reps }, () => items).flat()
  const durationS = Math.min(90, Math.max(24, run.join('').length * 0.35))
  const half = (suffix) => (
    <div className="flex items-center" aria-hidden={suffix === 'b'}>
      {run.map((item, i) => (
        <span key={`${suffix}${i}`} className="flex items-center whitespace-nowrap">
          <span className="font-mono uppercase tracking-[0.18em] text-[2vmin] text-white/70">{item}</span>
          <span className="text-brand-400 text-[1.5vmin] mx-[1.6vw]">◆</span>
        </span>
      ))}
    </div>
  )
  return (
    <div className="absolute bottom-0 inset-x-0 h-[4.6vh] border-t border-white/10 bg-black/45 flex items-center overflow-hidden">
      <div className="display-ticker flex" style={{ animationDuration: `${durationS}s` }}>
        {half('a')}
        {half('b')}
      </div>
    </div>
  )
}

/* ── Blind countdown ─────────────────────────────────────────────────────── */

function ClockSlide({ tournament, sessions, nowMs }) {
  const session = pickDisplaySession(sessions)
  const multiSession = (sessions ?? []).filter((s) => s.status !== 'cancelled').length > 1
  const derived = session ? deriveClock(session, tournament.structure, nowMs) : null
  const payouts = useMemo(() => safePayouts(tournament), [tournament])

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
  const isRunning = derived?.state === CLOCK_RUNNING && badge === 'RUNNING'
  const startTime = formatStartTime(tournament)
  const untilStart = formatUntilStart(msUntilStart(tournament, nowMs))
  const progress =
    derived && derived.levelDurationMs > 0 && badge !== 'STARTS SOON'
      ? Math.min(1, derived.elapsedInLevelMs / derived.levelDurationMs)
      : 0

  // Final-minute warning: only while genuinely counting down a level.
  const hurry = isRunning && !onBreak && heroRemainingMs > 0 && heroRemainingMs <= FINAL_MINUTE_MS

  // Level-change pulse: fires when the live index rolls, never on mount.
  const [pulseKey, setPulseKey] = useState(0)
  const prevHeroRef = useRef(null)
  useEffect(() => {
    if (prevHeroRef.current != null && heroIndex != null && heroIndex !== prevHeroRef.current) {
      setPulseKey((k) => k + 1)
    }
    prevHeroRef.current = heroIndex
  }, [heroIndex])

  // Break mode: "back at H:MM" only means something while the clock is moving.
  const backAt = onBreak && isRunning && heroRemainingMs > 0 ? formatWallTime(nowMs + heroRemainingMs) : null

  // Long countdowns (H:MM:SS) drop a size so seven digits never spill out of
  // the center column. Sizes are vmin so type scales with the tighter screen
  // dimension — identical on a 16:9 TV, no column overflow on odd windows.
  const remainStr = formatRemaining(heroRemainingMs)
  const countdownSize = remainStr.length > 5 ? 'text-[min(19vmin,10.5vw)]' : 'text-[min(25vmin,15vw)]'

  return (
    <>
      {onBreak && (
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(56,152,255,0.14),transparent_70%)]" />
      )}
      <div className="relative w-full h-full flex flex-col">
        {/* full-width header: name + state */}
        <div className="text-center shrink-0">
          <div className="font-display text-[4.4vmin] text-gold-300 mb-[0.6vh] truncate">{tournament.name}</div>
          <div
            className={
              'font-mono uppercase tracking-[0.35em] text-[1.9vmin] ' + (onBreak ? 'text-sky-300' : badgeTone)
            }
          >
            {onBreak ? 'ON BREAK' : badge}
            {multiSession && session ? ` · ${session.sessionLabel}` : ''}
          </div>
        </div>

        {/* three-zone body: game rail | hero clock | money rail — every zone
            stretches the full height so nothing floats in slack space */}
        <div className="flex-1 flex items-stretch justify-between gap-[2.5vw] min-h-0 pt-[2vh]">
          <GameRail
            tournament={tournament}
            derived={derived}
            badge={badge}
            onBreak={onBreak}
            heroNext={heroNext}
            sliceEnd={sliceEnd}
          />

          <div
            className={
              'flex-1 text-center min-w-0 flex flex-col ' +
              (heroEntry ? 'justify-between' : 'justify-center gap-[4vh]')
            }
          >
            {heroEntry ? (
              <>
                <div key={pulseKey} className={'shrink-0 ' + (pulseKey > 0 ? 'display-level-pulse' : '')}>
                  <div className="font-display text-[3.2vmin] text-white/60 mb-[0.5vh]">{entryLabel(heroEntry)}</div>
                  {onBreak ? (
                    <div className="font-display text-[min(9.5vmin,5.5vw)] leading-tight text-sky-200">Break</div>
                  ) : (
                    <div className="font-display text-[min(9.5vmin,5.5vw)] leading-tight text-white tabular-nums whitespace-nowrap">
                      {entryBlinds(heroEntry)}
                    </div>
                  )}
                  {!onBreak && heroEntry.ante > 0 && (
                    <div className="text-white/50 text-[2.8vmin]">ante {heroEntry.ante.toLocaleString()}</div>
                  )}
                </div>

                <div className="shrink-0">
                  <div
                    className={
                      `font-display ${countdownSize} leading-none tabular-nums ` +
                      (hurry
                        ? 'display-hurry text-brand-400 [text-shadow:0_0_50px_rgba(239,43,43,0.55)]'
                        : onBreak
                          ? 'text-sky-100'
                          : 'text-white')
                    }
                  >
                    {remainStr}
                  </div>
                  {backAt && <div className="text-sky-200/80 text-[2.8vmin] mt-[0.8vh]">back at {backAt}</div>}
                  {onBreak && heroEntry.isColorUp && (
                    <div className="font-mono uppercase tracking-[0.25em] text-[1.8vmin] text-amber-300 mt-[0.8vh]">
                      Chip color-up this break
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  {/* level progress */}
                  <div className="mx-auto w-[42vw] h-[0.5vh] rounded-full bg-white/10 overflow-hidden mb-[1.2vh]">
                    <div
                      className={
                        'h-full transition-[width] duration-300 ' +
                        (hurry ? 'bg-brand-400' : 'bg-gradient-to-r from-brand-500 to-brand-400')
                      }
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <LevelTrack structure={tournament.structure} heroIndex={heroIndex} sliceEnd={sliceEnd} />
                  <CounterStrip tournament={tournament} />
                </div>
              </>
            ) : (
              <>
                <div>
                  {startTime && (
                    <div className="font-display text-[min(16vmin,11vw)] leading-none text-white tabular-nums mb-[2vh]">
                      {startTime}
                    </div>
                  )}
                  <div className="text-white/50 text-[2.8vmin]">{untilStart ?? 'Registration at the desk'}</div>
                </div>
                <CounterStrip tournament={tournament} />
              </>
            )}
          </div>

          <MoneyRail tournament={tournament} payouts={payouts} />
        </div>
      </div>
      <Ticker tournament={tournament} payouts={payouts} />
    </>
  )
}

/* ── Prize pool ──────────────────────────────────────────────────────────── */

function PrizesSlide({ tournament }) {
  const payouts = useMemo(() => safePayouts(tournament), [tournament])
  const shown = payouts.slice(0, 9)
  const guaranteed = tournament.guarantee > 0

  return (
    <>
      <div className="relative text-center w-full max-w-[92vw]">
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
                <span className="font-mono uppercase tracking-[0.2em] text-[2vh] text-white/45">
                  {ordinalPlace(place)}
                </span>
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

        <CounterStrip tournament={tournament} withPool />
      </div>
      <Ticker tournament={tournament} payouts={payouts} />
    </>
  )
}
