// Pure tournament-clock math. No Firestore, no React, no Date.now() — every
// function takes the current time as an argument so it's fully testable.
//
// The clock is SERVER-AUTHORITATIVE but stored as an ANCHOR, not a per-tick
// value. A session carries three fields (see schema/session.js):
//   clockStartIndex — the structure index the current running segment is
//                     anchored at (where counting last (re)started).
//   clockStartedAt  — the time that anchor index started counting.
//   clockPausedAt   — when set, the clock is frozen at this instant (paused).
// From those + the structure's per-entry durationMinutes, deriveClock() works
// out which level/break is live right now and how much time is left. Because the
// current level is DERIVED, levels roll over automatically at zero with no
// writes, and every screen (the TD control screen and every venue TV) that
// shares the same anchor renders the same clock — they only need a local tick
// to re-render the countdown smoothly between Firestore updates.
//
// The clock domain ops (lib/tournaments/clock.js) own the writes; they use the
// re-anchor helpers at the bottom of this file to keep the math in one place.

export const CLOCK_STOPPED = 'stopped'
export const CLOCK_RUNNING = 'running'
export const CLOCK_PAUSED = 'paused'

const MS_PER_MINUTE = 60_000

// Accept a Firestore Timestamp, a Date, a {seconds,nanoseconds} plain object, or
// a raw ms number — return ms since epoch, or null. Keeps the lib decoupled from
// the firebase SDK (a Timestamp just quacks via toMillis()).
function tsToMillis(ts) {
  if (ts == null) return null
  if (typeof ts === 'number') return ts
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000 + (ts.nanoseconds ?? 0) / 1e6
  return null
}

function entryDurationMs(entry) {
  const mins = entry?.durationMinutes
  return typeof mins === 'number' && mins > 0 ? mins * MS_PER_MINUTE : 0
}

/** Derived run-state of a session's clock, from its anchor fields alone. */
export function clockState(session) {
  if (!session || session.clockStartedAt == null) return CLOCK_STOPPED
  return session.clockPausedAt != null ? CLOCK_PAUSED : CLOCK_RUNNING
}

/**
 * The last structure index this session's clock plays: maximumEndIndex when set
 * (a capped day), else the final structure entry (a "play to a winner" session).
 * Clamped to the structure bounds.
 */
export function clockSliceEndIndex(session, structureLength) {
  if (!Number.isInteger(structureLength) || structureLength < 1) return -1
  const cap = session?.maximumEndIndex
  return cap != null ? Math.min(cap, structureLength - 1) : structureLength - 1
}

const EMPTY = {
  currentIndex: null,
  currentEntry: null,
  nextIndex: null,
  nextEntry: null,
  remainingMs: 0,
  elapsedInLevelMs: 0,
  levelDurationMs: 0,
  isComplete: false,
}

/**
 * Derive the live clock for a session.
 *
 * @param {object} session   — Session doc (clock anchor + slice fields)
 * @param {Array}  structure — the tournament's structure array (level/break entries)
 * @param {number} nowMs     — current time, ms since epoch (Date.now() on a client)
 * @returns {{
 *   state: 'stopped'|'running'|'paused',
 *   currentIndex: number|null,   // structure index of the live entry (null if stopped)
 *   currentEntry: object|null,
 *   nextIndex: number|null,      // next entry within this session's slice, or null
 *   nextEntry: object|null,
 *   remainingMs: number,         // time left in the current entry (0 when complete)
 *   elapsedInLevelMs: number,
 *   levelDurationMs: number,
 *   isComplete: boolean,         // the clock has run past the session's slice end
 * }}
 */
export function deriveClock(session, structure, nowMs) {
  const state = clockState(session)
  if (state === CLOCK_STOPPED) return { state, ...EMPTY }
  if (!Array.isArray(structure) || structure.length === 0) return { state, ...EMPTY }

  const startIndex = session.clockStartIndex
  const startedMs = tsToMillis(session.clockStartedAt)
  if (!Number.isInteger(startIndex) || startedMs == null) return { state, ...EMPTY }

  // While paused the clock is frozen at clockPausedAt; while running it tracks now.
  const effectiveNow = state === CLOCK_PAUSED ? tsToMillis(session.clockPausedAt) : nowMs
  let remaining = Math.max(0, (effectiveNow ?? startedMs) - startedMs)

  const lastIndex = clockSliceEndIndex(session, structure.length)

  for (let i = Math.max(0, startIndex); i <= lastIndex; i++) {
    const entry = structure[i]
    const durMs = entryDurationMs(entry)
    if (remaining < durMs) {
      const nextIndex = i + 1 <= lastIndex ? i + 1 : null
      return {
        state,
        currentIndex: i,
        currentEntry: entry,
        nextIndex,
        nextEntry: nextIndex == null ? null : structure[nextIndex],
        remainingMs: durMs - remaining,
        elapsedInLevelMs: remaining,
        levelDurationMs: durMs,
        isComplete: false,
      }
    }
    remaining -= durMs
  }

  // Elapsed time exhausted the whole slice — hold on the last entry at 0:00.
  const last = lastIndex >= 0 ? structure[lastIndex] : null
  return {
    state,
    currentIndex: lastIndex >= 0 ? lastIndex : null,
    currentEntry: last,
    nextIndex: null,
    nextEntry: null,
    remainingMs: 0,
    elapsedInLevelMs: entryDurationMs(last),
    levelDurationMs: entryDurationMs(last),
    isComplete: true,
  }
}

/** Format a millisecond duration as M:SS or H:MM:SS (rounds up to the next whole second). */
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil((ms ?? 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// ── Re-anchor math (used by the clock domain ops) ──────────────────────────
// These return plain ms numbers; the ops wrap them in Firestore Timestamps.

/**
 * On resume, shift the anchor forward by however long the clock was paused, so
 * the elapsed-into-level is preserved exactly (paused time doesn't count).
 * @returns {number} the new clockStartedAt, in ms.
 */
export function resumeStartedAtMs(startedAtMs, pausedAtMs, nowMs) {
  return startedAtMs + (nowMs - pausedAtMs)
}
