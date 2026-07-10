import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'

let mockState

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  runValidatedBatch: vi.fn(),
  validatedSet: vi.fn(),
  entries: { listEntries: vi.fn() },
  tables: { listTables: vi.fn() },
  generateId: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
    tournamentPath: (id) => ['tournaments', id],
  },
}))

// ./registration is imported for its PURE computeEntryCounters (the prize-pool
// SSOT) — keep it real. Its own '../wallet' import (the payment ops) is cut
// here so the test doesn't drag the whole wallet module chain in.
vi.mock('../wallet', () => ({
  payViaExternalMethod: vi.fn(),
  payViaWallet: vi.fn(),
  payViaTicket: vi.fn(),
}))

import { runValidatedTransaction, entries as entriesApi, auditLog } from '../firestore'
import {
  aliveEntries,
  recordedWinner,
  isWinningsPaid,
  isWinningsStaged,
  buildPayoutRows,
  payoutRowsTotal,
  recordWinner,
  revertWinner,
  enterDeal,
  PayoutsError,
  MultiplePlayersRemainError,
  WinnerAlreadyRecordedError,
  NoWinnerRecordedError,
  WinnerRevertBlockedError,
  DealRowAlreadyPaidError,
  DealTotalMismatchError,
} from './payouts'

const entryPath = (tid, eid) => ['tournaments', tid, 'entries', eid]

let entrySeq = 0
function makeEntry(overrides = {}) {
  entrySeq += 1
  return {
    id: `entry-${entrySeq}`,
    playerId: `player-${entrySeq}`,
    tournamentId: 't1',
    originSessionId: 'session-1',
    registeredAt: Timestamp.fromMillis(1_000_000 + entrySeq * 1000),
    voidedAt: null,
    bustedAt: null,
    bustedInSessionId: null,
    finishingPlace: null,
    cashWinnings: 0,
    ticketWinnings: 0,
    bountyEarnings: 0,
    winningsPaidAt: null,
    winningsWalletTransactionId: null,
    currentTableId: null,
    currentSeatNumber: null,
    ...overrides,
  }
}
const busted = (overrides = {}) =>
  makeEntry({ bustedAt: Timestamp.now(), bustedInSessionId: 'session-1', ...overrides })

// $100 buy-in; 50/30/20 at nearest $5 over three paid places.
function makeTournament(overrides = {}) {
  return {
    id: 't1',
    buyIn: 10_000,
    totalPrizePool: 100_000,
    payoutStructure: {
      type: 'byPercent',
      rounding: 'nearest5',
      positions: [
        { place: 1, payout: 0, percent: 0.5 },
        { place: 2, payout: 0, percent: 0.3 },
        { place: 3, payout: 0, percent: 0.2 },
      ],
    },
    ...overrides,
  }
}

function seedEntries(entries) {
  for (const e of entries) mockState.seed(entryPath('t1', e.id), e)
  entriesApi.listEntries.mockResolvedValue(entries)
}

beforeEach(() => {
  mockState = makeMockStore()
  entrySeq = 0
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  entriesApi.listEntries.mockReset()
  auditLog.writeAuditLogSafe.mockClear()
})

// ── Pure planners ───────────────────────────────────────────────────────────

describe('aliveEntries / recordedWinner / staged / paid', () => {
  it('aliveEntries excludes busted and voided', () => {
    const a = makeEntry()
    const b = busted()
    const v = makeEntry({ voidedAt: Timestamp.now(), voidedBy: 'x', voidReason: 'dup' })
    expect(aliveEntries([a, b, v]).map((e) => e.id)).toEqual([a.id])
  })

  it('recordedWinner finds the non-voided finishingPlace-1 entry', () => {
    const w = makeEntry({ finishingPlace: 1 })
    expect(recordedWinner([makeEntry(), w])?.id).toBe(w.id)
    expect(recordedWinner([makeEntry()])).toBeNull()
  })

  it('staged/paid markers: cashWinnings > 0 or winningsPaidAt ⇒ staged; winningsPaidAt ⇒ paid', () => {
    expect(isWinningsStaged(makeEntry())).toBe(false)
    expect(isWinningsStaged(makeEntry({ cashWinnings: 100 }))).toBe(true)
    const paid = makeEntry({ cashWinnings: 100, winningsPaidAt: Timestamp.now() })
    expect(isWinningsStaged(paid)).toBe(true)
    expect(isWinningsPaid(paid)).toBe(true)
    expect(isWinningsPaid(makeEntry({ cashWinnings: 100 }))).toBe(false)
  })
})

describe('buildPayoutRows', () => {
  it('joins the materialized table to the finishing order; unfilled places have no entry', () => {
    const t = makeTournament()
    const third = busted({ finishingPlace: 3 })
    const second = busted({ finishingPlace: 2 })
    const alive = makeEntry()
    const rows = buildPayoutRows({ tournament: t, entries: [third, second, alive] })

    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, null])
    expect(rows[0].entry).toBeNull() // 1st not decided yet
    expect(rows[0].calculatedAmount).toBe(50_000)
    expect(rows[1].entryId).toBe(second.id)
    expect(rows[1].payableAmount).toBe(30_000) // calculated (nothing staged)
    expect(rows[2].entryId).toBe(third.id)
    expect(rows[3].entryId).toBe(alive.id) // still-in deal candidate appended
    expect(rows[3].alive).toBe(true)
    expect(rows[3].calculatedAmount).toBe(0)
  })

  it('the recorded winner (alive, place 1) fills the 1st-place row', () => {
    const t = makeTournament()
    const winner = makeEntry({ finishingPlace: 1 })
    const rows = buildPayoutRows({ tournament: t, entries: [winner] })
    expect(rows[0].entryId).toBe(winner.id)
    expect(rows[0].alive).toBe(true)
  })

  it('staged cashWinnings overrides the calculated amount and flags adjustment', () => {
    const t = makeTournament()
    const second = busted({ finishingPlace: 2, cashWinnings: 35_000 })
    const rows = buildPayoutRows({ tournament: t, entries: [second] })
    const row = rows.find((r) => r.place === 2)
    expect(row.payableAmount).toBe(35_000)
    expect(row.isStaged).toBe(true)
    expect(row.isAdjusted).toBe(true)
    expect(row.isPaid).toBe(false)
  })

  it('a staged amount equal to the calculation is staged but not adjusted', () => {
    const t = makeTournament()
    const second = busted({ finishingPlace: 2, cashWinnings: 30_000 })
    const row = buildPayoutRows({ tournament: t, entries: [second] }).find((r) => r.place === 2)
    expect(row.isStaged).toBe(true)
    expect(row.isAdjusted).toBe(false)
  })

  it('paid rows carry isPaid', () => {
    const t = makeTournament()
    const second = busted({
      finishingPlace: 2,
      cashWinnings: 30_000,
      winningsPaidAt: Timestamp.now(),
      winningsWalletTransactionId: 'wtx-1',
    })
    const row = buildPayoutRows({ tournament: t, entries: [second] }).find((r) => r.place === 2)
    expect(row.isPaid).toBe(true)
  })

  it('busted entries outside the paid table appear only when they carry winnings; voided never do', () => {
    const t = makeTournament()
    const fourth = busted({ finishingPlace: 4 }) // out of the money, nothing staged
    const fifth = busted({ finishingPlace: 5, cashWinnings: 5_000 }) // deal reached past the table
    const voided = makeEntry({
      voidedAt: Timestamp.now(),
      voidedBy: 'x',
      voidReason: 'dup',
      cashWinnings: 9_999,
    })
    const rows = buildPayoutRows({ tournament: t, entries: [fourth, fifth, voided] })
    const extraIds = rows.filter((r) => r.entryId).map((r) => r.entryId)
    expect(extraIds).toEqual([fifth.id])
    expect(rows.find((r) => r.entryId === fifth.id).payableAmount).toBe(5_000)
  })

  it('payoutRowsTotal sums payable amounts', () => {
    const t = makeTournament()
    const rows = buildPayoutRows({
      tournament: t,
      entries: [busted({ finishingPlace: 2 }), busted({ finishingPlace: 3 })],
    })
    expect(payoutRowsTotal(rows)).toBe(100_000)
  })
})

// ── recordWinner ────────────────────────────────────────────────────────────

describe('recordWinner', () => {
  const t = makeTournament()

  it('assigns finishingPlace 1 to the sole alive entry and audits it', async () => {
    const winner = makeEntry()
    const loser = busted({ finishingPlace: 2 })
    seedEntries([winner, loser])

    const res = await recordWinner({ tournament: t, actorId: 'td-1', actorRole: 'td' })
    expect(res).toMatchObject({ ok: true, entryId: winner.id, playerId: winner.playerId })

    const write = mockState.calls.set.find((c) => c.path[3] === winner.id)
    expect(write.data.finishingPlace).toBe(1)
    expect(write.data.bustedAt).toBeNull() // the winner never busts

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'entry.winnerRecorded', targetId: winner.id })
    )
  })

  it('refuses when more than one entry is alive', async () => {
    seedEntries([makeEntry(), makeEntry()])
    await expect(recordWinner({ tournament: t, actorId: 'td-1', actorRole: 'td' })).rejects.toThrow(
      MultiplePlayersRemainError
    )
    expect(mockState.calls.set).toHaveLength(0)
  })

  it('refuses when a winner is already recorded', async () => {
    seedEntries([makeEntry({ finishingPlace: 1 }), busted({ finishingPlace: 2 })])
    await expect(recordWinner({ tournament: t, actorId: 'td-1', actorRole: 'td' })).rejects.toThrow(
      WinnerAlreadyRecordedError
    )
  })

  it('refuses when nobody is left (all busted/voided)', async () => {
    seedEntries([busted({ finishingPlace: 2 })])
    await expect(recordWinner({ tournament: t, actorId: 'td-1', actorRole: 'td' })).rejects.toThrow(
      PayoutsError
    )
  })

  it('requires an actor', async () => {
    await expect(recordWinner({ tournament: t, actorId: '', actorRole: 'td' })).rejects.toThrow(
      /actorId is required/
    )
  })
})

// ── revertWinner ────────────────────────────────────────────────────────────

describe('revertWinner', () => {
  const t = makeTournament()

  it('clears finishingPlace on an unpaid winner and audits it', async () => {
    const winner = makeEntry({ finishingPlace: 1 })
    seedEntries([winner, busted({ finishingPlace: 2 })])

    const res = await revertWinner({ tournament: t, actorId: 'td-1', actorRole: 'td' })
    expect(res).toMatchObject({ ok: true, entryId: winner.id })

    const write = mockState.calls.set.find((c) => c.path[3] === winner.id)
    expect(write.data.finishingPlace).toBeNull()

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'entry.winnerReverted', targetId: winner.id })
    )
  })

  it('refuses when no winner is recorded', async () => {
    seedEntries([makeEntry()])
    await expect(revertWinner({ tournament: t, actorId: 'td-1', actorRole: 'td' })).rejects.toThrow(
      NoWinnerRecordedError
    )
  })

  it.each([
    ['cash winnings staged', { cashWinnings: 50_000 }],
    ['ticket winnings recorded', { ticketWinnings: 20_000 }],
    ['payout already confirmed', { winningsPaidAt: Timestamp.now() }],
  ])('is blocked when %s', async (_label, overrides) => {
    seedEntries([makeEntry({ finishingPlace: 1, ...overrides })])
    await expect(revertWinner({ tournament: t, actorId: 'td-1', actorRole: 'td' })).rejects.toThrow(
      WinnerRevertBlockedError
    )
    expect(mockState.calls.set).toHaveLength(0)
  })
})

// ── enterDeal ───────────────────────────────────────────────────────────────

describe('enterDeal', () => {
  // 3 entries × $100 buy-in → $300 pool.
  const t = makeTournament({ totalPrizePool: 30_000 })

  function threeHanded() {
    const a = makeEntry()
    const b = makeEntry()
    const c = busted({ finishingPlace: 3, cashWinnings: 6_000 }) // already staged $60
    seedEntries([a, b, c])
    return { a, b, c }
  }

  it('stages cashWinnings on each affected entry (alive entries included) and audits the table', async () => {
    const { a, b, c } = threeHanded()
    // Deal between the two still-alive players; 3rd keeps their staged $60.
    const res = await enterDeal({
      tournament: t,
      allocations: [
        { entryId: a.id, amount: 13_000 },
        { entryId: b.id, amount: 11_000 },
      ],
      notes: 'even chop-ish, heads-up',
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(res).toMatchObject({ ok: true, grandTotal: 30_000, prizePool: 30_000, delta: 0, overrideUsed: false })

    expect(mockState.get(entryPath('t1', a.id)).cashWinnings).toBe(13_000)
    expect(mockState.get(entryPath('t1', b.id)).cashWinnings).toBe(11_000)
    expect(mockState.get(entryPath('t1', c.id)).cashWinnings).toBe(6_000) // untouched

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'tournament.dealEntered',
        targetId: 't1',
        metadata: expect.objectContaining({
          notes: 'even chop-ish, heads-up',
          grandTotal: 30_000,
          prizePool: 30_000,
          delta: 0,
          override: false,
          payouts: [
            expect.objectContaining({ entryId: a.id, playerId: a.playerId, amount: 13_000, previousAmount: 0 }),
            expect.objectContaining({ entryId: b.id, amount: 11_000 }),
          ],
        }),
      })
    )
  })

  it('the prize pool comes from the SSOT formula over fresh entries, not the cached counter', async () => {
    const stale = makeTournament({ totalPrizePool: 999_999 }) // stale cache
    const { a, b } = threeHanded()
    const res = await enterDeal({
      tournament: stale,
      allocations: [
        { entryId: a.id, amount: 13_000 },
        { entryId: b.id, amount: 11_000 },
      ],
      actorId: 'td-1',
      actorRole: 'td',
    })
    // 3 non-voided entries × 10_000 buyIn = 30_000 — matches, no override needed.
    expect(res.prizePool).toBe(30_000)
    expect(res.overrideUsed).toBe(false)
  })

  it('a total ≠ pool is refused without a manager acknowledgment (TD, or manager without reason)', async () => {
    const { a } = threeHanded()
    await expect(
      enterDeal({
        tournament: t,
        allocations: [{ entryId: a.id, amount: 5_000 }],
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toThrow(DealTotalMismatchError)

    await expect(
      enterDeal({
        tournament: t,
        allocations: [{ entryId: a.id, amount: 5_000 }],
        actorId: 'mgr-1',
        actorRole: 'manager',
      })
    ).rejects.toThrow(DealTotalMismatchError)
  })

  it('a manager acknowledgment saves the mismatched deal and emits manager.override', async () => {
    const { a } = threeHanded()
    const res = await enterDeal({
      tournament: t,
      allocations: [{ entryId: a.id, amount: 5_000 }],
      managerOverride: { reason: 'winner left $190 on the table for the staff pool' },
      actorId: 'mgr-1',
      actorRole: 'manager',
    })
    // 5_000 (a) + 0 (b) + 6_000 (c staged) = 11_000 vs pool 30_000
    expect(res).toMatchObject({ grandTotal: 11_000, prizePool: 30_000, delta: -19_000, overrideUsed: true })

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'manager.override',
        metadata: expect.objectContaining({ overrideType: 'dealTotalMismatch' }),
      })
    )
  })

  it('refuses to re-stage a row that is already paid', async () => {
    const paid = busted({
      finishingPlace: 2,
      cashWinnings: 10_000,
      winningsPaidAt: Timestamp.now(),
      winningsWalletTransactionId: 'wtx-1',
    })
    const alive = makeEntry()
    seedEntries([paid, alive])
    await expect(
      enterDeal({
        tournament: t,
        allocations: [{ entryId: paid.id, amount: 12_000 }],
        actorId: 'mgr-1',
        actorRole: 'manager',
        managerOverride: { reason: 'x' },
      })
    ).rejects.toThrow(DealRowAlreadyPaidError)
    expect(mockState.calls.set).toHaveLength(0)
  })

  it('refuses a voided entry and an unknown entry', async () => {
    const voided = makeEntry({ voidedAt: Timestamp.now(), voidedBy: 'x', voidReason: 'dup' })
    seedEntries([voided, makeEntry()])
    await expect(
      enterDeal({
        tournament: t,
        allocations: [{ entryId: voided.id, amount: 1_000 }],
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toThrow(/voided/)

    await expect(
      enterDeal({
        tournament: t,
        allocations: [{ entryId: 'nope', amount: 1_000 }],
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toThrow(/does not exist/)
  })

  it('validates the allocations shape before any read', async () => {
    const bad = [
      [[], /at least one/],
      [[{ entryId: '', amount: 100 }], /needs an entryId/],
      [[{ entryId: 'e', amount: -1 }], /integer cents/],
      [[{ entryId: 'e', amount: 10.5 }], /integer cents/],
      [
        [
          { entryId: 'e', amount: 100 },
          { entryId: 'e', amount: 200 },
        ],
        /more than once/,
      ],
    ]
    for (const [allocations, msg] of bad) {
      await expect(
        enterDeal({ tournament: t, allocations, actorId: 'td-1', actorRole: 'td' })
      ).rejects.toThrow(msg)
    }
    expect(entriesApi.listEntries).not.toHaveBeenCalled()
  })

  it('an amount of 0 clears a staged row (with the mismatch guard still applying)', async () => {
    const { a, b, c } = threeHanded()
    const res = await enterDeal({
      tournament: t,
      allocations: [
        { entryId: c.id, amount: 0 }, // clear 3rd's staged $60
        { entryId: a.id, amount: 20_000 },
        { entryId: b.id, amount: 10_000 },
      ],
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(res.delta).toBe(0)
    expect(mockState.get(entryPath('t1', c.id)).cashWinnings).toBe(0)
  })
})
