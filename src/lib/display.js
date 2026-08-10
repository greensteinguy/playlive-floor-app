// Pure helpers for the venue TV display (/display — Phase 5).
//
// The display is a read-only, full-screen rotation over the tournaments that
// are "on the floor" right now. Everything here is pure (no Firestore, no
// React, time injected) so the selection + rotation rules are unit-testable;
// the Display page owns the subscriptions and timers.
//
// Screens per tournament (SOW §3.1, v0.5): blind countdown + prize pool.
// The stats screen is deliberately v1.5+ — do not add it here.

const MS_PER_MINUTE = 60_000

/** Screen kinds the display cycles through, in order. */
export const DISPLAY_SCREENS = ['clock', 'prizes']

/** How long each screen holds before the rotation advances. */
export const SCREEN_DURATION_MS = {
  clock: 25_000,
  prizes: 10_000,
}

function tsToMillis(ts) {
  if (ts == null) return null
  if (typeof ts === 'number') return ts
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000 + (ts.nanoseconds ?? 0) / 1e6
  return null
}

function sameLocalDay(aMs, bMs) {
  const a = new Date(aMs)
  const b = new Date(bMs)
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

/**
 * Should this tournament appear on the venue TVs right now?
 *  - lateRegOpen / lateRegClosed: always (it's live on the floor).
 *  - scheduled: only on its start day (pre-start "starts at" screen), or if the
 *    scheduled start has already passed (running late, not yet opened).
 *  - draft / finished / cancelled: never.
 */
export function isDisplayableTournament(tournament, nowMs) {
  if (!tournament) return false
  const status = tournament.status
  if (status === 'lateRegOpen' || status === 'lateRegClosed') return true
  if (status !== 'scheduled') return false
  const startMs = tsToMillis(tournament.scheduledStartTime)
  if (startMs == null) return false
  return startMs <= nowMs || sameLocalDay(startMs, nowMs)
}

/**
 * The rotation set: displayable tournaments, soonest scheduled start first
 * (the natural TV reading order — the event that starts next leads).
 */
export function displayableTournaments(tournaments, nowMs) {
  return (tournaments ?? [])
    .filter((t) => isDisplayableTournament(t, nowMs))
    .sort((a, b) => (tsToMillis(a.scheduledStartTime) ?? 0) - (tsToMillis(b.scheduledStartTime) ?? 0))
}

/**
 * Which of a tournament's sessions the TVs should show. Mirrors the TD clock
 * page's pick but is explicit about the edges: a session in progress wins;
 * else the next scheduled one (earliest by day/flight); else the last
 * finished one (a just-ended day keeps showing its final state); else null.
 */
export function pickDisplaySession(sessions) {
  const list = (sessions ?? []).filter((s) => s.status !== 'cancelled')
  if (list.length === 0) return null
  const sorted = [...list].sort(
    (a, b) => a.dayNumber - b.dayNumber || (a.flightLabel || '').localeCompare(b.flightLabel || ''),
  )
  return (
    sorted.find((s) => s.status === 'inProgress') ??
    sorted.find((s) => s.status === 'scheduled') ??
    sorted[sorted.length - 1]
  )
}

/**
 * The slide deck: every displayable tournament × every screen, in rotation
 * order. Options pin the rotation for dedicated TVs:
 *   tournamentId — only that tournament's slides (e.g. the TV by its table)
 *   screen       — only that screen kind (e.g. a clock-only TV)
 * Returns [] when nothing is displayable (the page shows the idle screen).
 */
export function buildSlides(tournaments, { tournamentId = null, screen = null } = {}) {
  const pool = tournamentId ? (tournaments ?? []).filter((t) => t.id === tournamentId) : tournaments ?? []
  const screens = screen ? DISPLAY_SCREENS.filter((s) => s === screen) : DISPLAY_SCREENS
  return pool.flatMap((t) => screens.map((s) => ({ tournamentId: t.id, screen: s })))
}

/** Hold time for a slide (falls back to the clock duration). */
export function slideDurationMs(slide) {
  return SCREEN_DURATION_MS[slide?.screen] ?? SCREEN_DURATION_MS.clock
}

/** Advance the rotation (wraps; -1 for an empty deck). */
export function nextSlideIndex(index, slideCount) {
  if (!Number.isInteger(slideCount) || slideCount <= 0) return -1
  return ((Number.isInteger(index) ? index : -1) + 1) % slideCount
}

/**
 * Derived counters for both screens. remainingPlayerCount can exceed
 * entryCount transiently on bad data — clamp the avg-stack math instead of
 * rendering nonsense.
 */
export function displayCounters(tournament) {
  const entries = tournament?.entryCount ?? 0
  const remaining = tournament?.remainingPlayerCount ?? 0
  const reentries = Math.max(0, entries - (tournament?.uniquePlayerCount ?? 0))
  const avgStack =
    remaining > 0 && entries > 0 ? Math.round((entries * (tournament?.startingStack ?? 0)) / remaining) : null
  return { entries, remaining, reentries, avgStack }
}

/** ms until a scheduled start (0 when past/absent) — the pre-start screen's countdown. */
export function msUntilStart(tournament, nowMs) {
  const startMs = tsToMillis(tournament?.scheduledStartTime)
  if (startMs == null) return 0
  return Math.max(0, startMs - nowMs)
}

/** "7:30 PM" for the pre-start screen (venue-local). */
export function formatStartTime(tournament) {
  const startMs = tsToMillis(tournament?.scheduledStartTime)
  if (startMs == null) return null
  return new Date(startMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * Money for TV distances: thousands-separated, cents only when non-zero
 * ($12,450 · $7.50). formatMoney's fixed two decimals reads as clutter at
 * display sizes.
 */
export function formatDisplayMoney(cents) {
  const dollars = (cents ?? 0) / 100
  const hasCents = Math.round(cents ?? 0) % 100 !== 0
  return `$${dollars.toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`
}

/** Rough "starts in 1h 20m" phrasing (null once started). */
export function formatUntilStart(ms) {
  if (!(ms > 0)) return null
  const totalMin = Math.ceil(ms / MS_PER_MINUTE)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0) return m > 0 ? `starts in ${h}h ${m}m` : `starts in ${h}h`
  return `starts in ${m}m`
}
