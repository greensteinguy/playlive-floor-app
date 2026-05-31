import { describe, it, expect } from 'vitest'
import { deriveClock, CLOCK_RUNNING, CLOCK_STOPPED } from './clock'
import {
  clockEventSig,
  coarseSig,
  syntheticSession,
  seedAnchorFromSession,
  applyOptimistic,
  optimisticChangeLevel,
  predictedCoarseSig,
  reconcile,
  isAnchorRunning,
  clockSyncReducer,
  initialClockState,
} from './clock-sync'

const MIN = 60_000
const T0 = 1_700_000_000_000

// 0: level 20m | 1: level 30m | 2: break 10m | 3: level 25m
const STRUCT = [
  { type: 'level', blindNumber: 1, smallBlind: 100, bigBlind: 200, ante: 0, bringIn: 0, durationMinutes: 20 },
  { type: 'level', blindNumber: 2, smallBlind: 200, bigBlind: 400, ante: 0, bringIn: 0, durationMinutes: 30 },
  { type: 'break', durationMinutes: 10, label: 'Break', isColorUp: true },
  { type: 'level', blindNumber: 3, smallBlind: 300, bigBlind: 600, ante: 0, bringIn: 0, durationMinutes: 25 },
]

// A server session doc (anchor fields as raw ms — deriveClock/tsMillisOrNull accept numbers).
function srv(o = {}) {
  return {
    clockStartIndex: 0,
    clockStartedAt: T0,
    clockPausedAt: null,
    maximumStartIndex: 0,
    maximumEndIndex: null,
    status: 'inProgress',
    ...o,
  }
}

const remaining = (anchor, live, t) => deriveClock(syntheticSession(anchor, live), STRUCT, t).remainingMs

// Drive a fresh reducer to a seeded state (tournament + one running/paused echo).
function seeded(sessionOverrides = {}, nowMs = T0) {
  let s = clockSyncReducer(initialClockState, { type: 'SET_TOURNAMENT', tournament: { structure: STRUCT } })
  s = clockSyncReducer(s, { type: 'ECHO', session: srv(sessionOverrides), nowMs })
  return s
}

// ── A. Gospel — running smoothness ──────────────────────────────────────────
describe('running smoothness', () => {
  it('counts down monotonically while running (250ms granularity)', () => {
    const a = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    expect(remaining(a, srv(), T0)).toBe(20 * MIN)
    expect(remaining(a, srv(), T0 + 250)).toBeLessThan(remaining(a, srv(), T0))
    expect(remaining(a, srv(), T0) - remaining(a, srv(), T0 + 1000)).toBe(1000)
    expect(remaining(a, srv(), T0 + 2000)).toBeLessThan(remaining(a, srv(), T0 + 1000))
  })

  it('never re-seeds (snaps) on a same-identity echo', () => {
    const baseline = clockEventSig(srv())
    expect(reconcile({ echoSession: srv(), baselineSig: baseline, pendingCoarse: null }).kind).toBe('ignore')
    // …and an unrelated non-anchor field change is still a no-op for the clock.
    expect(
      reconcile({ echoSession: srv({ remainingPlayerCount: 42 }), baselineSig: baseline, pendingCoarse: null }).kind,
    ).toBe('ignore')
  })

  it('the reducer leaves the running anchor untouched on a no-op echo', () => {
    const s = seeded({ clockStartedAt: T0 }, T0 + 3 * MIN)
    const before = s.localAnchor
    const after = clockSyncReducer(s, { type: 'ECHO', session: srv({ clockStartedAt: T0 }), nowMs: T0 + 4 * MIN })
    expect(after.localAnchor).toBe(before) // same reference → no snap
  })
})

// ── B. Gospel — pause / resume continuity ───────────────────────────────────
describe('pause / resume continuity', () => {
  it('pause freezes instantly at the current remaining', () => {
    const run = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    const tPause = T0 + 6 * MIN
    const paused = applyOptimistic(run, 'pause', tPause, srv())
    expect(paused.pausedAtMs).toBe(tPause)
    expect(isAnchorRunning(paused)).toBe(false)
    // Frozen: now is ignored while paused.
    expect(remaining(paused, srv(), tPause)).toBe(14 * MIN)
    expect(remaining(paused, srv(), tPause + 999 * MIN)).toBe(14 * MIN)
  })

  it('resume continues from the frozen remaining (no latency snap)', () => {
    const run = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    const paused = applyOptimistic(run, 'pause', T0 + 6 * MIN, srv())
    const tResume = T0 + 500 * MIN
    const resumed = applyOptimistic(paused, 'resume', tResume, srv())
    expect(resumed.pausedAtMs).toBeNull()
    expect(deriveClock(syntheticSession(resumed, srv()), STRUCT, tResume).state).toBe(CLOCK_RUNNING)
    expect(remaining(resumed, srv(), tResume)).toBe(14 * MIN) // exactly where pause left off
    expect(remaining(resumed, srv(), tResume) - remaining(resumed, srv(), tResume + 1000)).toBe(1000)
  })

  it('absorbs the write round-trip: a late confirming echo does NOT snap the clock', () => {
    const s = seeded({ clockStartedAt: T0 }, T0 + 6 * MIN)
    const click = clockSyncReducer(s, { type: 'OPTIMISTIC', verb: 'pause', nowMs: T0 + 6 * MIN, token: 1 })
    const localPaused = click.localAnchor
    expect(remaining(localPaused, srv(), T0 + 999 * MIN)).toBe(14 * MIN) // frozen at 6:00 in
    // Server actually froze 800ms later (would show 14:00 − 0.8s if we re-seeded).
    const echo = srv({ clockStartedAt: T0, clockPausedAt: T0 + 6 * MIN + 800 })
    const confirmed = clockSyncReducer(click, { type: 'ECHO', session: echo, nowMs: T0 + 6 * MIN + 900 })
    expect(confirmed.pending).toBeNull() // recognised as our own op
    expect(confirmed.localAnchor).toBe(localPaused) // kept → no backward jump
    expect(confirmed.baselineSig).toBe(clockEventSig(echo))
  })
})

// ── C. Optimistic transitions ───────────────────────────────────────────────
describe('optimistic transitions', () => {
  it('start anchors at the slice start with a full first level', () => {
    const a = applyOptimistic(null, 'start', T0, srv({ maximumStartIndex: 0 }))
    expect(a).toMatchObject({ startIndex: 0, startedAtMs: T0, pausedAtMs: null, status: 'inProgress' })
    expect(remaining(a, srv(), T0)).toBe(20 * MIN)
  })

  it('advance moves to the next level with a fresh full duration', () => {
    const run = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    const adv = optimisticChangeLevel(run, 'advance', T0 + 5 * MIN, srv(), STRUCT)
    expect(adv.startIndex).toBe(1)
    expect(adv.pausedAtMs).toBeNull()
    expect(remaining(adv, srv(), T0 + 5 * MIN)).toBe(30 * MIN)
  })

  it('advance clamps at the play-to-winner slice end (resets the same level)', () => {
    const at3 = { startIndex: 3, startedAtMs: T0, pausedAtMs: null, status: 'inProgress' }
    const adv = optimisticChangeLevel(at3, 'advance', T0 + 1 * MIN, srv(), STRUCT)
    expect(adv.startIndex).toBe(3)
    expect(adv.startedAtMs).toBe(T0 + 1 * MIN) // fresh anchor
  })

  it('advance respects a capped slice (maximumEndIndex)', () => {
    const at1 = { startIndex: 1, startedAtMs: T0, pausedAtMs: null, status: 'inProgress' }
    expect(optimisticChangeLevel(at1, 'advance', T0, srv({ maximumEndIndex: 1 }), STRUCT).startIndex).toBe(1)
  })

  it('rewind clamps at the slice start', () => {
    const at0 = { startIndex: 0, startedAtMs: T0, pausedAtMs: null, status: 'inProgress' }
    expect(optimisticChangeLevel(at0, 'rewind', T0, srv(), STRUCT).startIndex).toBe(0)
  })

  it('goto jumps to an explicit index, clamped to the slice', () => {
    const run = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    expect(optimisticChangeLevel(run, 2, T0, srv(), STRUCT).startIndex).toBe(2)
    expect(optimisticChangeLevel(run, 99, T0, srv(), STRUCT).startIndex).toBe(3) // clamped
  })

  it('advancing while paused stays paused at the new level start', () => {
    const paused = applyOptimistic(seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0), 'pause', T0 + 2 * MIN, srv())
    const adv = optimisticChangeLevel(paused, 'advance', T0 + 10 * MIN, srv(), STRUCT)
    expect(adv.startIndex).toBe(1)
    expect(adv.pausedAtMs).toBe(T0 + 10 * MIN)
    expect(remaining(adv, srv(), T0 + 999 * MIN)).toBe(30 * MIN) // frozen at the fresh full level
  })

  it('pause/resume are no-ops in the wrong state', () => {
    const run = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    expect(applyOptimistic(run, 'resume', T0, srv())).toBe(run) // already running
    const paused = applyOptimistic(run, 'pause', T0, srv())
    expect(applyOptimistic(paused, 'pause', T0, srv())).toBe(paused) // already paused
  })

  it('finish stops the clock (null anchor → EMPTY derive)', () => {
    const run = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    expect(applyOptimistic(run, 'finish', T0, srv())).toBeNull()
    expect(syntheticSession(null, srv())).toBeNull()
  })
})

// ── D. Signatures + reconcile decisions ─────────────────────────────────────
describe('signatures', () => {
  it('identity sig distinguishes a same-index re-anchor; coarse sig does not', () => {
    expect(coarseSig(srv({ clockStartedAt: T0 }))).toBe(coarseSig(srv({ clockStartedAt: T0 + 999 })))
    expect(clockEventSig(srv({ clockStartedAt: T0 }))).not.toBe(clockEventSig(srv({ clockStartedAt: T0 + 999 })))
  })

  it('accepts Timestamp-like anchor objects', () => {
    const tsLike = { toMillis: () => T0 }
    expect(clockEventSig(srv({ clockStartedAt: tsLike }))).toBe(clockEventSig(srv({ clockStartedAt: T0 })))
  })

  it('predictedCoarseSig matches the eventual echo coarse sig', () => {
    const run = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    const paused = applyOptimistic(run, 'pause', T0 + 6 * MIN, srv())
    expect(predictedCoarseSig('pause', paused)).toBe(coarseSig(srv({ clockStartedAt: T0, clockPausedAt: T0 + 99 })))
    expect(predictedCoarseSig('finish', null)).toBe(
      coarseSig({ clockStartIndex: null, clockStartedAt: null, clockPausedAt: null, status: 'finished' }),
    )
  })
})

describe('reconcile', () => {
  it('first echo seeds', () => {
    expect(reconcile({ echoSession: srv(), baselineSig: null, pendingCoarse: null }).kind).toBe('seed')
  })

  it('no pending + changed identity → reseed (genuine external event)', () => {
    const dec = reconcile({
      echoSession: srv({ clockStartIndex: 2, clockStartedAt: T0 + 50 * MIN }),
      baselineSig: clockEventSig(srv()),
      pendingCoarse: null,
    })
    expect(dec.kind).toBe('reseed')
  })

  it('SAME-index external re-anchor → reseed (identity, not coarse, drives detection)', () => {
    const dec = reconcile({
      echoSession: srv({ clockStartedAt: T0 + 1234 }),
      baselineSig: clockEventSig(srv({ clockStartedAt: T0 })),
      pendingCoarse: null,
    })
    expect(dec.kind).toBe('reseed')
  })

  it('pending + coarse match → confirm; coarse mismatch → ignore', () => {
    const baseline = clockEventSig(srv({ clockStartedAt: T0 }))
    const pendingCoarse = coarseSig(srv({ clockStartedAt: T0, clockPausedAt: T0 + 1 })) // 0:paused:inProgress
    expect(
      reconcile({ echoSession: srv({ clockStartedAt: T0, clockPausedAt: T0 + 6 * MIN }), baselineSig: baseline, pendingCoarse }).kind,
    ).toBe('confirm')
    // echo still running (our pause not committed yet) → wait
    expect(reconcile({ echoSession: srv({ clockStartedAt: T0 }), baselineSig: baseline, pendingCoarse }).kind).toBe('ignore')
  })

  it('auto-advance is invisible to the signature (no write) → ignore + continuous derive', () => {
    const s = srv({ clockStartedAt: T0 })
    expect(clockEventSig(s)).toBe(clockEventSig({ ...s }))
    expect(reconcile({ echoSession: { ...s }, baselineSig: clockEventSig(s), pendingCoarse: null }).kind).toBe('ignore')
    const a = seedAnchorFromSession(s, T0)
    expect(remaining(a, s, T0 + 20 * MIN - 1000)).toBeGreaterThan(0)
    expect(deriveClock(syntheticSession(a, s), STRUCT, T0 + 20 * MIN - 1000).currentIndex).toBe(0)
    expect(deriveClock(syntheticSession(a, s), STRUCT, T0 + 20 * MIN + 1000).currentIndex).toBe(1) // rolled, no event
  })
})

// ── E. Seed (time-base) + rollback + timeout ────────────────────────────────
describe('seedAnchorFromSession', () => {
  it('running: 1:1 copy on the same device, with a future-anchor clamp', () => {
    expect(seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0 + 5 * MIN).startedAtMs).toBe(T0)
    expect(seedAnchorFromSession(srv({ clockStartedAt: T0 + 5 * MIN }), T0).startedAtMs).toBe(T0) // clamped to now
  })

  it('paused: freezes at the elapsed-into-level captured on the server', () => {
    const p = seedAnchorFromSession(srv({ clockStartedAt: T0, clockPausedAt: T0 + 6 * MIN }), T0 + 50 * MIN)
    expect(p.pausedAtMs).toBe(T0 + 50 * MIN)
    expect(deriveClock(syntheticSession(p, srv()), STRUCT, T0 + 999 * MIN).remainingMs).toBe(14 * MIN)
  })

  it('stopped → null', () => {
    expect(seedAnchorFromSession(srv({ clockStartedAt: null, clockStartIndex: null, status: 'scheduled' }), T0)).toBeNull()
  })
})

describe('rollback / timeout', () => {
  it('ROLLBACK re-seeds from the current server doc and clears pending', () => {
    let s = seeded({ clockStartedAt: T0 }, T0 + 5 * MIN)
    s = clockSyncReducer(s, { type: 'OPTIMISTIC', verb: 'pause', nowMs: T0 + 5 * MIN, token: 1 })
    expect(isAnchorRunning(s.localAnchor)).toBe(false)
    const rolled = clockSyncReducer(s, { type: 'ROLLBACK', nowMs: T0 + 5 * MIN })
    expect(rolled.pending).toBeNull()
    expect(isAnchorRunning(rolled.localAnchor)).toBe(true) // server still running → optimistic pause undone
    expect(rolled.baselineSig).toBe(clockEventSig(s.session))
  })

  it('PENDING_TIMEOUT keeps the smooth local clock (never rolls back)', () => {
    let s = seeded({ clockStartedAt: T0, clockPausedAt: T0 + 6 * MIN }, T0 + 50 * MIN) // seeded paused
    s = clockSyncReducer(s, { type: 'OPTIMISTIC', verb: 'resume', nowMs: T0 + 50 * MIN, token: 1 })
    const anchorBefore = s.localAnchor
    const t = clockSyncReducer(s, { type: 'PENDING_TIMEOUT' })
    expect(t.localAnchor).toBe(anchorBefore) // unchanged → no jump
    expect(t.pending).toBeNull()
    expect(t.baselineSig).toBe(clockEventSig(s.session))
  })

  it('PENDING_TIMEOUT with no pending is a no-op', () => {
    const s = seeded({ clockStartedAt: T0 }, T0)
    expect(clockSyncReducer(s, { type: 'PENDING_TIMEOUT' })).toBe(s)
  })
})

// ── F. Session-switch reset ─────────────────────────────────────────────────
describe('session switch', () => {
  it('RESET clears the optimistic anchor so the next echo seeds from the new session', () => {
    const a = seeded({ clockStartIndex: 3, clockStartedAt: T0, maximumStartIndex: 3 }, T0 + 1 * MIN)
    expect(a.localAnchor.startIndex).toBe(3)
    const reset = clockSyncReducer(a, { type: 'RESET' })
    expect(reset).toEqual(initialClockState)
    let b = clockSyncReducer(reset, { type: 'SET_TOURNAMENT', tournament: { structure: STRUCT } })
    b = clockSyncReducer(b, { type: 'ECHO', session: srv({ clockStartIndex: 0, clockStartedAt: T0 + 2 * MIN }), nowMs: T0 + 2 * MIN })
    expect(b.localAnchor.startIndex).toBe(0) // flight B, not A's stale anchor
  })
})

// ── G. No-regression (re-derivation invariants via the synthetic session) ────
describe('no-regression via synthetic session', () => {
  it('honors a capped slice from the live session (completes at the cap, not the break)', () => {
    const a = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    const done = deriveClock(syntheticSession(a, srv({ maximumEndIndex: 1 })), STRUCT, T0 + 60 * MIN)
    expect(done.isComplete).toBe(true)
    expect(done.currentIndex).toBe(1)
  })

  it('play-to-winner runs to the last structure index and holds complete at 0:00', () => {
    const a = seedAnchorFromSession(srv({ clockStartedAt: T0 }), T0)
    const r = deriveClock(syntheticSession(a, srv({ maximumEndIndex: null })), STRUCT, T0 + 200 * MIN)
    expect(r.currentIndex).toBe(3)
    expect(r.isComplete).toBe(true)
    expect(r.remainingMs).toBe(0)
  })

  it('a stopped server session yields no anchor → stopped derive (NOT-STARTED preview)', () => {
    let s = clockSyncReducer(initialClockState, { type: 'SET_TOURNAMENT', tournament: { structure: STRUCT } })
    s = clockSyncReducer(s, {
      type: 'ECHO',
      session: srv({ clockStartedAt: null, clockStartIndex: null, status: 'scheduled' }),
      nowMs: T0,
    })
    expect(s.localAnchor).toBeNull()
    expect(deriveClock(s.session, STRUCT, T0).state).toBe(CLOCK_STOPPED)
  })

  it('empty/absent structure does not throw', () => {
    const a = { startIndex: 0, startedAtMs: T0, pausedAtMs: null, status: 'inProgress' }
    expect(() => deriveClock(syntheticSession(a, srv()), [], T0)).not.toThrow()
    expect(optimisticChangeLevel(a, 'advance', T0, srv(), [])).toBeTruthy()
  })
})
