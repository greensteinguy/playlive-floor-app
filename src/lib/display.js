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
  // Stage-aware rotation: a $0 prize pool has no story to tell, so the prizes
  // slide sits out until money is in (design notes: "prizes slide drops out of
  // rotation while the pool is $0"). A TV explicitly pinned to ?screen=prizes
  // keeps it — a dedicated payouts TV showing idle would look broken.
  const screensFor = (t) =>
    screen != null ? screens : screens.filter((s) => s !== 'prizes' || (t.totalPrizePool ?? 0) > 0)
  return pool.flatMap((t) => screensFor(t).map((s) => ({ tournamentId: t.id, screen: s })))
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
 * rendering nonsense. totalChips is entries × starting stack (add-on chips are
 * not counted per-entry anywhere, so this is the honest record-keeping number).
 */
export function displayCounters(tournament) {
  const entries = tournament?.entryCount ?? 0
  const remaining = tournament?.remainingPlayerCount ?? 0
  const reentries = Math.max(0, entries - (tournament?.uniquePlayerCount ?? 0))
  const totalChips = entries > 0 ? entries * (tournament?.startingStack ?? 0) : null
  const avgStack = remaining > 0 && totalChips != null ? Math.round(totalChips / remaining) : null
  return { entries, remaining, reentries, avgStack, totalChips }
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

/** "8:40 PM" for an arbitrary instant (the break screen's "back at" line). */
export function formatWallTime(ms) {
  if (ms == null) return null
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * The run of levels the clock is currently inside, bounded by breaks (or the
 * session slice ends) — the segmented level track under the progress bar.
 *
 * During a break the track looks ahead to the NEXT segment (all upcoming, no
 * current block) so the room sees what's coming back. Returns null when there
 * is nothing meaningful to draw (stopped clock, hero out of the slice, or a
 * segment of a single level — a one-block track reads as noise).
 *
 * @returns {{ blocks: {index:number, state:'done'|'current'|'upcoming'}[], endsInBreak: boolean }|null}
 */
export function levelTrackSegment(structure, heroIndex, sliceEndIndex) {
  if (!Array.isArray(structure) || structure.length === 0) return null
  if (!Number.isInteger(heroIndex) || heroIndex < 0) return null
  const last = Math.min(
    Number.isInteger(sliceEndIndex) ? sliceEndIndex : structure.length - 1,
    structure.length - 1,
  )
  if (heroIndex > last) return null

  // Anchor on a level: during a break, the first level after it.
  let anchor = heroIndex
  while (anchor <= last && structure[anchor]?.type !== 'level') anchor++
  if (anchor > last) return null

  let segStart = anchor
  while (segStart > 0 && structure[segStart - 1]?.type === 'level') segStart--
  let segEnd = anchor
  while (segEnd < last && structure[segEnd + 1]?.type === 'level') segEnd++

  const blocks = []
  for (let i = segStart; i <= segEnd; i++) {
    blocks.push({
      index: i,
      state: i < heroIndex ? 'done' : i === heroIndex ? 'current' : 'upcoming',
    })
  }
  if (blocks.length < 2) return null
  return { blocks, endsInBreak: segEnd < last && structure[segEnd + 1]?.type === 'break' }
}

/**
 * Wall-clock ms until late reg closes (it closes at the END of the cutoff
 * blind level — see schema/tournament.js). Breaks scheduled before that point
 * count: they take real time.
 *
 * @param {Array}  structure            — tournament structure
 * @param {number} currentIndex         — the live structure index (deriveClock)
 * @param {number} remainingInCurrentMs — time left in the live entry
 * @param {number} cutoffLevel          — tournament.lateRegCutoffLevel (a blindNumber)
 * @returns {number|null} ms until close; 0 when already past; null when it
 *   can't be computed (no cutoff, clock not running, unknown level).
 */
export function msUntilLateRegClose(structure, currentIndex, remainingInCurrentMs, cutoffLevel) {
  if (cutoffLevel == null || !Array.isArray(structure)) return null
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return null
  const cutIdx = structure.findIndex((e) => e.type === 'level' && e.blindNumber === cutoffLevel)
  if (cutIdx === -1) return null
  if (currentIndex > cutIdx) return 0
  let ms = Math.max(0, remainingInCurrentMs ?? 0)
  for (let i = currentIndex + 1; i <= cutIdx; i++) {
    ms += (structure[i]?.durationMinutes ?? 0) * MS_PER_MINUTE
  }
  return ms
}

/**
 * Wall-clock ms until the next break entry after the live one (null when
 * already on break, no break remains in the slice, or inputs are unusable).
 * Same walk as msUntilLateRegClose — the level track's "break in M:SS" label.
 */
export function msUntilNextBreak(structure, currentIndex, remainingInCurrentMs, sliceEndIndex) {
  if (!Array.isArray(structure) || !Number.isInteger(currentIndex) || currentIndex < 0) return null
  const last = Math.min(
    Number.isInteger(sliceEndIndex) ? sliceEndIndex : structure.length - 1,
    structure.length - 1,
  )
  if (currentIndex > last || structure[currentIndex]?.type !== 'level') return null
  let ms = Math.max(0, remainingInCurrentMs ?? 0)
  for (let i = currentIndex + 1; i <= last; i++) {
    if (structure[i]?.type === 'break') return ms
    ms += (structure[i]?.durationMinutes ?? 0) * MS_PER_MINUTE
  }
  return null
}

/** "42:10" / "1:02:10" countdown phrasing for the late-reg close (ceils to a second). */
export function formatCloseIn(ms) {
  if (!(ms > 0)) return null
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "25,000 chips · 20-min levels" — the structure half of the buy-in line. */
export function structureSummary(tournament) {
  const stack = tournament?.startingStack
  const firstLevel = (tournament?.structure ?? []).find((e) => e.type === 'level')
  const parts = []
  if (stack > 0) parts.push(`${stack.toLocaleString()} chips`)
  if (firstLevel?.durationMinutes > 0) parts.push(`${firstLevel.durationMinutes}-min levels`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Items for the bottom ticker strip, in reading order. Empty array = ticker
 * hidden (design notes: every new element disappears rather than leaving a
 * gap). Payouts come pre-resolved ([{place, amount, label?, toPlace?}] — the
 * stored payout table's band rows carry a label like "10 – 12" and a toPlace;
 * plain per-place payouts fall back to ordinals) so this stays pure and the
 * caller keeps its try/catch around materializePayouts.
 */
export function tickerItems(tournament, payouts) {
  const items = []
  const pool = tournament?.totalPrizePool ?? 0
  const paid = payouts ?? []
  if (pool > 0) items.push(`Prize pool ${formatDisplayMoney(pool)}`)
  if ((tournament?.guarantee ?? 0) > 0)
    items.push(`${formatDisplayMoney(tournament.guarantee)} guaranteed`)
  if (paid.length > 0) {
    // Band rows pay through their last covered place, not one per row.
    const last = paid[paid.length - 1]
    const places = last.toPlace ?? last.place
    items.push(`Paying ${places} ${places === 1 ? 'place' : 'places'}`)
    for (const p of paid)
      items.push(`${p.label ?? ordinalPlace(p.place)} ${formatDisplayMoney(p.amount)}`)
  }
  if (tournament?.status === 'lateRegOpen') {
    const summary = structureSummary(tournament)
    const buyIn = (tournament?.buyIn ?? 0) > 0 ? `${formatDisplayMoney(tournament.buyIn)} buy-in` : null
    items.push(['Late reg open', buyIn, summary].filter(Boolean).join(' — '))
  }
  return items
}

/** "1st" / "2nd" / "3rd" / "11th"… */
export function ordinalPlace(place) {
  const mod100 = place % 100
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] ?? 'th'
  return `${place}${suffix}`
}
