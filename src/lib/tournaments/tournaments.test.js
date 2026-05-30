import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'

// Only the data layer is mocked — the real Tournament schema is imported below
// so we can assert the op assembles a document that actually validates. The
// mocked batch set / mock tx.set do NOT validate, so the schema-conformance
// tests below run Tournament.safeParse on the captured document explicitly.
// createTournament writes the tournament doc + its sessions in one
// runValidatedBatch; the mock records every set() so we can pull the tournament
// (2-segment path) and sessions (4-segment path) back out.
vi.mock('../firestore', () => ({
  runValidatedBatch: vi.fn(),
  runValidatedTransaction: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  generateId: vi.fn(),
  paths: {
    tournamentPath: (id) => ['tournaments', id],
    sessionPath: (tid, sid) => ['tournaments', tid, 'sessions', sid],
  },
}))

import { runValidatedBatch, runValidatedTransaction, auditLog, generateId } from '../firestore'
import { Tournament, Session } from '../schema'
import { createTournament, updateTournament, setTournamentStatus } from './tournaments'
import { TournamentError } from './errors'

let mockState
// set() calls recorded by the runValidatedBatch mock, in order.
let batchSets

const LEVELS = [
  { type: 'level', blindNumber: 1, smallBlind: 100, bigBlind: 200, ante: 0, bringIn: 0, durationMinutes: 20 },
  { type: 'break', durationMinutes: 10, label: null, isColorUp: false },
  { type: 'level', blindNumber: 2, smallBlind: 200, bigBlind: 400, ante: 0, bringIn: 0, durationMinutes: 20 },
]

// Minimal valid create-form inputs: an NLH freezeout. Tests override the bits
// they exercise.
function makeArgs(overrides = {}) {
  return {
    name: 'Friday $100 NLH',
    gameType: 'nlh',
    buyIn: 100_00,
    startingStack: 20_000,
    structure: LEVELS,
    scheduledStartTime: new Date('2026-06-01T09:00:00Z'),
    reentryConfig: { type: 'freezeout', maxReentries: null, maxRebuys: null, hasAddOn: false, addOnCost: null, addOnChips: null },
    actorId: 'manager-1',
    actorRole: 'manager',
    ...overrides,
  }
}

// The tournament document the op set in the batch (2-segment path).
function capturedDoc() {
  return batchSets.find((c) => c.path.length === 2)?.data
}

// The session documents the op set in the batch (4-segment path), in order.
function capturedSessions() {
  return batchSets.filter((c) => c.path.length === 4).map((c) => c.data)
}

// A full, schema-valid Tournament doc to seed as the "current" row updateTournament
// reads. Mirrors createTournament's assembly (the create schema-conformance tests
// prove this exact nlh-freezeout shape validates); tests override the bits they
// exercise.
function makeTournament(overrides = {}) {
  return {
    id: 'tour-1',
    legacyId: null,
    name: 'Friday $100 NLH',
    shortDescription: '',
    isMultiDay: false,
    isMultiFlight: false,
    gameType: 'nlh',
    buyIn: 100_00,
    hospitalityCost: 0,
    guarantee: 0,
    houseConsumption: 0,
    structureTemplateId: null,
    startingStack: 20_000,
    structure: LEVELS,
    payoutStructure: { type: 'byPercent', rounding: 'nearest5', positions: [{ place: 1, payout: 0, percent: 1 }] },
    scheduledStartTime: Timestamp.fromDate(new Date('2026-06-01T09:00:00Z')),
    lateRegCutoffTime: null,
    status: 'scheduled',
    isOnBreak: false,
    pausedAt: null,
    reentryConfig: { type: 'freezeout', maxReentries: null, maxRebuys: null, hasAddOn: false, addOnCost: null, addOnChips: null },
    hasUpperDeckMainDeck: false,
    satelliteConfig: null,
    bountyPoolConfig: null,
    fromTemplateId: null,
    currentStructureIndex: null,
    entryCount: 0,
    uniquePlayerCount: 0,
    remainingPlayerCount: 0,
    totalPrizePool: 0,
    finishedAt: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: 'manager-1',
    archivedAt: null,
    ...overrides,
  }
}

// The document updateTournament handed to the transaction's tx.set, for tour-1.
function updatedDoc() {
  return mockState.calls.set.find((c) => c.path[1] === 'tour-1')?.data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState = makeMockStore()
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  // Record each batch set() and echo the doc back (id attached), mirroring the
  // real helper's return — the data already carries the id.
  batchSets = []
  runValidatedBatch.mockImplementation(async (fn) => {
    batchSets = [] // fresh record per create, so capturedDoc() reflects the latest call
    const b = {
      set: (pathParts, _schema, data) => {
        const id = pathParts[pathParts.length - 1]
        const doc = { ...data, id }
        batchSets.push({ path: pathParts, data: doc })
        return doc
      },
      update: () => {},
      delete: () => {},
    }
    await fn(b)
  })
  // Unique ids in call order: the tournament id is generated first ('tour-generated'),
  // then one per session ('sess-1', 'sess-2', …).
  let n = 0
  generateId.mockImplementation(() => {
    n += 1
    return n === 1 ? 'tour-generated' : `sess-${n - 1}`
  })
})

// ── Document assembly ─────────────────────────────────────────────────────────

describe('createTournament — document assembly', () => {
  it('persists at the generated id (in one batch) and echoes the assembled document back', async () => {
    const created = await createTournament(makeArgs())

    expect(runValidatedBatch).toHaveBeenCalledTimes(1)
    const tourSet = batchSets.find((c) => c.path.length === 2)
    expect(tourSet.path).toEqual(['tournaments', 'tour-generated'])
    expect(tourSet.data).toMatchObject({
      id: 'tour-generated',
      name: 'Friday $100 NLH',
      gameType: 'nlh',
      buyIn: 100_00,
      startingStack: 20_000,
      structure: LEVELS,
      createdBy: 'manager-1',
    })
    expect(created).toEqual(tourSet.data)
  })

  it('fills the live-state, counters, and audit fields the form does not own', async () => {
    await createTournament(makeArgs())
    const doc = capturedDoc()

    expect(doc.legacyId).toBeNull()
    expect(doc.isOnBreak).toBe(false)
    expect(doc.pausedAt).toBeNull()
    expect(doc.currentStructureIndex).toBeNull()
    expect(doc.entryCount).toBe(0)
    expect(doc.uniquePlayerCount).toBe(0)
    expect(doc.remainingPlayerCount).toBe(0)
    expect(doc.totalPrizePool).toBe(0)
    expect(doc.finishedAt).toBeNull()
    expect(doc.archivedAt).toBeNull()
    // createdAt and updatedAt come from a single now() — identical on create.
    expect(doc.createdAt).toBeInstanceOf(Timestamp)
    expect(doc.createdAt).toBe(doc.updatedAt)
  })

  it('defaults optional money fields to 0 and status to scheduled', async () => {
    await createTournament(makeArgs())
    const doc = capturedDoc()
    expect(doc.shortDescription).toBe('')
    expect(doc.hospitalityCost).toBe(0)
    expect(doc.guarantee).toBe(0)
    expect(doc.houseConsumption).toBe(0)
    expect(doc.isMultiDay).toBe(false)
    expect(doc.isMultiFlight).toBe(false)
    expect(doc.hasUpperDeckMainDeck).toBe(false)
    expect(doc.structureTemplateId).toBeNull()
    expect(doc.fromTemplateId).toBeNull()
    expect(doc.status).toBe('scheduled')
  })
})

// ── Payout default ─────────────────────────────────────────────────────────────

describe('createTournament — payout default', () => {
  it('seeds a winner-takes-all payout when payoutStructure is null', async () => {
    await createTournament(makeArgs({ payoutStructure: null }))
    expect(capturedDoc().payoutStructure).toEqual({
      type: 'byPercent',
      rounding: 'nearest5',
      positions: [{ place: 1, payout: 0, percent: 1 }],
    })
  })

  it('passes through an explicit payoutStructure', async () => {
    const payout = {
      type: 'byPlace',
      rounding: 'none',
      positions: [
        { place: 1, payout: 600_00, percent: null },
        { place: 2, payout: 400_00, percent: null },
      ],
    }
    await createTournament(makeArgs({ payoutStructure: payout }))
    expect(capturedDoc().payoutStructure).toEqual(payout)
  })
})

// ── Time conversion (Date → Firestore Timestamp) ───────────────────────────────

describe('createTournament — time conversion', () => {
  it('converts a Date scheduledStartTime to a Firestore Timestamp', async () => {
    const when = new Date('2026-06-01T09:00:00Z')
    await createTournament(makeArgs({ scheduledStartTime: when }))
    const ts = capturedDoc().scheduledStartTime
    expect(ts).toBeInstanceOf(Timestamp)
    expect(ts.toMillis()).toBe(when.getTime())
  })

  it('converts a Date lateRegCutoffTime and preserves null', async () => {
    const cutoff = new Date('2026-06-01T11:00:00Z')
    await createTournament(makeArgs({ lateRegCutoffTime: cutoff }))
    const ts = capturedDoc().lateRegCutoffTime
    expect(ts).toBeInstanceOf(Timestamp)
    expect(ts.toMillis()).toBe(cutoff.getTime())

    // A second create with no cutoff — the batch mock resets its record per
    // call, so capturedDoc() now reflects this create.
    await createTournament(makeArgs({ lateRegCutoffTime: null }))
    expect(capturedDoc().lateRegCutoffTime).toBeNull()
  })
})

// ── Schema conformance — the assembled doc must pass the REAL Tournament schema ─

describe('createTournament — schema conformance', () => {
  it('assembles a document that passes the real Tournament schema (nlh freezeout)', async () => {
    await createTournament(makeArgs())
    const result = Tournament.safeParse(capturedDoc())
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('assembles a valid satellite tournament (satelliteConfig set)', async () => {
    await createTournament(
      makeArgs({ gameType: 'satellite', satelliteConfig: { ticketReward: 500_00 } })
    )
    const result = Tournament.safeParse(capturedDoc())
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('assembles a valid mystery bounty tournament (bountyPoolConfig set)', async () => {
    await createTournament(
      makeArgs({
        gameType: 'mysteryBounty',
        bountyPoolConfig: { totalPool: 300_00, bountyValues: [100_00, 200_00] },
      })
    )
    const result = Tournament.safeParse(capturedDoc())
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('assembles a valid multi-flight tournament and derives the format flags from the plan', async () => {
    await createTournament(
      makeArgs({
        // Day 1 has two flights (slice [0..0]) converging into a play-to-a-winner Day 2.
        sessionPlan: {
          days: [
            { flightCount: 2, endStructureIndex: 0, playToPercentRemaining: 15, scheduledStartTime: null },
            { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
          ],
        },
      })
    )
    const doc = capturedDoc()
    // Flags are DERIVED from the plan (not passed by the caller).
    expect(doc.isMultiDay).toBe(true)
    expect(doc.isMultiFlight).toBe(true)
    const result = Tournament.safeParse(doc)
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('assembles a valid tournament with a variable add-on (cost + chips set)', async () => {
    await createTournament(
      makeArgs({
        reentryConfig: { type: 'rebuy', maxReentries: null, maxRebuys: 1, hasAddOn: true, addOnCost: 50_00, addOnChips: 20_000 },
      })
    )
    const doc = capturedDoc()
    expect(doc.reentryConfig.addOnCost).toBe(50_00)
    expect(doc.reentryConfig.addOnChips).toBe(20_000)
    const result = Tournament.safeParse(doc)
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('rejects an add-on with no cost/chips (hasAddOn true but fields null)', async () => {
    await createTournament(
      makeArgs({
        reentryConfig: { type: 'freezeout', maxReentries: null, maxRebuys: null, hasAddOn: true, addOnCost: null, addOnChips: null },
      })
    )
    const result = Tournament.safeParse(capturedDoc())
    expect(result.success).toBe(false)
  })
})

// ── Session graph (atomic batch: tournament + sessions) ────────────────────────

describe('createTournament — session graph', () => {
  it('creates one play-to-a-winner session for a single-day tournament (default plan)', async () => {
    await createTournament(makeArgs())
    const sessions = capturedSessions()
    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    expect(s).toMatchObject({
      tournamentId: 'tour-generated',
      convergesIntoSessionId: null,
      dayNumber: 1,
      flightLabel: null,
      maximumStartIndex: 0,
      maximumEndIndex: null,
      status: 'scheduled',
    })
    // Written under the tournament's sessions subcollection, and schema-valid.
    const sessionSet = batchSets.find((c) => c.path.length === 4)
    expect(sessionSet.path.slice(0, 3)).toEqual(['tournaments', 'tour-generated', 'sessions'])
    expect(Session.safeParse(s).success, Session.safeParse(s).error?.toString()).toBe(true)
  })

  it('writes the tournament and every session in a single batch', async () => {
    await createTournament(
      makeArgs({
        sessionPlan: {
          days: [
            { flightCount: 2, endStructureIndex: 0, playToPercentRemaining: 15, scheduledStartTime: null },
            { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
          ],
        },
      })
    )
    // One batch, four writes (1 tournament + 3 sessions).
    expect(runValidatedBatch).toHaveBeenCalledTimes(1)
    expect(batchSets).toHaveLength(4)

    const sessions = capturedSessions()
    expect(sessions).toHaveLength(3)
    const final = sessions.find((s) => s.convergesIntoSessionId === null)
    expect(final).toBeDefined()
    // Exactly one final session.
    expect(sessions.filter((s) => s.convergesIntoSessionId === null)).toHaveLength(1)
    // Both Day 1 flights converge into that single final session.
    const flights = sessions.filter((s) => s.dayNumber === 1)
    expect(flights).toHaveLength(2)
    expect(flights.map((f) => f.flightLabel).sort()).toEqual(['A', 'B'])
    for (const f of flights) expect(f.convergesIntoSessionId).toBe(final.id)
    // Every session validates against the real schema.
    for (const s of sessions) {
      expect(Session.safeParse(s).success, Session.safeParse(s).error?.toString()).toBe(true)
    }
  })

  it('rejects an unsound session plan before writing', async () => {
    await expect(
      createTournament(
        makeArgs({
          // Day 1 ends at the last index, leaving no room for the final day.
          sessionPlan: {
            days: [
              { flightCount: 1, endStructureIndex: 2, playToPercentRemaining: null, scheduledStartTime: null },
              { flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null },
            ],
          },
        })
      )
    ).rejects.toThrow(TournamentError)
    expect(runValidatedBatch).not.toHaveBeenCalled()
  })
})

// ── Audit ──────────────────────────────────────────────────────────────────────

describe('createTournament — audit', () => {
  it('writes a tournament.created audit row after the write', async () => {
    await createTournament(makeArgs({ status: 'draft' }))
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'manager-1',
        actorRole: 'manager',
        actionType: 'tournament.created',
        targetType: 'tournament',
        targetId: 'tour-generated',
        metadata: { name: 'Friday $100 NLH', gameType: 'nlh', status: 'draft' },
      })
    )
  })
})

// ── Rejections ───────────────────────────────────────────────────────────────

describe('createTournament — rejections', () => {
  it('rejects a missing/blank actorId before writing', async () => {
    await expect(createTournament(makeArgs({ actorId: '' }))).rejects.toThrow(TournamentError)
    expect(runValidatedBatch).not.toHaveBeenCalled()
  })

  it('rejects a non-Date scheduledStartTime', async () => {
    await expect(
      createTournament(makeArgs({ scheduledStartTime: '2026-06-01' }))
    ).rejects.toThrow(TournamentError)
    expect(runValidatedBatch).not.toHaveBeenCalled()
  })

  it('rejects an invalid (NaN) Date scheduledStartTime', async () => {
    await expect(
      createTournament(makeArgs({ scheduledStartTime: new Date('not a date') }))
    ).rejects.toThrow(TournamentError)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// updateTournament — read-modify-write edit from the detail page
// ════════════════════════════════════════════════════════════════════════════

// ── Merge semantics ────────────────────────────────────────────────────────────

describe('updateTournament — merge semantics', () => {
  it('merges the patch, preserves untouched fields, and bumps updatedAt', async () => {
    const existing = makeTournament({ id: 'tour-1' })
    mockState.seed(['tournaments', 'tour-1'], existing)

    const updated = await updateTournament({
      id: 'tour-1',
      patch: { name: 'Saturday Deepstack', guarantee: 5_000_00 },
      actorId: 'td-1',
      actorRole: 'td',
    })

    const doc = updatedDoc()
    expect(doc.name).toBe('Saturday Deepstack')
    expect(doc.guarantee).toBe(5_000_00)
    expect(doc.buyIn).toBe(existing.buyIn) // untouched
    expect(doc.structure).toBe(existing.structure) // untouched
    expect(doc.createdAt).toBe(existing.createdAt) // untouched
    expect(doc.updatedAt).not.toBe(existing.updatedAt) // bumped
    expect(doc.updatedAt).toBeInstanceOf(Timestamp)
    expect(updated.name).toBe('Saturday Deepstack')
  })

  it('re-reads inside a transaction so the full shape is re-validated', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1' }))
    await updateTournament({
      id: 'tour-1',
      patch: { name: 'x' },
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(runValidatedTransaction).toHaveBeenCalledTimes(1)
    expect(mockState.calls.get.find((c) => c.path[1] === 'tour-1')).toBeDefined()
  })

  it('does not touch live-state or counters the patch omits', async () => {
    const existing = makeTournament({
      id: 'tour-1',
      status: 'lateRegOpen',
      entryCount: 42,
      currentStructureIndex: 3,
    })
    mockState.seed(['tournaments', 'tour-1'], existing)

    await updateTournament({
      id: 'tour-1',
      patch: { name: 'Renamed mid-flight' },
      actorId: 'td-1',
      actorRole: 'td',
    })

    const doc = updatedDoc()
    expect(doc.status).toBe('lateRegOpen')
    expect(doc.entryCount).toBe(42)
    expect(doc.currentStructureIndex).toBe(3)
  })
})

// ── Time conversion (Date in patch → Firestore Timestamp) ──────────────────────

describe('updateTournament — time conversion', () => {
  it('converts Date scheduledStartTime / lateRegCutoffTime in the patch to Timestamps', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1' }))
    const start = new Date('2026-07-01T18:00:00Z')
    const cutoff = new Date('2026-07-01T20:00:00Z')

    await updateTournament({
      id: 'tour-1',
      patch: { scheduledStartTime: start, lateRegCutoffTime: cutoff },
      actorId: 'td-1',
      actorRole: 'td',
    })

    const doc = updatedDoc()
    expect(doc.scheduledStartTime).toBeInstanceOf(Timestamp)
    expect(doc.scheduledStartTime.toMillis()).toBe(start.getTime())
    expect(doc.lateRegCutoffTime).toBeInstanceOf(Timestamp)
    expect(doc.lateRegCutoffTime.toMillis()).toBe(cutoff.getTime())
  })

  it('preserves a null lateRegCutoffTime passed in the patch', async () => {
    mockState.seed(
      ['tournaments', 'tour-1'],
      makeTournament({ id: 'tour-1', lateRegCutoffTime: Timestamp.fromDate(new Date('2026-06-01T11:00:00Z')) })
    )
    await updateTournament({
      id: 'tour-1',
      patch: { lateRegCutoffTime: null },
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(updatedDoc().lateRegCutoffTime).toBeNull()
  })

  it('leaves the existing schedule Timestamp untouched when the patch omits it', async () => {
    const existing = makeTournament({ id: 'tour-1' })
    mockState.seed(['tournaments', 'tour-1'], existing)
    await updateTournament({
      id: 'tour-1',
      patch: { name: 'No schedule change' },
      actorId: 'td-1',
      actorRole: 'td',
    })
    // Same Timestamp reference carried through — not re-wrapped.
    expect(updatedDoc().scheduledStartTime).toBe(existing.scheduledStartTime)
  })

  it('rejects a non-Date scheduledStartTime in the patch before writing', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1' }))
    await expect(
      updateTournament({
        id: 'tour-1',
        patch: { scheduledStartTime: '2026-07-01' },
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toThrow(TournamentError)
  })
})

// ── Schema conformance — the MERGED doc must pass the REAL Tournament schema ────

describe('updateTournament — schema conformance', () => {
  it('produces a merged document that passes the real Tournament schema', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1' }))
    await updateTournament({
      id: 'tour-1',
      patch: { name: 'Renamed', buyIn: 250_00, scheduledStartTime: new Date('2026-07-01T18:00:00Z') },
      actorId: 'td-1',
      actorRole: 'td',
    })
    const result = Tournament.safeParse(updatedDoc())
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('a patch that violates an invariant yields a doc the schema rejects (caught by the real tx.set in prod)', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1' }))
    await updateTournament({
      id: 'tour-1',
      // hasAddOn true but no cost/chips — superRefine should reject this.
      patch: { reentryConfig: { type: 'freezeout', maxReentries: null, maxRebuys: null, hasAddOn: true, addOnCost: null, addOnChips: null } },
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(Tournament.safeParse(updatedDoc()).success).toBe(false)
  })
})

// ── Audit ──────────────────────────────────────────────────────────────────────

describe('updateTournament — audit', () => {
  it('writes a tournament.updated row recording the changed fields', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1' }))
    await updateTournament({
      id: 'tour-1',
      patch: { name: 'x', guarantee: 1_000_00 },
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'td-1',
        actorRole: 'td',
        actionType: 'tournament.updated',
        targetType: 'tournament',
        targetId: 'tour-1',
        metadata: { changedFields: ['name', 'guarantee'] },
      })
    )
  })

  it('passes through a caller-supplied actionType (e.g. the structure tab)', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1' }))
    await updateTournament({
      id: 'tour-1',
      patch: { structure: LEVELS },
      actorId: 'td-1',
      actorRole: 'td',
      actionType: 'tournament.structureEdited',
    })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'tournament.structureEdited', targetId: 'tour-1' })
    )
  })
})

// ── Rejections ───────────────────────────────────────────────────────────────

describe('updateTournament — rejections', () => {
  it('rejects a missing/blank actorId before running the transaction', async () => {
    await expect(
      updateTournament({ id: 'tour-1', patch: { name: 'x' }, actorId: '', actorRole: 'td' })
    ).rejects.toThrow(TournamentError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })

  it('rejects a missing/blank id before running the transaction', async () => {
    await expect(
      updateTournament({ id: '   ', patch: { name: 'x' }, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(TournamentError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })

  it('propagates NotFoundError and skips the audit when the tournament does not exist', async () => {
    // store empty → mock tx.get throws NotFoundError
    await expect(
      updateTournament({ id: 'missing', patch: { name: 'x' }, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow()
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })
})

// ── setTournamentStatus (floor controls — task 2.7) ────────────────────────────

describe('setTournamentStatus — default transitions', () => {
  const seed = (status) => mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1', status }))

  it('advances along the standard sequence (TD), re-validating the merged doc', async () => {
    seed('scheduled')
    const updated = await setTournamentStatus({ id: 'tour-1', toStatus: 'lateRegOpen', actorId: 'td-1', actorRole: 'td' })
    expect(updated.status).toBe('lateRegOpen')
    expect(Tournament.safeParse(updated).success, Tournament.safeParse(updated).error?.toString()).toBe(true)
    // Just the statusChanged audit — no override row.
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledTimes(1)
    expect(auditLog.writeAuditLogSafe.mock.calls[0][0]).toMatchObject({
      actionType: 'tournament.statusChanged',
      targetId: 'tour-1',
      metadata: { from: 'scheduled', to: 'lateRegOpen', override: false },
    })
  })

  it('stamps finishedAt on entering finished', async () => {
    seed('lateRegClosed')
    const updated = await setTournamentStatus({ id: 'tour-1', toStatus: 'finished', actorId: 'td-1', actorRole: 'td' })
    expect(updated.status).toBe('finished')
    expect(updated.finishedAt).toBeInstanceOf(Timestamp)
  })

  it('allows cancel from a non-terminal status without an override', async () => {
    seed('scheduled')
    const updated = await setTournamentStatus({ id: 'tour-1', toStatus: 'cancelled', actorId: 'td-1', actorRole: 'td' })
    expect(updated.status).toBe('cancelled')
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledTimes(1)
  })
})

describe('setTournamentStatus — manager override', () => {
  const seed = (status, extra = {}) => mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1', status, ...extra }))

  it('refuses a non-standard transition without an override', async () => {
    seed('lateRegClosed')
    await expect(
      setTournamentStatus({ id: 'tour-1', toStatus: 'lateRegOpen', actorId: 'td-1', actorRole: 'td' }),
    ).rejects.toThrow(TournamentError)
    expect(mockState.calls.set).toHaveLength(0)
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })

  it('refuses a non-standard transition by a non-manager even with a reason', async () => {
    seed('lateRegClosed')
    await expect(
      setTournamentStatus({
        id: 'tour-1',
        toStatus: 'lateRegOpen',
        actorId: 'td-1',
        actorRole: 'td',
        managerOverride: { reason: 'reopen' },
      }),
    ).rejects.toThrow(TournamentError)
  })

  it('reopens late reg with a manager override + reason, emitting a manager.override row', async () => {
    seed('lateRegClosed')
    const updated = await setTournamentStatus({
      id: 'tour-1',
      toStatus: 'lateRegOpen',
      actorId: 'mgr-1',
      actorRole: 'manager',
      managerOverride: { reason: 'late bus of players arrived' },
    })
    expect(updated.status).toBe('lateRegOpen')
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledTimes(2)
    const types = auditLog.writeAuditLogSafe.mock.calls.map((c) => c[0].actionType)
    expect(types).toContain('tournament.statusChanged')
    expect(types).toContain('manager.override')
    const override = auditLog.writeAuditLogSafe.mock.calls.find((c) => c[0].actionType === 'manager.override')[0]
    expect(override.metadata).toMatchObject({
      overrideType: 'tournamentStatusTransition',
      reason: 'late bus of players arrived',
      from: 'lateRegClosed',
      to: 'lateRegOpen',
    })
  })

  it('requires a non-empty reason for an override transition', async () => {
    seed('finished')
    await expect(
      setTournamentStatus({
        id: 'tour-1',
        toStatus: 'lateRegOpen',
        actorId: 'mgr-1',
        actorRole: 'manager',
        managerOverride: { reason: '   ' },
      }),
    ).rejects.toThrow(TournamentError)
  })

  it('clears finishedAt when an override reverts out of finished', async () => {
    seed('finished', { finishedAt: Timestamp.fromDate(new Date('2026-06-01T10:00:00Z')) })
    const updated = await setTournamentStatus({
      id: 'tour-1',
      toStatus: 'lateRegOpen',
      actorId: 'mgr-1',
      actorRole: 'manager',
      managerOverride: { reason: 'resumed after a stoppage' },
    })
    expect(updated.status).toBe('lateRegOpen')
    expect(updated.finishedAt).toBeNull()
  })
})

describe('setTournamentStatus — rejections', () => {
  it('rejects a no-op transition to the same status', async () => {
    mockState.seed(['tournaments', 'tour-1'], makeTournament({ id: 'tour-1', status: 'scheduled' }))
    await expect(
      setTournamentStatus({ id: 'tour-1', toStatus: 'scheduled', actorId: 'td-1', actorRole: 'td' }),
    ).rejects.toThrow(TournamentError)
    expect(mockState.calls.set).toHaveLength(0)
  })

  it('rejects an unknown status before running the transaction', async () => {
    await expect(
      setTournamentStatus({ id: 'tour-1', toStatus: 'paused', actorId: 'td-1', actorRole: 'td' }),
    ).rejects.toThrow(TournamentError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })

  it('rejects a blank actorId before running the transaction', async () => {
    await expect(
      setTournamentStatus({ id: 'tour-1', toStatus: 'lateRegOpen', actorId: '', actorRole: 'td' }),
    ).rejects.toThrow(TournamentError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })
})
