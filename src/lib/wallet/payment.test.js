import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  makeMockStore,
  makePlayer,
  makeTicket,
  makeEntryData,
  playerPath,
  ticketPath,
} from './_test-helpers'

let mockState
let nextId

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  validatedSet: vi.fn(),
  generateId: vi.fn(() => nextId()),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    playerPath: (id) => ['players', id],
    walletTransactionPath: (pid, tid) => ['players', pid, 'walletTransactions', tid],
    ticketPath: (pid, tid) => ['players', pid, 'tickets', tid],
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
  },
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import {
  payViaExternalMethod,
  payViaWallet,
  payViaTicket,
} from './payment'
import {
  InsufficientWalletBalanceError,
  TicketBelowFaceValueError,
  TicketAlreadyUsedError,
  DuplicateEntryError,
} from './errors'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
})

describe('payViaExternalMethod', () => {
  it('happy path with cash: writes spend row + entry, no balance change', async () => {
    const result = await payViaExternalMethod({
      entryData: makeEntryData(),
      totalCost: 50_00,
      method: 'cash',
      reference: 'till-1',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.entryId).toBe('id-1')
    expect(result.walletTransactionId).toBe('id-2')

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'spend',
      amount: 50_00,
      method: 'cash',
      reference: 'till-1',
      relatedDocId: 'id-1',
    })

    const entryCall = mockState.calls.set.find((c) => c.path[2] === 'entries')
    expect(entryCall.data).toMatchObject({
      paymentMethod: 'cash',
      paymentAmount: 50_00,
      paymentReference: 'till-1',
      walletTransactionId: 'id-2',
    })

    // No player update — external payment doesn't touch the wallet balance.
    expect(
      mockState.calls.update.find((c) => c.path.length === 2 && c.path[0] === 'players')
    ).toBeUndefined()
  })

  it('happy path with EFTPOS', async () => {
    await payViaExternalMethod({
      entryData: makeEntryData(),
      totalCost: 50_00,
      method: 'eftpos',
      reference: 'APPROVAL-9876',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data.method).toBe('eftpos')
    expect(wtxCall.data.reference).toBe('APPROVAL-9876')
  })

  it("rejects method='wallet' (use payViaWallet instead)", async () => {
    await expect(
      payViaExternalMethod({
        entryData: makeEntryData(),
        totalCost: 50_00,
        method: 'wallet',
        reference: null,
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/method must be 'cash' or 'eftpos'/)
  })

  it('rejects missing required entryData field', async () => {
    const incomplete = makeEntryData()
    delete incomplete.tournamentId
    await expect(
      payViaExternalMethod({
        entryData: incomplete,
        totalCost: 50_00,
        method: 'cash',
        reference: 'x',
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/entryData\.tournamentId is required/)
  })
})

describe('payViaWallet', () => {
  it('happy path: debits balance by totalCost', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 100_00 }))

    const result = await payViaWallet({
      entryData: makeEntryData(),
      totalCost: 50_00,
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.entryId).toBe('id-1')

    const updateCall = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(updateCall.partial.walletBalance).toBe(50_00)

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'spend',
      amount: 50_00,
      method: 'wallet',
      reference: null,
    })

    const entryCall = mockState.calls.set.find((c) => c.path[2] === 'entries')
    expect(entryCall.data.paymentMethod).toBe('wallet')
  })

  it('HARD: rejects when balance < totalCost — no override possible', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 30_00 }))

    await expect(
      payViaWallet({
        entryData: makeEntryData(),
        totalCost: 50_00,
        actorId: 'cashier-1',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(InsufficientWalletBalanceError)
  })

  it('accepts when balance exactly equals totalCost', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 50_00 }))

    await payViaWallet({
      entryData: makeEntryData(),
      totalCost: 50_00,
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    const updateCall = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(updateCall.partial.walletBalance).toBe(0)
  })
})

describe('payViaTicket', () => {
  function seed({ balance = 0, ticketBalance = 100_00, faceValue = 50_00, state = 'unused' } = {}) {
    mockState.seed(
      playerPath('player-1'),
      makePlayer({ walletBalance: balance, ticketBalance })
    )
    mockState.seed(
      ticketPath('player-1', 'ticket-1'),
      makeTicket({ faceValue, state })
    )
  }

  it('happy path: faceValue == totalCost — ticket marked used, no top-up', async () => {
    seed({ faceValue: 50_00 })

    const result = await payViaTicket({
      entryData: makeEntryData(),
      totalCost: 50_00,
      ticketId: 'ticket-1',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.topUpTransactionId).toBeNull()

    // Ticket marked used
    const ticketUpdate = mockState.calls.update.find(
      (c) => c.path[2] === 'tickets'
    )
    expect(ticketUpdate.partial).toMatchObject({
      state: 'used',
      usedOnEntryId: result.entryId,
      usedOnTournamentId: 'tournament-1',
    })

    // ticketUse walletTransactions row
    const wtxCalls = mockState.calls.set.filter((c) => c.path[2] === 'walletTransactions')
    expect(wtxCalls).toHaveLength(1)
    expect(wtxCalls[0].data).toMatchObject({
      type: 'ticketUse',
      method: 'ticket',
      amount: 50_00,
      relatedDocId: 'ticket-1',
    })
  })

  it('faceValue > totalCost: venue keeps the difference (no refund)', async () => {
    seed({ faceValue: 80_00 })

    await payViaTicket({
      entryData: makeEntryData(),
      totalCost: 50_00,
      ticketId: 'ticket-1',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    const wtxCalls = mockState.calls.set.filter((c) => c.path[2] === 'walletTransactions')
    expect(wtxCalls).toHaveLength(1)
    // amount is capped at totalCost when faceValue exceeds it
    expect(wtxCalls[0].data.amount).toBe(50_00)
  })

  it('faceValue < totalCost with top-up: writes second spend row', async () => {
    seed({ faceValue: 30_00 })

    await payViaTicket({
      entryData: makeEntryData(),
      totalCost: 50_00,
      ticketId: 'ticket-1',
      topUp: { method: 'cash', reference: 'till-1' },
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    const wtxCalls = mockState.calls.set.filter((c) => c.path[2] === 'walletTransactions')
    expect(wtxCalls).toHaveLength(2)
    const topUp = wtxCalls.find((c) => c.data.type === 'spend')
    expect(topUp.data).toMatchObject({
      amount: 20_00,
      method: 'cash',
      reference: 'till-1',
      notes: 'ticket top-up',
    })
  })

  it('faceValue < totalCost with managerOverride: ticket used at face-value, override audited', async () => {
    seed({ faceValue: 30_00 })

    await payViaTicket({
      entryData: makeEntryData(),
      totalCost: 50_00,
      ticketId: 'ticket-1',
      managerOverride: { reason: 'comp from prior shift' },
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    // Only one walletTransaction (no top-up)
    const wtxCalls = mockState.calls.set.filter((c) => c.path[2] === 'walletTransactions')
    expect(wtxCalls).toHaveLength(1)

    // manager.override audit fired
    const overrideAudit = auditLog.writeAuditLogSafe.mock.calls.find(
      ([call]) => call.actionType === 'manager.override'
    )
    expect(overrideAudit).toBeDefined()
    expect(overrideAudit[0].metadata).toMatchObject({
      overrideType: 'ticketBelowFaceValue',
      reason: 'comp from prior shift',
    })
  })

  it('rejects faceValue < totalCost with NO top-up AND no override', async () => {
    seed({ faceValue: 30_00 })

    await expect(
      payViaTicket({
        entryData: makeEntryData(),
        totalCost: 50_00,
        ticketId: 'ticket-1',
        actorId: 'cashier-1',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(TicketBelowFaceValueError)
  })

  it('rejects already-used ticket', async () => {
    seed({ faceValue: 50_00, state: 'used' })

    await expect(
      payViaTicket({
        entryData: makeEntryData(),
        totalCost: 50_00,
        ticketId: 'ticket-1',
        actorId: 'cashier-1',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(TicketAlreadyUsedError)
  })

  it('rejects invalid topUp.method', async () => {
    seed({ faceValue: 30_00 })

    await expect(
      payViaTicket({
        entryData: makeEntryData(),
        totalCost: 50_00,
        ticketId: 'ticket-1',
        topUp: { method: 'crypto', reference: null },
        actorId: 'cashier-1',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/topUp\.method must be 'cash' or 'eftpos'/)
  })
})

// ── Deterministic entry id: duplicate / idempotency gate ─────────────────────
//
// registerEntry passes entryId = `${playerId}_${entryNumber}`. The transaction
// probes that path first: a matching existing doc is a replay of the same
// gesture (timeout → retry) and returns the original result with NO new writes;
// a non-matching doc means another device just registered the player → refuse.

describe('deterministic entry id gate', () => {
  const ENTRY_ID = 'player-1_1'
  const entryPathOf = (eid) => ['tournaments', 'tournament-1', 'entries', eid]

  function seedExistingEntry(overrides = {}) {
    mockState.seed(entryPathOf(ENTRY_ID), {
      id: ENTRY_ID,
      playerId: 'player-1',
      registeredBy: 'cashier-1',
      paymentMethod: 'cash',
      paymentAmount: 50_00,
      walletTransactionId: 'wtx-original',
      voidedAt: null,
      ...overrides,
    })
  }

  it('replays the same gesture without writing or auditing (cash)', async () => {
    seedExistingEntry()
    const result = await payViaExternalMethod({
      entryData: makeEntryData(),
      totalCost: 50_00,
      method: 'cash',
      reference: 'till-1',
      actorId: 'cashier-1',
      actorRole: 'cashier',
      entryId: ENTRY_ID,
    })
    expect(result).toEqual({
      entryId: ENTRY_ID,
      walletTransactionId: 'wtx-original',
      alreadyRegistered: true,
    })
    expect(mockState.calls.set).toHaveLength(0)
    expect(mockState.calls.update).toHaveLength(0)
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })

  it('replays a wallet payment without re-debiting the balance', async () => {
    seedExistingEntry({ paymentMethod: 'wallet' })
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 10_00 })) // < totalCost — must not matter on replay
    const result = await payViaWallet({
      entryData: makeEntryData(),
      totalCost: 50_00,
      actorId: 'cashier-1',
      actorRole: 'cashier',
      entryId: ENTRY_ID,
    })
    expect(result.alreadyRegistered).toBe(true)
    expect(result.walletTransactionId).toBe('wtx-original')
    expect(mockState.calls.set).toHaveLength(0)
    expect(mockState.calls.update).toHaveLength(0)
  })

  it('replays a ticket payment without touching the ticket', async () => {
    seedExistingEntry({ paymentMethod: 'ticket' })
    const result = await payViaTicket({
      entryData: makeEntryData(),
      totalCost: 50_00,
      ticketId: 'ticket-1',
      actorId: 'cashier-1',
      actorRole: 'cashier',
      entryId: ENTRY_ID,
    })
    expect(result).toEqual({
      entryId: ENTRY_ID,
      ticketUseTransactionId: 'wtx-original',
      topUpTransactionId: null,
      alreadyRegistered: true,
    })
    expect(mockState.calls.set).toHaveLength(0)
    expect(mockState.calls.update).toHaveLength(0)
  })

  it('refuses a concurrent duplicate (different registrar) without charging', async () => {
    seedExistingEntry({ registeredBy: 'cashier-OTHER' })
    await expect(
      payViaExternalMethod({
        entryData: makeEntryData(),
        totalCost: 50_00,
        method: 'cash',
        reference: null,
        actorId: 'cashier-1',
        actorRole: 'cashier',
        entryId: ENTRY_ID,
      })
    ).rejects.toThrow(DuplicateEntryError)
    expect(mockState.calls.set).toHaveLength(0)
  })

  it('refuses when the existing entry differs in amount or method', async () => {
    seedExistingEntry({ paymentAmount: 80_00 })
    await expect(
      payViaWallet({
        entryData: makeEntryData(),
        totalCost: 50_00,
        actorId: 'cashier-1',
        actorRole: 'cashier',
        entryId: ENTRY_ID,
      })
    ).rejects.toThrow(DuplicateEntryError)
  })

  it('refuses when the existing entry at the id is voided (numbers are never reused)', async () => {
    seedExistingEntry({ voidedAt: {} })
    await expect(
      payViaExternalMethod({
        entryData: makeEntryData(),
        totalCost: 50_00,
        method: 'cash',
        reference: null,
        actorId: 'cashier-1',
        actorRole: 'cashier',
        entryId: ENTRY_ID,
      })
    ).rejects.toThrow(DuplicateEntryError)
  })

  it('runs the inTransactionGuard before writes and propagates its veto', async () => {
    const guard = vi.fn(async () => {
      throw new Error('guard veto')
    })
    await expect(
      payViaExternalMethod({
        entryData: makeEntryData(),
        totalCost: 50_00,
        method: 'cash',
        reference: null,
        actorId: 'cashier-1',
        actorRole: 'cashier',
        entryId: ENTRY_ID,
        inTransactionGuard: guard,
      })
    ).rejects.toThrow(/guard veto/)
    expect(guard).toHaveBeenCalledTimes(1)
    expect(mockState.calls.set).toHaveLength(0)
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })

  it('skips the guard on a replay (that registration already happened)', async () => {
    seedExistingEntry()
    const guard = vi.fn()
    const result = await payViaExternalMethod({
      entryData: makeEntryData(),
      totalCost: 50_00,
      method: 'cash',
      reference: null,
      actorId: 'cashier-1',
      actorRole: 'cashier',
      entryId: ENTRY_ID,
      inTransactionGuard: guard,
    })
    expect(result.alreadyRegistered).toBe(true)
    expect(guard).not.toHaveBeenCalled()
  })

  it('writes the entry at the provided deterministic id on the happy path', async () => {
    const guard = vi.fn().mockResolvedValue(undefined)
    const result = await payViaExternalMethod({
      entryData: makeEntryData(),
      totalCost: 50_00,
      method: 'cash',
      reference: null,
      actorId: 'cashier-1',
      actorRole: 'cashier',
      entryId: ENTRY_ID,
      inTransactionGuard: guard,
    })
    expect(guard).toHaveBeenCalledTimes(1)
    expect(result.entryId).toBe(ENTRY_ID)
    const entryCall = mockState.calls.set.find((c) => c.path[2] === 'entries')
    expect(entryCall.path[3]).toBe(ENTRY_ID)
  })
})
