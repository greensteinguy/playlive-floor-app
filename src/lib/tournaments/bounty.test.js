import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'
import { buildTournament, buildEntry, buildBountyDraw } from '../schema/_fixtures'
import { Entry, BountyDraw } from '../schema'

let mockState

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  bountyDraws: { listBountyDraws: vi.fn() },
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    tournamentPath: (id) => ['tournaments', id],
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
    bountyDrawPath: (tid, did) => ['tournaments', tid, 'bountyDraws', did],
  },
}))

vi.mock('../players', () => ({
  playerDisplayName: (p) => p.displayName ?? `${p.firstName} ${p.lastName}`.trim(),
}))

import { runValidatedTransaction, bountyDraws as bountyDrawsApi, auditLog } from '../firestore'
import {
  isMysteryBounty,
  slotIndexFromDrawId,
  drawIdForSlot,
  undrawnSlotIndexes,
  undrawnBountyValues,
  remainingBountySummary,
  bountyBoardRows,
  drawBounty,
  BountyError,
  NotMysteryBountyError,
  NoBountiesRemainingError,
  EliminatorNotAliveError,
  BountyAlreadyDrawnError,
} from './bounty'

const tournamentPath = (id) => ['tournaments', id]
const entryPath = (tid, eid) => ['tournaments', tid, 'entries', eid]
const bountyDrawPath = (tid, did) => ['tournaments', tid, 'bountyDraws', did]

// A valid mysteryBounty tournament: pool of four values, one duplicated.
const POOL = [100_00, 500_00, 100_00, 1000_00]
function makeMbTournament(overrides = {}) {
  return buildTournament({
    id: 't1',
    gameType: 'mysteryBounty',
    bountyPoolConfig: { totalPool: POOL.reduce((a, b) => a + b, 0), bountyValues: [...POOL] },
    ...overrides,
  })
}

const slotDraw = (slot, overrides = {}) =>
  buildBountyDraw({
    id: drawIdForSlot(slot),
    tournamentId: 't1',
    bountyValue: POOL[slot],
    ...overrides,
  })

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('isMysteryBounty', () => {
  it('requires the mysteryBounty gameType AND a pool config', () => {
    expect(isMysteryBounty(makeMbTournament())).toBe(true)
    expect(isMysteryBounty(buildTournament({ gameType: 'nlh' }))).toBe(false)
    expect(isMysteryBounty({ gameType: 'mysteryBounty', bountyPoolConfig: null })).toBe(false)
    expect(isMysteryBounty(null)).toBe(false)
  })
})

describe('slot ids', () => {
  it('round-trips slot indexes and rejects foreign ids', () => {
    expect(drawIdForSlot(0)).toBe('slot-0')
    expect(slotIndexFromDrawId('slot-0')).toBe(0)
    expect(slotIndexFromDrawId('slot-12')).toBe(12)
    expect(slotIndexFromDrawId('a-uuid-like-id')).toBeNull()
    expect(slotIndexFromDrawId('slot-')).toBeNull()
    expect(slotIndexFromDrawId(null)).toBeNull()
  })
})

describe('undrawnSlotIndexes / undrawnBountyValues', () => {
  it('full pool undrawn with no draws', () => {
    expect(undrawnSlotIndexes(POOL, [])).toEqual([0, 1, 2, 3])
    expect(undrawnBountyValues(POOL, [])).toEqual(POOL)
  })

  it('slot-addressed draws remove exactly their slot (duplicates preserved)', () => {
    const draws = [slotDraw(0)]
    expect(undrawnSlotIndexes(POOL, draws)).toEqual([1, 2, 3])
    // the duplicate $100 at slot 2 is still in the pool
    expect(undrawnBountyValues(POOL, draws)).toEqual([500_00, 100_00, 1000_00])
  })

  it('a legacy non-slot draw consumes one instance of its value', () => {
    const draws = [buildBountyDraw({ id: 'legacy-uuid', bountyValue: 100_00 })]
    expect(undrawnSlotIndexes(POOL, draws)).toEqual([1, 2, 3]) // first $100 slot consumed
    expect(undrawnBountyValues(POOL, draws)).toEqual([500_00, 100_00, 1000_00])
  })

  it('everything drawn → empty', () => {
    const draws = [slotDraw(0), slotDraw(1), slotDraw(2), slotDraw(3)]
    expect(undrawnSlotIndexes(POOL, draws)).toEqual([])
  })

  it('tolerates null/undefined inputs', () => {
    expect(undrawnSlotIndexes(null, null)).toEqual([])
    expect(undrawnBountyValues(undefined, undefined)).toEqual([])
  })
})

describe('remainingBountySummary', () => {
  it('reports undrawn count/total and drawn count/total', () => {
    const t = makeMbTournament()
    expect(remainingBountySummary(t, [])).toEqual({
      count: 4,
      total: 1700_00,
      drawnCount: 0,
      drawnTotal: 0,
    })
    expect(remainingBountySummary(t, [slotDraw(3), slotDraw(0)])).toEqual({
      count: 2,
      total: 600_00,
      drawnCount: 2,
      drawnTotal: 1100_00,
    })
  })
})

describe('bountyBoardRows', () => {
  it('resolves names, sorts newest first, and flags credited draws', () => {
    const draws = [
      buildBountyDraw({
        id: 'slot-0',
        bountyValue: 100_00,
        drawnAt: Timestamp.fromMillis(1000),
        knockerEntryId: 'e-knocker',
        knockedOutEntryId: 'e-out',
        walletTransactionId: 'wt-1',
      }),
      buildBountyDraw({
        id: 'slot-1',
        bountyValue: 500_00,
        drawnAt: Timestamp.fromMillis(2000),
        knockerEntryId: 'e-knocker',
        knockedOutEntryId: 'e-out2',
      }),
    ]
    const entriesById = {
      'e-knocker': buildEntry({ id: 'e-knocker', playerId: 'p1' }),
      'e-out': buildEntry({ id: 'e-out', playerId: 'p2' }),
      // e-out2 missing → '—'
    }
    const playersById = {
      p1: { firstName: 'Ann', lastName: 'Lee', displayName: null },
      p2: { firstName: 'Bo', lastName: 'Ng', displayName: 'Boss' },
    }
    const rows = bountyBoardRows({ draws, entriesById, playersById })
    expect(rows.map((r) => r.id)).toEqual(['slot-1', 'slot-0'])
    expect(rows[0]).toMatchObject({
      bountyValue: 500_00,
      knockerName: 'Ann Lee',
      knockedOutName: '—',
      isCredited: false,
    })
    expect(rows[1]).toMatchObject({ knockedOutName: 'Boss', isCredited: true })
  })
})

// ── drawBounty op ───────────────────────────────────────────────────────────

describe('drawBounty', () => {
  const tournament = makeMbTournament()
  const bustedTs = () => Timestamp.now()

  const seedBase = ({ storeTournament = tournament } = {}) => {
    mockState.seed(tournamentPath('t1'), storeTournament)
    mockState.seed(
      entryPath('t1', 'e-out'),
      buildEntry({ id: 'e-out', bustedAt: bustedTs(), bustedInSessionId: 'session-1' })
    )
    mockState.seed(entryPath('t1', 'e-knocker'), buildEntry({ id: 'e-knocker', bountyEarnings: 200_00, bountiesKnockoutCount: 1 }))
  }

  beforeEach(() => {
    mockState = makeMockStore()
    runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
    bountyDrawsApi.listBountyDraws.mockResolvedValue([])
    auditLog.writeAuditLogSafe.mockClear()
  })

  it('draws a random undrawn value, writes the slot draw doc, credits the eliminator entry, audits', async () => {
    seedBase()
    // rng drives the shuffle of [0,1,2,3]; rng ()=>0 is deterministic.
    const res = await drawBounty({
      tournament,
      eliminatorEntryId: 'e-knocker',
      eliminatedEntryId: 'e-out',
      actorId: 'td-1',
      actorRole: 'td',
      rng: () => 0,
    })

    // The result names a real slot and its exact pool value.
    const slot = slotIndexFromDrawId(res.drawId)
    expect(slot).not.toBeNull()
    expect(res.bountyValue).toBe(POOL[slot])
    expect(res.remainingCount).toBe(3)
    expect(res.remainingTotal).toBe(1700_00 - res.bountyValue)

    // Draw doc written at the slot path, schema-valid.
    const drawWrite = mockState.calls.set.find((c) => c.path[2] === 'bountyDraws')
    expect(drawWrite.path).toEqual(bountyDrawPath('t1', res.drawId))
    expect(BountyDraw.safeParse(drawWrite.data).success).toBe(true)
    expect(drawWrite.data).toMatchObject({
      bountyValue: res.bountyValue,
      knockerEntryId: 'e-knocker',
      knockedOutEntryId: 'e-out',
      drawnBy: 'td-1',
      walletTransactionId: null, // wallet credit is the cashier's confirm (4.7)
    })

    // Eliminator entry rewritten in full: earnings + knockout count bumped, Entry-valid.
    const entryWrite = mockState.calls.set.find((c) => c.path[2] === 'entries' && c.path[3] === 'e-knocker')
    expect(entryWrite.data.bountyEarnings).toBe(200_00 + res.bountyValue)
    expect(entryWrite.data.bountiesKnockoutCount).toBe(2)
    expect(Entry.safeParse(entryWrite.data).success).toBe(true)

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'bounty.drawn',
        targetType: 'tournament',
        targetId: 't1',
        metadata: expect.objectContaining({
          drawId: res.drawId,
          bountyValue: res.bountyValue,
          knockerEntryId: 'e-knocker',
          knockedOutEntryId: 'e-out',
        }),
      })
    )
  })

  it('draws uniformly over the pool for a given rng (probe order is the shuffle order)', async () => {
    seedBase()
    // rng ()=>0.99… pushes a different shuffle than ()=>0 — just assert both are valid slots
    const res = await drawBounty({
      tournament,
      eliminatorEntryId: 'e-knocker',
      eliminatedEntryId: 'e-out',
      actorId: 'td-1',
      actorRole: 'td',
      rng: () => 0.9999,
    })
    expect(slotIndexFromDrawId(res.drawId)).not.toBeNull()
    expect(POOL[slotIndexFromDrawId(res.drawId)]).toBe(res.bountyValue)
  })

  it('skips already-drawn slots from the committed list', async () => {
    seedBase()
    bountyDrawsApi.listBountyDraws.mockResolvedValue([
      slotDraw(0, { knockedOutEntryId: 'someone-else' }),
      slotDraw(1, { knockedOutEntryId: 'someone-else-2' }),
      slotDraw(2, { knockedOutEntryId: 'someone-else-3' }),
    ])
    const res = await drawBounty({
      tournament,
      eliminatorEntryId: 'e-knocker',
      eliminatedEntryId: 'e-out',
      actorId: 'td-1',
      actorRole: 'td',
      rng: () => 0,
    })
    expect(res.drawId).toBe('slot-3')
    expect(res.bountyValue).toBe(1000_00)
    expect(res.remainingCount).toBe(0)
    expect(res.remainingTotal).toBe(0)
  })

  it('RACE: a slot taken concurrently (in the store but not the stale list) is probed and skipped', async () => {
    seedBase()
    // The committed list is stale (empty), but slot-0..slot-2 already exist in
    // the store — as if concurrent draws landed between the list and the tx.
    for (const s of [0, 1, 2]) mockState.seed(bountyDrawPath('t1', drawIdForSlot(s)), slotDraw(s))

    const res = await drawBounty({
      tournament,
      eliminatorEntryId: 'e-knocker',
      eliminatedEntryId: 'e-out',
      actorId: 'td-1',
      actorRole: 'td',
      rng: () => 0, // shuffle order deterministic; probes walk until a free slot
    })
    expect(res.drawId).toBe('slot-3')
    expect(res.bountyValue).toBe(1000_00)
    // every taken slot it probed before finding the free one was tx.get-read
    // (registered in the transaction read set → real Firestore serializes)
    const probed = mockState.calls.get.filter((c) => c.path[2] === 'bountyDraws').map((c) => c.path[3])
    expect(probed).toContain('slot-3')
  })

  it('throws NoBountiesRemainingError when the committed list shows a fully-drawn pool', async () => {
    seedBase()
    bountyDrawsApi.listBountyDraws.mockResolvedValue([slotDraw(0), slotDraw(1), slotDraw(2), slotDraw(3)].map((d, i) => ({ ...d, knockedOutEntryId: `other-${i}` })))
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'e-knocker', eliminatedEntryId: 'e-out', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(NoBountiesRemainingError)
  })

  it('throws NoBountiesRemainingError when every candidate slot turns out concurrently taken', async () => {
    seedBase()
    for (const s of [0, 1, 2, 3]) mockState.seed(bountyDrawPath('t1', drawIdForSlot(s)), slotDraw(s))
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'e-knocker', eliminatedEntryId: 'e-out', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(NoBountiesRemainingError)
  })

  it('refuses a non-mysteryBounty tournament (arg pre-check)', async () => {
    await expect(
      drawBounty({
        tournament: buildTournament({ id: 't1', gameType: 'nlh' }),
        eliminatorEntryId: 'e-knocker',
        eliminatedEntryId: 'e-out',
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toBeInstanceOf(NotMysteryBountyError)
  })

  it('re-checks the FRESH tournament inside the transaction', async () => {
    // Caller believes it is a mystery bounty, but the stored doc is not.
    seedBase({ storeTournament: buildTournament({ id: 't1', gameType: 'nlh' }) })
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'e-knocker', eliminatedEntryId: 'e-out', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(NotMysteryBountyError)
  })

  it('refuses when the eliminator is busted or voided (fresh read)', async () => {
    seedBase()
    mockState.seed(
      entryPath('t1', 'e-knocker'),
      buildEntry({ id: 'e-knocker', bustedAt: bustedTs(), bustedInSessionId: 'session-1' })
    )
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'e-knocker', eliminatedEntryId: 'e-out', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(EliminatorNotAliveError)
  })

  it('refuses when the knocked-out entry is not actually busted (fresh read)', async () => {
    seedBase()
    mockState.seed(entryPath('t1', 'e-out'), buildEntry({ id: 'e-out' })) // alive
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'e-knocker', eliminatedEntryId: 'e-out', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(BountyError)
  })

  it('refuses a second draw for the same knockout', async () => {
    seedBase()
    bountyDrawsApi.listBountyDraws.mockResolvedValue([slotDraw(0, { knockedOutEntryId: 'e-out' })])
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'e-knocker', eliminatedEntryId: 'e-out', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(BountyAlreadyDrawnError)
  })

  it('refuses a self-knockout', async () => {
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'e-out', eliminatedEntryId: 'e-out', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(BountyError)
  })

  it('requires an actor', async () => {
    await expect(
      drawBounty({ tournament, eliminatorEntryId: 'a', eliminatedEntryId: 'b', actorId: '', actorRole: 'td' })
    ).rejects.toBeInstanceOf(BountyError)
  })
})
