import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'

// Only the data layer is mocked — the real Tournament schema is imported below
// so we can assert the op assembles a document that actually validates. The
// mocked validatedSet / mock tx.set do NOT validate, so the schema-conformance
// tests below run Tournament.safeParse on the captured document explicitly.
vi.mock('../firestore', () => ({
  validatedSet: vi.fn(),
  runValidatedTransaction: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  generateId: vi.fn(),
  paths: {
    tournamentPath: (id) => ['tournaments', id],
  },
}))

import { validatedSet, runValidatedTransaction, auditLog, generateId } from '../firestore'
import { Tournament } from '../schema'
import { createTournament, updateTournament } from './tournaments'
import { TournamentError } from './errors'

let mockState

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

// The document the op handed to validatedSet (3rd positional arg).
function capturedDoc() {
  return validatedSet.mock.calls[0][2]
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
  // Real validatedSet returns the validated doc; the data already carries the
  // id, so echo it back.
  validatedSet.mockImplementation(async (_pathParts, _schema, data) => data)
  generateId.mockReturnValue('tour-generated')
})

// ── Document assembly ─────────────────────────────────────────────────────────

describe('createTournament — document assembly', () => {
  it('persists at the generated id and echoes the assembled document back', async () => {
    const created = await createTournament(makeArgs())

    expect(validatedSet).toHaveBeenCalledTimes(1)
    const [pathParts, , doc] = validatedSet.mock.calls[0]
    expect(pathParts).toEqual(['tournaments', 'tour-generated'])
    expect(doc).toMatchObject({
      id: 'tour-generated',
      name: 'Friday $100 NLH',
      gameType: 'nlh',
      buyIn: 100_00,
      startingStack: 20_000,
      structure: LEVELS,
      createdBy: 'manager-1',
    })
    expect(created).toEqual(doc)
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

    vi.clearAllMocks()
    validatedSet.mockImplementation(async (_p, _s, data) => data)
    generateId.mockReturnValue('tour-generated')
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

  it('assembles a valid multi-flight tournament', async () => {
    await createTournament(makeArgs({ isMultiDay: true, isMultiFlight: true }))
    const result = Tournament.safeParse(capturedDoc())
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
    expect(validatedSet).not.toHaveBeenCalled()
  })

  it('rejects a non-Date scheduledStartTime', async () => {
    await expect(
      createTournament(makeArgs({ scheduledStartTime: '2026-06-01' }))
    ).rejects.toThrow(TournamentError)
    expect(validatedSet).not.toHaveBeenCalled()
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
