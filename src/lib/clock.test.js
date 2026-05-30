import { describe, it, expect } from 'vitest'
import {
  CLOCK_STOPPED,
  CLOCK_RUNNING,
  CLOCK_PAUSED,
  clockState,
  clockSliceEndIndex,
  deriveClock,
  formatRemaining,
  resumeStartedAtMs,
} from './clock'

const MIN = 60_000
const T0 = 1_700_000_000_000

// 0: level 20m | 1: level 30m | 2: break 10m | 3: level 25m  (indices 0..3)
const STRUCT = [
  { type: 'level', blindNumber: 1, smallBlind: 100, bigBlind: 200, ante: 0, bringIn: 0, durationMinutes: 20 },
  { type: 'level', blindNumber: 2, smallBlind: 200, bigBlind: 400, ante: 0, bringIn: 0, durationMinutes: 30 },
  { type: 'break', durationMinutes: 10, label: 'Break', isColorUp: true },
  { type: 'level', blindNumber: 3, smallBlind: 300, bigBlind: 600, ante: 0, bringIn: 0, durationMinutes: 25 },
]

// Clock anchor fields are passed as raw ms numbers (deriveClock accepts those).
function sess(overrides = {}) {
  return {
    clockStartIndex: 0,
    clockStartedAt: T0,
    clockPausedAt: null,
    maximumStartIndex: 0,
    maximumEndIndex: null,
    ...overrides,
  }
}

describe('clockState', () => {
  it('is stopped when never started', () => {
    expect(clockState(sess({ clockStartedAt: null, clockStartIndex: null }))).toBe(CLOCK_STOPPED)
    expect(clockState(null)).toBe(CLOCK_STOPPED)
  })
  it('is running when started and not paused', () => {
    expect(clockState(sess())).toBe(CLOCK_RUNNING)
  })
  it('is paused when a pause time is set', () => {
    expect(clockState(sess({ clockPausedAt: T0 + 5 * MIN }))).toBe(CLOCK_PAUSED)
  })
})

describe('clockSliceEndIndex', () => {
  it('uses the last structure index for an uncapped (play-to-winner) session', () => {
    expect(clockSliceEndIndex(sess({ maximumEndIndex: null }), STRUCT.length)).toBe(3)
  })
  it('uses maximumEndIndex when capped, clamped to bounds', () => {
    expect(clockSliceEndIndex(sess({ maximumEndIndex: 1 }), STRUCT.length)).toBe(1)
    expect(clockSliceEndIndex(sess({ maximumEndIndex: 99 }), STRUCT.length)).toBe(3)
  })
  it('returns -1 for an empty structure', () => {
    expect(clockSliceEndIndex(sess(), 0)).toBe(-1)
  })
})

describe('deriveClock — stopped / degenerate', () => {
  it('returns an empty clock when stopped', () => {
    const c = deriveClock(sess({ clockStartedAt: null, clockStartIndex: null }), STRUCT, T0)
    expect(c.state).toBe(CLOCK_STOPPED)
    expect(c.currentIndex).toBeNull()
    expect(c.isComplete).toBe(false)
  })
  it('returns empty when the structure is empty', () => {
    expect(deriveClock(sess(), [], T0).currentIndex).toBeNull()
  })
})

describe('deriveClock — running', () => {
  it('sits at the anchor level with full time at the very start', () => {
    const c = deriveClock(sess(), STRUCT, T0)
    expect(c.state).toBe(CLOCK_RUNNING)
    expect(c.currentIndex).toBe(0)
    expect(c.currentEntry.blindNumber).toBe(1)
    expect(c.remainingMs).toBe(20 * MIN)
    expect(c.elapsedInLevelMs).toBe(0)
    expect(c.levelDurationMs).toBe(20 * MIN)
    expect(c.nextIndex).toBe(1)
    expect(c.nextEntry.blindNumber).toBe(2)
    expect(c.isComplete).toBe(false)
  })

  it('counts down within the current level', () => {
    const c = deriveClock(sess(), STRUCT, T0 + 5 * MIN)
    expect(c.currentIndex).toBe(0)
    expect(c.remainingMs).toBe(15 * MIN)
    expect(c.elapsedInLevelMs).toBe(5 * MIN)
  })

  it('auto-advances into the next level once the prior one elapses', () => {
    // 20m (level 0) consumed + 5m into level 1
    const c = deriveClock(sess(), STRUCT, T0 + 25 * MIN)
    expect(c.currentIndex).toBe(1)
    expect(c.currentEntry.blindNumber).toBe(2)
    expect(c.remainingMs).toBe(25 * MIN)
    expect(c.nextIndex).toBe(2)
    expect(c.nextEntry.type).toBe('break')
  })

  it('lands on a break entry', () => {
    // 20m + 30m = 50m consumed, +2m into the break (index 2)
    const c = deriveClock(sess(), STRUCT, T0 + 52 * MIN)
    expect(c.currentIndex).toBe(2)
    expect(c.currentEntry.type).toBe('break')
    expect(c.remainingMs).toBe(8 * MIN)
    expect(c.nextIndex).toBe(3)
  })

  it('marks complete and holds on the last entry once the slice is exhausted', () => {
    // total slice = 20+30+10+25 = 85m; well past it
    const c = deriveClock(sess(), STRUCT, T0 + 200 * MIN)
    expect(c.isComplete).toBe(true)
    expect(c.currentIndex).toBe(3)
    expect(c.remainingMs).toBe(0)
    expect(c.nextIndex).toBeNull()
  })

  it('respects maximumEndIndex (a capped day) — completes at the cap, never the break', () => {
    const capped = sess({ maximumEndIndex: 1 })
    // at the cap level (1), nextIndex is null because the slice ends there
    const mid = deriveClock(capped, STRUCT, T0 + 25 * MIN)
    expect(mid.currentIndex).toBe(1)
    expect(mid.nextIndex).toBeNull()
    // past the cap (20+30=50m) → complete at index 1, not the break at index 2
    const done = deriveClock(capped, STRUCT, T0 + 60 * MIN)
    expect(done.isComplete).toBe(true)
    expect(done.currentIndex).toBe(1)
  })

  it('starts from a non-zero anchor index (after a manual jump)', () => {
    const jumped = sess({ clockStartIndex: 2, maximumStartIndex: 0 })
    const c = deriveClock(jumped, STRUCT, T0)
    expect(c.currentIndex).toBe(2)
    expect(c.currentEntry.type).toBe('break')
    expect(c.remainingMs).toBe(10 * MIN)
  })
})

describe('deriveClock — paused (frozen)', () => {
  it('freezes at clockPausedAt regardless of how much later "now" is', () => {
    const paused = sess({ clockPausedAt: T0 + 10 * MIN })
    const a = deriveClock(paused, STRUCT, T0 + 10 * MIN)
    const b = deriveClock(paused, STRUCT, T0 + 999 * MIN)
    expect(a).toEqual(b) // now is ignored while paused
    expect(b.state).toBe(CLOCK_PAUSED)
    expect(b.currentIndex).toBe(0)
    expect(b.remainingMs).toBe(10 * MIN)
  })
})

describe('formatRemaining', () => {
  it('formats M:SS', () => {
    expect(formatRemaining(65_000)).toBe('1:05')
    expect(formatRemaining(5_000)).toBe('0:05')
    expect(formatRemaining(20 * MIN)).toBe('20:00')
  })
  it('formats H:MM:SS past an hour', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00')
    expect(formatRemaining(3_661_000)).toBe('1:01:01')
  })
  it('clamps negatives to 0:00 and rounds up partial seconds', () => {
    expect(formatRemaining(-500)).toBe('0:00')
    expect(formatRemaining(0)).toBe('0:00')
    expect(formatRemaining(1_500)).toBe('0:02')
  })
})

describe('resumeStartedAtMs', () => {
  it('shifts the anchor forward by the paused duration so elapsed-in-level is preserved', () => {
    const started = T0
    const pausedAt = T0 + 6 * MIN // 6 minutes elapsed at the moment of pause
    const resumeNow = T0 + 100 * MIN // resumed 94 minutes later
    const newStarted = resumeStartedAtMs(started, pausedAt, resumeNow)
    // Right after resume, elapsed = now - newStarted should equal elapsed-at-pause (6m)
    expect(resumeNow - newStarted).toBe(6 * MIN)
  })

  it('round-trips through deriveClock: resume continues where pause left off', () => {
    // Paused 6m into level 0.
    const pausedAt = T0 + 6 * MIN
    const pausedClock = deriveClock(sess({ clockPausedAt: pausedAt }), STRUCT, T0 + 50 * MIN)
    expect(pausedClock.remainingMs).toBe(14 * MIN)
    // Resume much later; re-anchor and the remaining time is unchanged at resume instant.
    const resumeNow = T0 + 500 * MIN
    const newStarted = resumeStartedAtMs(T0, pausedAt, resumeNow)
    const resumed = deriveClock(
      sess({ clockStartedAt: newStarted, clockPausedAt: null }),
      STRUCT,
      resumeNow,
    )
    expect(resumed.state).toBe(CLOCK_RUNNING)
    expect(resumed.currentIndex).toBe(0)
    expect(resumed.remainingMs).toBe(14 * MIN)
  })
})
