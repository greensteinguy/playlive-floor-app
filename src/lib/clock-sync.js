// Optimistic local-anchor + reconciliation layer for the live clock.
//
// WHY THIS EXISTS (the gospel rule): the displayed running clock is what players
// read to know the current blinds, so it MUST count down perfectly smooth and
// monotonic with ZERO jumps. We MAY write to Firebase on clock EVENTS
// (start/pause/resume/advance/finish), but we must NEVER snap the *running*
// (non-paused) displayed clock to a server-derived time. While running, the LOCAL
// countdown is the source of truth; it is re-seeded ONLY on genuine state-change
// events, never per-tick and never from a mid-run Firebase echo.
//
// The old hook derived the countdown straight from the Firestore echo every tick,
// so pause/resume jumped: the op is an async transaction, and between click →
// commit → echo the UI kept counting against stale anchors, then SNAPPED when the
// new anchor echoed back (worst on the emulator's long-polling transport, which
// has no local latency compensation — but the window exists in production too).
//
// The fix: the controlling screen runs an OPTIMISTIC LOCAL ANCHOR expressed in
// the renderer's own wall clock. Button clicks mutate it SYNCHRONOUSLY (pause
// freezes instantly; resume continues from the frozen remaining instantly), using
// the SAME re-anchor math as the domain ops, so the optimistic prediction equals
// the eventual server doc. The async write still happens; when its echo lands we
// RECONCILE rather than blindly re-derive — absorbing our own echo without a snap,
// and re-seeding only for a genuine external event.
//
// This module is PURE: no React, no Firestore, no Date.now(). Every function takes
// time/inputs as args (mirroring clock.js) so the gospel-critical logic is unit-
// testable without a renderer. clock.js, the domain ops, and the schema are
// untouched; we reuse clock.js's exported pure helpers and only the live anchor's
// time-base differs (local, event-seeded) from the server anchor (per-tick echo).

import {
  deriveClock,
  clockState,
  clockSliceEndIndex,
  resumeStartedAtMs,
  CLOCK_STOPPED,
  CLOCK_PAUSED,
} from './clock'

// Local copy of clock.js's private tsToMillis (it isn't exported, and duplicating
// a 6-line normalizer keeps this module self-contained without touching clock.js).
// Accepts a Firestore Timestamp, a Date, a {seconds,nanoseconds} object, a raw ms
// number, or null.
function tsMillisOrNull(ts) {
  if (ts == null) return null
  if (typeof ts === 'number') return ts
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000 + (ts.nanoseconds ?? 0) / 1e6
  return null
}

/**
 * @typedef {Object} LocalAnchor  Optimistic anchor in the RENDERER's wall clock (epoch ms).
 * @property {number}      startIndex   structure index the running segment is anchored at
 * @property {number}      startedAtMs  local epoch-ms when that segment (re)started counting
 * @property {number|null} pausedAtMs   local epoch-ms of freeze, or null while running
 * @property {string}      status       optimistic session.status (e.g. 'inProgress')
 *
 * A null LocalAnchor means "stopped / not seeded".
 */

/** True iff the anchor represents a live, non-paused (ticking) clock. */
export function isAnchorRunning(localAnchor) {
  return !!localAnchor && localAnchor.pausedAtMs == null
}

/**
 * IDENTITY signature of a session's clock event: clockStartIndex : clockStartedAt(ms)
 * : clockPausedAt(ms) : status. Built from the PERSISTED anchor fields only, so it is
 * STABLE across auto-advance (auto-advance changes only the derived level, performs no
 * write) yet CHANGES on every genuine event — including a re-anchor that lands on the
 * same index (the raw startedAt ms differs). Used for baseline / external-event detection.
 */
export function clockEventSig(session) {
  if (!session) return 'none'
  const i = session.clockStartIndex ?? 'x'
  const st = tsMillisOrNull(session.clockStartedAt) ?? 'x'
  const pz = tsMillisOrNull(session.clockPausedAt) ?? 'x'
  const s = session.status ?? 'x'
  return `${i}:${st}:${pz}:${s}`
}

/**
 * COARSE signature: clockStartIndex : runState : status (no timestamps). This is the
 * only thing the client can PREDICT at click time (it can't know the server's commit
 * ms), so it's used to match an in-flight optimistic op against its confirming echo.
 */
export function coarseSig(session) {
  if (!session) return 'none'
  const i = session.clockStartIndex ?? 'x'
  const s = clockState(session)
  const st = session.status ?? 'x'
  return `${i}:${s}:${st}`
}

/**
 * Build the session-shaped object fed to deriveClock: anchor fields from the LOCAL
 * anchor (so the running countdown is purely local), slice caps from the LIVE server
 * session (so a TD editing maximumEndIndex is honored even though it isn't an event).
 * deriveClock accepts raw-ms anchors, so no Timestamp wrapping is needed.
 */
export function syntheticSession(localAnchor, liveSession) {
  if (!localAnchor) return null
  return {
    clockStartIndex: localAnchor.startIndex,
    clockStartedAt: localAnchor.startedAtMs,
    clockPausedAt: localAnchor.pausedAtMs,
    maximumStartIndex: liveSession?.maximumStartIndex ?? 0,
    maximumEndIndex: liveSession?.maximumEndIndex ?? null,
  }
}

/**
 * Convert a server session into a LOCAL anchor (epoch-ms base). Returns null for a
 * stopped/finished clock.
 *
 * On the CONTROLLING device the anchor was stamped with this same device's clock, so
 * the running case reduces to a 1:1 copy of clockStartedAt (the `nowMs - elapsed`
 * form additionally clamps a future-dated anchor down to `now`, so a slightly-ahead
 * stamp can never show more than the full duration). True cross-device skew handling
 * (a server-time offset, for the Phase-5 read-only TVs) is deferred — those viewers
 * re-seed only on events, which is gospel-safe regardless of a constant offset.
 */
export function seedAnchorFromSession(session, nowMs) {
  const state = clockState(session)
  if (state === CLOCK_STOPPED) return null
  const startedMs = tsMillisOrNull(session.clockStartedAt)
  if (session.clockStartIndex == null || startedMs == null) return null

  if (state === CLOCK_PAUSED) {
    // Freeze: preserve elapsed-into-level (a server-stamped DURATION, skew-free) and
    // pin both ends to nowMs so derive (which reads clockPausedAt while paused) shows
    // exactly that remaining.
    const pausedMs = tsMillisOrNull(session.clockPausedAt)
    const elapsed = Math.max(0, (pausedMs ?? startedMs) - startedMs)
    return {
      startIndex: session.clockStartIndex,
      startedAtMs: nowMs - elapsed,
      pausedAtMs: nowMs,
      status: session.status,
    }
  }

  const elapsed = Math.max(0, nowMs - startedMs) // running: == startedMs on the same device
  return {
    startIndex: session.clockStartIndex,
    startedAtMs: nowMs - elapsed,
    pausedAtMs: null,
    status: session.status,
  }
}

/**
 * Optimistic state-change transition for start / pause / resume / finish. Returns the
 * NEXT local anchor (or null for finish/stopped), computed from the CURRENT anchor —
 * pause/resume use the same gospel resume math (resumeStartedAtMs) as the domain ops,
 * so the optimistic prediction matches the eventual server doc. No-ops (pause when not
 * running, resume when not paused) return the anchor unchanged.
 */
export function applyOptimistic(localAnchor, action, nowMs, liveSession) {
  switch (action) {
    case 'start': {
      const i = liveSession?.maximumStartIndex ?? 0
      return { startIndex: i, startedAtMs: nowMs, pausedAtMs: null, status: 'inProgress' }
    }
    case 'pause':
      if (!isAnchorRunning(localAnchor)) return localAnchor
      return { ...localAnchor, pausedAtMs: nowMs }
    case 'resume':
      if (!localAnchor || localAnchor.pausedAtMs == null) return localAnchor
      return {
        ...localAnchor,
        startedAtMs: resumeStartedAtMs(localAnchor.startedAtMs, localAnchor.pausedAtMs, nowMs),
        pausedAtMs: null,
      }
    case 'finish':
      return null
    default:
      return localAnchor
  }
}

/**
 * Optimistic level change (advance / rewind / goto). `target` is 'advance', 'rewind',
 * or an explicit integer index. The new level starts fresh at its full duration; if the
 * clock was paused it stays paused (frozen at the new level's start). Clamp is identical
 * to the domain op's reanchorMutate (max(maximumStartIndex, min(sliceEnd, raw))), and the
 * base index is the local synthetic clock's DERIVED current index — so advance/rewind
 * track the level the player currently sees, matching the server exactly.
 */
export function optimisticChangeLevel(localAnchor, target, nowMs, liveSession, structure) {
  if (!localAnchor) return localAnchor
  const synth = syntheticSession(localAnchor, liveSession)
  const cur = deriveClock(synth, structure, nowMs).currentIndex ?? localAnchor.startIndex
  const raw = target === 'advance' ? cur + 1 : target === 'rewind' ? cur - 1 : target
  const sliceEnd = clockSliceEndIndex(liveSession, Array.isArray(structure) ? structure.length : 0)
  const lo = liveSession?.maximumStartIndex ?? 0
  const idx = Math.max(lo, Math.min(sliceEnd, raw))
  const wasPaused = localAnchor.pausedAtMs != null
  return { startIndex: idx, startedAtMs: nowMs, pausedAtMs: wasPaused ? nowMs : null, status: localAnchor.status }
}

/**
 * The COARSE signature the server doc is PREDICTED to carry after `action` commits,
 * computed from the just-applied next anchor (same coarseSig function the echo runs
 * through). Used to recognise our own op's confirming echo.
 */
export function predictedCoarseSig(action, nextAnchor) {
  if (action === 'finish') {
    return coarseSig({ clockStartIndex: null, clockStartedAt: null, clockPausedAt: null, status: 'finished' })
  }
  if (!nextAnchor) return coarseSig(null)
  return coarseSig({
    clockStartIndex: nextAnchor.startIndex,
    clockStartedAt: nextAnchor.startedAtMs,
    clockPausedAt: nextAnchor.pausedAtMs,
    status: nextAnchor.status,
  })
}

/**
 * Classify an incoming session echo. The hook applies the decision; this function
 * never itself snaps a clock.
 *
 *   seed    — first echo of a session (baseline not set): seed the local anchor.
 *   confirm — an in-flight op's echo landed (coarse match): adopt its identity sig as
 *             baseline and KEEP the local anchor (this is what hides the round-trip).
 *   reseed  — a genuine EXTERNAL event (no pending, identity sig changed): re-seed.
 *   ignore  — a no-op echo (same identity sig) or a non-matching echo while an op is
 *             pending: leave the running clock alone (NEVER snap it to the echo).
 *
 * @returns {{ kind:'seed'|'confirm'|'reseed'|'ignore', sig:string }} sig = identity sig of the echo
 */
export function reconcile({ echoSession, baselineSig, pendingCoarse }) {
  const sig = clockEventSig(echoSession)
  if (baselineSig == null) return { kind: 'seed', sig }
  if (pendingCoarse != null) {
    if (coarseSig(echoSession) === pendingCoarse) return { kind: 'confirm', sig }
    return { kind: 'ignore', sig }
  }
  if (sig === baselineSig) return { kind: 'ignore', sig }
  return { kind: 'reseed', sig }
}

// ── Reducer ────────────────────────────────────────────────────────────────
// The whole clock-sync state machine lives here (not in the hook) so it's pure
// and unit-testable without a React renderer. useClock is just the glue that
// wires Firestore subscriptions, the wall-clock tick, and the action buttons to
// these actions. Every action that needs the current time receives `nowMs` in its
// payload, so the reducer never reads the clock itself (keeps it deterministic and
// idempotent under React StrictMode's double-invoke).
//
// State:
//   tournament  — latest tournament echo (for structure)
//   session     — latest session echo (slice caps, status, reconcile source)
//   localAnchor — LocalAnchor|null: the running display's source of truth
//   baselineSig — identity sig of the last accepted server state (null = unseeded)
//   pending     — { coarse, token }|null: an in-flight optimistic op's predicted coarse sig
//   error / mockMode / notFound — unchanged UI flags
//
// Actions: RESET, SET_TOURNAMENT, ECHO{session,nowMs}, OPTIMISTIC{verb,nowMs,token,
//   targetIndex?}, ROLLBACK{nowMs}, PENDING_TIMEOUT, MOCK, NOTFOUND, ERROR.

export const initialClockState = {
  tournament: null,
  session: null,
  localAnchor: null,
  baselineSig: null,
  pending: null,
  error: null,
  mockMode: false,
  notFound: false,
}

export function clockSyncReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return initialClockState

    case 'SET_TOURNAMENT':
      return { ...state, tournament: action.tournament }

    case 'ECHO': {
      const { session, nowMs } = action
      const decision = reconcile({
        echoSession: session,
        baselineSig: state.baselineSig,
        pendingCoarse: state.pending?.coarse ?? null,
      })
      let { localAnchor, baselineSig, pending } = state
      if (decision.kind === 'seed' || decision.kind === 'reseed') {
        localAnchor = seedAnchorFromSession(session, nowMs)
        baselineSig = decision.sig
      } else if (decision.kind === 'confirm') {
        baselineSig = decision.sig // adopt the server's identity sig
        pending = null // our own op landed — keep the smooth local anchor
      }
      // 'ignore' leaves the anchor/baseline untouched (NEVER snap a running clock).
      // The session is always stored: slice caps + structure flow through unconditionally.
      return { ...state, session, localAnchor, baselineSig, pending }
    }

    case 'OPTIMISTIC': {
      const { verb, nowMs, token, targetIndex } = action
      let next
      if (verb === 'advance' || verb === 'rewind' || verb === 'goto') {
        const target = verb === 'goto' ? targetIndex : verb
        next = optimisticChangeLevel(state.localAnchor, target, nowMs, state.session, state.tournament?.structure ?? [])
      } else {
        next = applyOptimistic(state.localAnchor, verb, nowMs, state.session)
      }
      return { ...state, localAnchor: next, pending: { coarse: predictedCoarseSig(verb, next), token } }
    }

    case 'ROLLBACK': {
      // The optimistic op was REJECTED — roll back to the current server doc. This is
      // the only running-side re-seed-from-server besides an external event; it corrects
      // an erroneous prediction (a rare precondition failure, surfaced to the TD via a toast).
      const { nowMs } = action
      return {
        ...state,
        pending: null,
        localAnchor: seedAnchorFromSession(state.session, nowMs),
        baselineSig: clockEventSig(state.session),
      }
    }

    case 'PENDING_TIMEOUT':
      // A slow-but-not-yet-confirmed op. Confirm-STYLE (never rollback): keep the smooth
      // local clock and adopt the latest server identity as baseline, so a future genuine
      // event still re-seeds while this op's late echo becomes a no-op.
      if (!state.pending) return state
      return { ...state, pending: null, baselineSig: clockEventSig(state.session) }

    case 'MOCK':
      return { ...initialClockState, mockMode: true }

    case 'NOTFOUND':
      return { ...state, notFound: true }

    case 'ERROR':
      return { ...state, error: action.error }

    default:
      return state
  }
}
