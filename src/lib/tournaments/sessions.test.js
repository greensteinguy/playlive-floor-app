import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'

// Only generateId is mocked (so session ids are deterministic and assertable);
// validateSessionPlan / deriveFormatFlags are pure. The real Session schema is
// imported below so the conformance tests prove buildSessionDocs emits docs that
// actually validate.
vi.mock('../firestore', () => ({
  generateId: vi.fn(),
}))

import { generateId } from '../firestore'
import { Session } from '../schema'
import { TournamentError } from './errors'
import { validateSessionPlan, deriveFormatFlags, buildSessionDocs, SINGLE_DAY_PLAN } from './sessions'

const TS = Timestamp.fromDate(new Date('2026-06-01T09:00:00Z'))
const ALT_TS = Timestamp.fromDate(new Date('2026-06-01T18:00:00Z'))

beforeEach(() => {
  vi.clearAllMocks()
  // s1, s2, s3, … in call order — buildSessionDocs pre-generates ids stage by
  // stage, flight by flight, so they're predictable.
  let n = 0
  generateId.mockImplementation(() => {
    n += 1
    return `s${n}`
  })
})

// Plan helpers (structure has 23 entries → indices 0..22).
const flight = (survivorsFrom = [], scheduledStartTime = null) => ({ scheduledStartTime, survivorsFrom })
const stage = (endStructureIndex, flights, playToPercentRemaining = null) => ({
  endStructureIndex,
  playToPercentRemaining,
  flights,
})

const singleDay = SINGLE_DAY_PLAN.stages
const multiDay = [
  stage(14, [flight()], 15),
  stage(21, [flight([0])]),
  stage(null, [flight([0])]),
]
const multiFlight = [
  stage(14, [flight(), flight()], 15), // Day 1A, 1B
  stage(null, [flight([0, 1])]), // Day 2: survivors from 1A + 1B
]
// The deep funnel: 4 Day-1 flights → 2 Day-2 flights → 1 final (N→N→1).
const funnel = [
  stage(9, [flight(), flight(), flight(), flight()]), // 1A 1B 1C 1D
  stage(18, [flight([0, 1]), flight([2, 3])]), // 2A←(1A,1B)  2B←(1C,1D)
  stage(null, [flight([0, 1])]), // 3 ← (2A,2B)
]

// ── validateSessionPlan — accepts ───────────────────────────────────────────

describe('validateSessionPlan — accepts sound plans', () => {
  it('accepts a single play-to-a-winner day', () => {
    expect(validateSessionPlan({ stages: singleDay }, 23)).toBeNull()
  })
  it('accepts a multi-day single-flight chain', () => {
    expect(validateSessionPlan({ stages: multiDay }, 23)).toBeNull()
  })
  it('accepts a simple multi-flight plan (flighted Day 1 → final Day 2)', () => {
    expect(validateSessionPlan({ stages: multiFlight }, 23)).toBeNull()
  })
  it('accepts a deep funnel (4 Day-1 → 2 Day-2 → final)', () => {
    expect(validateSessionPlan({ stages: funnel }, 23)).toBeNull()
  })
  it('accepts a final day capped at a concrete level (not play-to-a-winner)', () => {
    expect(validateSessionPlan({ stages: [stage(10, [flight()]), stage(22, [flight([0])])] }, 23)).toBeNull()
  })
})

// ── validateSessionPlan — rejects ───────────────────────────────────────────

describe('validateSessionPlan — rejects unsound plans', () => {
  it('rejects an empty plan', () => {
    expect(validateSessionPlan({ stages: [] }, 23)).toMatch(/at least one session/i)
  })
  it('rejects a stage with no flights', () => {
    expect(validateSessionPlan({ stages: [stage(null, [])] }, 23)).toMatch(/at least one flight/i)
  })
  it('rejects validation against an empty structure', () => {
    expect(validateSessionPlan({ stages: singleDay }, 0)).toMatch(/build the blind structure/i)
  })
  it('rejects a non-final day with no end level', () => {
    expect(validateSessionPlan({ stages: [stage(null, [flight()]), stage(null, [flight([0])])] }, 23)).toMatch(
      /Day 1: choose the level/i,
    )
  })
  it('rejects a flighted final day (would be two final sessions)', () => {
    const bad = [stage(14, [flight(), flight()]), stage(null, [flight([0]), flight([1])])]
    expect(validateSessionPlan({ stages: bad }, 23)).toMatch(/final day must be a single/i)
  })
  it('rejects a non-monotonic slice (day ends before it starts)', () => {
    const bad = [stage(14, [flight()]), stage(10, [flight([0])]), stage(null, [flight([0])])]
    expect(validateSessionPlan({ stages: bad }, 23)).toMatch(/Day 2: the end level must be at or after/i)
  })
  it('rejects an end level past the end of the structure', () => {
    expect(validateSessionPlan({ stages: [stage(30, [flight()]), stage(null, [flight([0])])] }, 23)).toMatch(
      /past the end of the structure/i,
    )
  })
  it('rejects when earlier days consume the whole structure', () => {
    expect(validateSessionPlan({ stages: [stage(22, [flight()]), stage(null, [flight([0])])] }, 23)).toMatch(
      /Day 2 starts past the end/i,
    )
  })
  it('rejects an out-of-range playToPercentRemaining', () => {
    expect(validateSessionPlan({ stages: [stage(null, [flight()], 150)] }, 23)).toMatch(/between 0 and 100/i)
  })

  // ── Routing partition ──
  it('rejects an orphaned upstream flight (a Day-1 flight feeds nothing)', () => {
    const bad = [stage(14, [flight(), flight()]), stage(null, [flight([0])])] // flight B (1) unassigned
    expect(validateSessionPlan({ stages: bad }, 23)).toMatch(/Day 1: flight B doesn't feed into any Day 2/i)
  })
  it('rejects a split upstream flight (survivors going to two next-day flights)', () => {
    const bad = [stage(9, [flight(), flight()]), stage(18, [flight([0]), flight([0, 1])]), stage(null, [flight([0, 1])])]
    expect(validateSessionPlan({ stages: bad }, 23)).toMatch(/feeds into more than one Day 2/i)
  })
  it('rejects a survivorsFrom reference to a non-existent upstream flight', () => {
    const bad = [stage(14, [flight()]), stage(null, [flight([5])])]
    expect(validateSessionPlan({ stages: bad }, 23)).toMatch(/references a Day 1 flight that doesn't exist/i)
  })
  it('rejects a later-stage flight with no upstream assignment', () => {
    const bad = [stage(14, [flight()]), stage(null, [flight()])]
    expect(validateSessionPlan({ stages: bad }, 23)).toMatch(/must take survivors from at least one Day 1/i)
  })
  it('rejects a Day-1 flight that claims survivors from an earlier day', () => {
    const bad = [stage(14, [flight([0])]), stage(null, [flight([0])])]
    expect(validateSessionPlan({ stages: bad }, 23)).toMatch(/first day's flights can't take survivors/i)
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
  it('multi-flight → both flags', () => {
    expect(deriveFormatFlags(multiFlight)).toEqual({ isMultiDay: true, isMultiFlight: true })
  })
  it('deep funnel → both flags', () => {
    expect(deriveFormatFlags(funnel)).toEqual({ isMultiDay: true, isMultiFlight: true })
  })
})

// ── buildSessionDocs ────────────────────────────────────────────────────────

function build(stages, overrides = {}) {
  return buildSessionDocs({
    stages,
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
    expect(docs[0]).toMatchObject({
      id: 's1',
      tournamentId: 'tour-1',
      convergesIntoSessionId: null,
      dayNumber: 1,
      flightLabel: null,
      sessionLabel: 'Day 1',
      maximumStartIndex: 0,
      maximumEndIndex: null,
      status: 'scheduled',
      createdBy: 'manager-1',
    })
    expect(docs[0].scheduledStartTime).toBe(TS)
  })
})

describe('buildSessionDocs — multi-day single-flight', () => {
  it('tiles contiguous slices and chains convergence to one final', () => {
    const [d1, d2, d3] = build(multiDay)
    expect(d1).toMatchObject({ dayNumber: 1, maximumStartIndex: 0, maximumEndIndex: 14, flightLabel: null })
    expect(d2).toMatchObject({ dayNumber: 2, maximumStartIndex: 15, maximumEndIndex: 21 })
    expect(d3).toMatchObject({ dayNumber: 3, maximumStartIndex: 22, maximumEndIndex: null })
    expect(d1.convergesIntoSessionId).toBe(d2.id)
    expect(d2.convergesIntoSessionId).toBe(d3.id)
    expect(d3.convergesIntoSessionId).toBeNull()
    expect(d1.playToPercentRemaining).toBe(15)
  })
})

describe('buildSessionDocs — simple multi-flight', () => {
  it('parallel Day-1 flights share a slice and converge into the single final', () => {
    const [a, b, final] = build(multiFlight)
    expect(a).toMatchObject({ dayNumber: 1, flightLabel: 'A', sessionLabel: 'Day 1A', maximumStartIndex: 0, maximumEndIndex: 14 })
    expect(b).toMatchObject({ dayNumber: 1, flightLabel: 'B', sessionLabel: 'Day 1B', maximumStartIndex: 0, maximumEndIndex: 14 })
    expect(a.convergesIntoSessionId).toBe(final.id)
    expect(b.convergesIntoSessionId).toBe(final.id)
    expect(final).toMatchObject({ dayNumber: 2, flightLabel: null, maximumStartIndex: 15, maximumEndIndex: null, convergesIntoSessionId: null })
  })
})

describe('buildSessionDocs — deep funnel (N→N→1)', () => {
  it('routes each upstream group into its assigned downstream flight, down to one final', () => {
    const docs = build(funnel)
    expect(docs).toHaveLength(7)
    const [a, b, c, d, twoA, twoB, three] = docs

    // Stage labels + tiled slices.
    expect([a, b, c, d].map((s) => s.sessionLabel)).toEqual(['Day 1A', 'Day 1B', 'Day 1C', 'Day 1D'])
    expect([a, b, c, d].every((s) => s.maximumStartIndex === 0 && s.maximumEndIndex === 9)).toBe(true)
    expect(twoA).toMatchObject({ sessionLabel: 'Day 2A', maximumStartIndex: 10, maximumEndIndex: 18 })
    expect(twoB).toMatchObject({ sessionLabel: 'Day 2B', maximumStartIndex: 10, maximumEndIndex: 18 })
    expect(three).toMatchObject({ sessionLabel: 'Day 3', maximumStartIndex: 19, maximumEndIndex: null })

    // The funnel: 1A,1B → 2A ; 1C,1D → 2B ; 2A,2B → 3 ; 3 → null.
    expect(a.convergesIntoSessionId).toBe(twoA.id)
    expect(b.convergesIntoSessionId).toBe(twoA.id)
    expect(c.convergesIntoSessionId).toBe(twoB.id)
    expect(d.convergesIntoSessionId).toBe(twoB.id)
    expect(twoA.convergesIntoSessionId).toBe(three.id)
    expect(twoB.convergesIntoSessionId).toBe(three.id)
    expect(three.convergesIntoSessionId).toBeNull()

    // Exactly one final session.
    expect(docs.filter((s) => s.convergesIntoSessionId === null)).toHaveLength(1)
  })
})

describe('buildSessionDocs — per-flight scheduling', () => {
  it('each flight uses its own start time, falling back to the tournament start', () => {
    const stages = [
      stage(14, [flight([], null), flight([], ALT_TS)]), // 1A → TS (default); 1B → its own ALT_TS
      stage(null, [flight([0, 1], null)]), // Day 2 → TS (default)
    ]
    const [a, b, final] = build(stages)
    expect(a.scheduledStartTime).toBe(TS)
    expect(b.scheduledStartTime).toBe(ALT_TS)
    expect(final.scheduledStartTime).toBe(TS)
  })
})

describe('buildSessionDocs — schema conformance', () => {
  for (const [name, plan] of [
    ['single-day', singleDay],
    ['multi-flight', multiFlight],
    ['deep funnel', funnel],
  ]) {
    it(`every emitted session passes the real Session schema (${name})`, () => {
      for (const s of build(plan)) {
        const result = Session.safeParse(s)
        expect(result.success, result.error?.toString()).toBe(true)
      }
    })
  }
})

describe('buildSessionDocs — rejection', () => {
  it('throws TournamentError on an unsound plan (emits no partial graph)', () => {
    const bad = [stage(14, [flight()]), stage(10, [flight([0])]), stage(null, [flight([0])])]
    expect(() => build(bad)).toThrow(TournamentError)
  })
})
