import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'

// Only generateId is mocked (so session ids are deterministic and assertable);
// validateSessionPlan / deriveFormatFlags are pure and need nothing. The real
// Session schema is imported below so the conformance test proves buildSessionDocs
// emits documents that actually validate.
vi.mock('../firestore', () => ({
  generateId: vi.fn(),
}))

import { generateId } from '../firestore'
import { Session } from '../schema'
import { TournamentError } from './errors'
import {
  validateSessionPlan,
  deriveFormatFlags,
  buildSessionDocs,
  SINGLE_DAY_PLAN,
} from './sessions'

const TS = Timestamp.fromDate(new Date('2026-06-01T09:00:00Z'))
const DAY2_TS = Timestamp.fromDate(new Date('2026-06-02T12:00:00Z'))

beforeEach(() => {
  vi.clearAllMocks()
  // s1, s2, s3, … in call order — buildSessionDocs generates day-by-day,
  // flight-by-flight, so ids are predictable.
  let n = 0
  generateId.mockImplementation(() => {
    n += 1
    return `s${n}`
  })
})

// Common plan shapes (structure has 23 entries → indices 0..22).
const singleDay = SINGLE_DAY_PLAN.days
const multiDay = [
  { flightCount: 1, endStructureIndex: 14, playToPercentRemaining: 15, scheduledStartTime: null },
  { flightCount: 1, endStructureIndex: 21, playToPercentRemaining: null, scheduledStartTime: null },
  { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
]
const multiFlight = [
  { flightCount: 2, endStructureIndex: 14, playToPercentRemaining: 15, scheduledStartTime: null },
  { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
]

// ── validateSessionPlan ─────────────────────────────────────────────────────

describe('validateSessionPlan — accepts sound plans', () => {
  it('accepts a single play-to-a-winner day', () => {
    expect(validateSessionPlan({ days: singleDay }, 23)).toBeNull()
  })
  it('accepts a multi-day single-flight chain', () => {
    expect(validateSessionPlan({ days: multiDay }, 23)).toBeNull()
  })
  it('accepts a multi-flight plan (flighted Day 1 → final Day 2)', () => {
    expect(validateSessionPlan({ days: multiFlight }, 23)).toBeNull()
  })
  it('accepts a final day capped at a concrete level (strict cap, not play-to-a-winner)', () => {
    const days = [
      { flightCount: 1, endStructureIndex: 10, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: 22, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(validateSessionPlan({ days }, 23)).toBeNull()
  })
})

describe('validateSessionPlan — rejects unsound plans', () => {
  it('rejects an empty plan', () => {
    expect(validateSessionPlan({ days: [] }, 23)).toMatch(/at least one session/i)
  })
  it('rejects a plan validated against an empty structure', () => {
    expect(validateSessionPlan({ days: singleDay }, 0)).toMatch(/build the blind structure/i)
  })
  it('rejects a non-final day with no end level', () => {
    const days = [
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(validateSessionPlan({ days }, 23)).toMatch(/Day 1: choose the level/i)
  })
  it('rejects a flighted final day (two final sessions)', () => {
    const days = [
      { flightCount: 2, endStructureIndex: 14, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 2, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(validateSessionPlan({ days }, 23)).toMatch(/final day must be a single/i)
  })
  it('rejects a non-monotonic slice (day ends before it starts)', () => {
    const days = [
      { flightCount: 1, endStructureIndex: 14, playToPercentRemaining: null, scheduledStartTime: null },
      // Day 2 starts at 15 but is told to end at 10.
      { flightCount: 1, endStructureIndex: 10, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(validateSessionPlan({ days }, 23)).toMatch(/Day 2: the end level must be at or after/i)
  })
  it('rejects an end level past the end of the structure', () => {
    const days = [
      { flightCount: 1, endStructureIndex: 30, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(validateSessionPlan({ days }, 23)).toMatch(/past the end of the structure/i)
  })
  it('rejects when earlier days consume the whole structure (final day has no room)', () => {
    const days = [
      { flightCount: 1, endStructureIndex: 22, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(validateSessionPlan({ days }, 23)).toMatch(/Day 2 starts past the end/i)
  })
  it('rejects an out-of-range playToPercentRemaining', () => {
    const days = [{ flightCount: 1, endStructureIndex: null, playToPercentRemaining: 150, scheduledStartTime: null }]
    expect(validateSessionPlan({ days }, 23)).toMatch(/between 0 and 100/i)
  })
  it('rejects a non-positive flight count', () => {
    const days = [{ flightCount: 0, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null }]
    expect(validateSessionPlan({ days }, 23)).toMatch(/number of flights/i)
  })
})

// ── deriveFormatFlags ───────────────────────────────────────────────────────

describe('deriveFormatFlags', () => {
  it('single day → neither flag', () => {
    expect(deriveFormatFlags(singleDay)).toEqual({ isMultiDay: false, isMultiFlight: false })
  })
  it('multi-day single-flight → multiDay only', () => {
    expect(deriveFormatFlags(multiDay)).toEqual({ isMultiDay: true, isMultiFlight: false })
  })
  it('multi-flight → both flags (and multiFlight implies multiDay)', () => {
    expect(deriveFormatFlags(multiFlight)).toEqual({ isMultiDay: true, isMultiFlight: true })
  })
})

// ── buildSessionDocs — single day ───────────────────────────────────────────

function build(days, overrides = {}) {
  return buildSessionDocs({
    days,
    tournamentId: 'tour-1',
    structureLength: 23,
    defaultScheduledStartTime: TS,
    actorId: 'manager-1',
    timestamp: TS,
    ...overrides,
  })
}

describe('buildSessionDocs — single day', () => {
  it('emits exactly one final session that plays to a winner', () => {
    const docs = build(singleDay)
    expect(docs).toHaveLength(1)
    const s = docs[0]
    expect(s).toMatchObject({
      id: 's1',
      tournamentId: 'tour-1',
      convergesIntoSessionId: null,
      dayNumber: 1,
      flightLabel: null,
      sessionLabel: 'Day 1',
      maximumStartIndex: 0,
      maximumEndIndex: null,
      playToPercentRemaining: null,
      actualStartIndex: null,
      actualEndIndex: null,
      status: 'scheduled',
      currentStructureIndex: null,
      remainingPlayerCount: null,
      createdBy: 'manager-1',
    })
    expect(s.scheduledStartTime).toBe(TS)
  })
})

// ── buildSessionDocs — multi-day single-flight ──────────────────────────────

describe('buildSessionDocs — multi-day single-flight', () => {
  it('tiles contiguous non-overlapping slices and chains convergence', () => {
    const docs = build(multiDay)
    expect(docs).toHaveLength(3)
    const [d1, d2, d3] = docs

    expect(d1).toMatchObject({ dayNumber: 1, maximumStartIndex: 0, maximumEndIndex: 14, flightLabel: null })
    expect(d2).toMatchObject({ dayNumber: 2, maximumStartIndex: 15, maximumEndIndex: 21 })
    expect(d3).toMatchObject({ dayNumber: 3, maximumStartIndex: 22, maximumEndIndex: null })

    // Convergence chain: Day 1 → Day 2 → Day 3 → null.
    expect(d1.convergesIntoSessionId).toBe(d2.id)
    expect(d2.convergesIntoSessionId).toBe(d3.id)
    expect(d3.convergesIntoSessionId).toBeNull()

    // Exactly one final session.
    expect(docs.filter((s) => s.convergesIntoSessionId === null)).toHaveLength(1)

    // playToPercentRemaining carried through.
    expect(d1.playToPercentRemaining).toBe(15)
    expect(d2.playToPercentRemaining).toBeNull()
  })

  it('Day 1 uses the tournament start; later days use their own start (else fall back)', () => {
    const days = [
      { flightCount: 1, endStructureIndex: 14, playToPercentRemaining: null, scheduledStartTime: DAY2_TS },
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: DAY2_TS },
    ]
    const [d1, d2] = build(days)
    // Day 1's own time is ignored in favour of the tournament start.
    expect(d1.scheduledStartTime).toBe(TS)
    expect(d2.scheduledStartTime).toBe(DAY2_TS)

    // A later day with no time of its own falls back to the tournament start.
    const days2 = [
      { flightCount: 1, endStructureIndex: 14, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(build(days2)[1].scheduledStartTime).toBe(TS)
  })
})

// ── buildSessionDocs — multi-flight ─────────────────────────────────────────

describe('buildSessionDocs — multi-flight', () => {
  it('parallel flights share a slice and converge into the next day; final is single', () => {
    const docs = build(multiFlight)
    expect(docs).toHaveLength(3)
    const [a, b, final] = docs

    // Day 1A and Day 1B: same day, same slice, distinct flight labels.
    expect(a).toMatchObject({ dayNumber: 1, flightLabel: 'A', sessionLabel: 'Day 1A', maximumStartIndex: 0, maximumEndIndex: 14 })
    expect(b).toMatchObject({ dayNumber: 1, flightLabel: 'B', sessionLabel: 'Day 1B', maximumStartIndex: 0, maximumEndIndex: 14 })

    // Both flights converge into the same Day 2 session.
    expect(a.convergesIntoSessionId).toBe(final.id)
    expect(b.convergesIntoSessionId).toBe(final.id)

    // The Day 2 session picks up where Day 1's slice ended, plays to a winner, and is the sole final.
    expect(final).toMatchObject({ dayNumber: 2, flightLabel: null, sessionLabel: 'Day 2', maximumStartIndex: 15, maximumEndIndex: null, convergesIntoSessionId: null })
    expect(docs.filter((s) => s.convergesIntoSessionId === null)).toHaveLength(1)
  })
})

// ── buildSessionDocs — schema conformance + rejection ───────────────────────

describe('buildSessionDocs — schema conformance', () => {
  it('every emitted session passes the real Session schema (single-day)', () => {
    for (const s of build(singleDay)) {
      const result = Session.safeParse(s)
      expect(result.success, result.error?.toString()).toBe(true)
    }
  })
  it('every emitted session passes the real Session schema (multi-flight)', () => {
    for (const s of build(multiFlight)) {
      const result = Session.safeParse(s)
      expect(result.success, result.error?.toString()).toBe(true)
    }
  })
})

describe('buildSessionDocs — rejection', () => {
  it('throws TournamentError on an unsound plan (does not emit a partial graph)', () => {
    const bad = [
      { flightCount: 1, endStructureIndex: 14, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: 10, playToPercentRemaining: null, scheduledStartTime: null },
      { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
    ]
    expect(() => build(bad)).toThrow(TournamentError)
  })
})
