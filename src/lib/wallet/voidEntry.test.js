import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  makeMockStore,
  makePlayer,
  makeTicket,
  playerPath,
  walletTransactionPath,
  ticketPath,
  entryPath,
} from './_test-helpers'

let mockState
let nextId

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  generateId: vi.fn(() => nextId()),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  entries: { getEntry: vi.fn() },
  walletTransactions: { listWalletTransactions: vi.fn() },
  paths: {
    playerPath: (id) => ['players', id],
    walletTransactionPath: (pid, tid) => ['players', pid, 'walletTransactions', tid],
    ticketPath: (pid, tid) => ['players', pid, 'tickets', tid],
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
    tablePath: (tid, tableId) => ['tournaments', tid, 'tables', tableId],
  },
}))

import {
  runValidatedTransaction,
  auditLog,
  entries as entriesApi,
  walletTransactions as walletTxApi,
} from '../firestore'
import { voidEntryWithRefund } from './voidEntry'
import {
  RoleNotAuthorizedError,
  EntryAlreadyVoidedError,
  EntryNotVoidableError,
} from './errors'

const tablePath = (tid, tableId) => ['tournaments', tid, 'tables', tableId]

function makeVoidableEntry(overrides = {}) {
  return {
    id: 'entry-1',
    tournamentId: 'tournament-1',
    playerId: 'player-1',
    paymentMethod: 'cash',
    paymentAmount: 100_00,
    paymentReference: null,
    walletTransactionId: 'wtx-buyin',
    currentTableId: null,
    currentSeatNumber: null,
    bustedAt: null,
    bustedInSessionId: null,
    finishingPlace: null,
    winningsPaidAt: null,
    winningsWalletTransactionId: null,
    ticketIssuedAt: null,
    issuedTicketId: null,
    cashWinnings: 0,
    ticketWinnings: 0,
    bountyEarnings: 0,
    bountiesKnockoutCount: 0,
    isLastLongerWinner: false,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  }
}

/** Seed the entry both for the outside snapshot read and the in-tx re-read. */
function seedEntry(entry) {
  entriesApi.getEntry.mockResolvedValue(entry)
  mockState.seed(entryPath('tournament-1', entry.id), entry)
}

const ARGS = {
  tournamentId: 'tournament-1',
  entryId: 'entry-1',
  reason: 'wrong player selected',
  actorId: 'cashier-1',
  actorRole: 'cashier',
}

const refundRows = () =>
  mockState.calls.set.filter((c) => c.path[2] === 'walletTransactions')

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `refund-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
  entriesApi.getEntry.mockReset()
  walletTxApi.listWalletTransactions.mockReset().mockResolvedValue([])
  mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 50_00, ticketBalance: 0 }))
})

describe('voidEntryWithRefund — cash / eftpos', () => {
  it('voids the entry and writes the external refund row (no balance change)', async () => {
    seedEntry(makeVoidableEntry())

    const res = await voidEntryWithRefund(ARGS)

    expect(res.refunds).toEqual([
      { walletTransactionId: 'refund-1', method: 'cash', amount: 100_00 },
    ])
    expect(res.ticketReinstatedId).toBeNull()

    const [row] = refundRows()
    expect(row.data).toMatchObject({
      type: 'entryRefund',
      amount: 100_00,
      method: 'cash',
      relatedDocId: 'entry-1',
      notes: 'wrong player selected',
    })

    // Entry voided in the same transaction, void triple set together.
    const entryWrite = mockState.calls.set.find((c) => c.path[2] === 'entries')
    expect(entryWrite.data).toMatchObject({
      voidedBy: 'cashier-1',
      voidReason: 'wrong player selected',
      currentTableId: null,
      currentSeatNumber: null,
    })
    expect(entryWrite.data.voidedAt).not.toBeNull()

    // Cash refund is external — the wallet balance is untouched.
    expect(mockState.calls.update.find((c) => c.path.length === 2 && c.path[0] === 'players')).toBeUndefined()

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'entry.voided', targetId: 'entry-1' })
    )
  })

  it('frees the seat when the entry is seated', async () => {
    const seats = Array.from({ length: 9 }, (_, i) => ({
      seatNumber: i + 1,
      entryId: i + 1 === 3 ? 'entry-1' : null,
    }))
    mockState.seed(tablePath('tournament-1', 'table-1'), {
      id: 'table-1',
      tournamentId: 'tournament-1',
      sessionId: 's1',
      tableNumber: 1,
      seatCount: 9,
      status: 'open',
      openedAt: null,
      closedAt: null,
      seats,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    seedEntry(makeVoidableEntry({ currentTableId: 'table-1', currentSeatNumber: 3 }))

    await voidEntryWithRefund(ARGS)

    const tableWrite = mockState.calls.set.find((c) => c.path[2] === 'tables')
    expect(tableWrite.data.seats.find((s) => s.seatNumber === 3).entryId).toBeNull()
  })
})

describe('voidEntryWithRefund — wallet', () => {
  it('credits the wallet balance back in the same transaction', async () => {
    seedEntry(makeVoidableEntry({ paymentMethod: 'wallet', paymentAmount: 80_00 }))

    const res = await voidEntryWithRefund(ARGS)

    expect(res.refunds).toEqual([
      { walletTransactionId: 'refund-1', method: 'wallet', amount: 80_00 },
    ])
    const playerUpdate = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(playerUpdate.partial.walletBalance).toBe(50_00 + 80_00)
  })
})

describe('voidEntryWithRefund — ticket', () => {
  const usedTicket = (overrides = {}) =>
    makeTicket({
      id: 'ticket-1',
      faceValue: 60_00,
      state: 'used',
      usedAt: Timestamp.now(),
      usedOnEntryId: 'entry-1',
      usedOnTournamentId: 'tournament-1',
      ...overrides,
    })

  it('reinstates the ticket, restores ticketBalance, and refunds the top-up', async () => {
    mockState.seed(ticketPath('player-1', 'ticket-1'), usedTicket())
    // The original registration: $100 cost, $60 ticket + $40 cash top-up.
    seedEntry(
      makeVoidableEntry({ paymentMethod: 'ticket', paymentAmount: 100_00, paymentReference: 'ticket-1' })
    )
    walletTxApi.listWalletTransactions.mockResolvedValue([
      { id: 'topup-1', type: 'spend', method: 'cash', amount: 40_00, relatedDocId: 'entry-1' },
      { id: 'other', type: 'deposit', method: 'cash', amount: 10_00, relatedDocId: null },
    ])
    mockState.seed(walletTransactionPath('player-1', 'topup-1'), {
      id: 'topup-1',
      type: 'spend',
      method: 'cash',
      amount: 40_00,
      relatedDocId: 'entry-1',
    })

    const res = await voidEntryWithRefund(ARGS)

    expect(res.ticketReinstatedId).toBe('ticket-1')
    expect(res.refunds).toEqual([
      { walletTransactionId: 'refund-1', method: 'ticket', amount: 60_00 },
      { walletTransactionId: 'refund-2', method: 'cash', amount: 40_00 },
    ])

    const ticketUpdate = mockState.calls.update.find((c) => c.path[2] === 'tickets')
    expect(ticketUpdate.partial).toMatchObject({
      state: 'unused',
      usedAt: null,
      usedOnEntryId: null,
      usedOnTournamentId: null,
    })
    const playerUpdate = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(playerUpdate.partial.ticketBalance).toBe(60_00)
  })

  it('a below-face-value override void reinstates the ticket only (no top-up row)', async () => {
    mockState.seed(ticketPath('player-1', 'ticket-1'), usedTicket({ faceValue: 60_00 }))
    seedEntry(
      makeVoidableEntry({ paymentMethod: 'ticket', paymentAmount: 100_00, paymentReference: 'ticket-1' })
    )
    const res = await voidEntryWithRefund(ARGS)
    // Refund amount mirrors the original ticketUse row: min(faceValue, cost).
    expect(res.refunds).toEqual([
      { walletTransactionId: 'refund-1', method: 'ticket', amount: 60_00 },
    ])
  })

  it('refuses when the ticket is not marked used on this entry', async () => {
    mockState.seed(ticketPath('player-1', 'ticket-1'), usedTicket({ usedOnEntryId: 'someone-else' }))
    seedEntry(
      makeVoidableEntry({ paymentMethod: 'ticket', paymentAmount: 100_00, paymentReference: 'ticket-1' })
    )
    await expect(voidEntryWithRefund(ARGS)).rejects.toThrow(EntryNotVoidableError)
    expect(refundRows()).toHaveLength(0)
  })
})

describe('voidEntryWithRefund — refusals & idempotency', () => {
  it.each([
    ['busted', { bustedAt: Timestamp.now(), bustedInSessionId: 's1' }, /undo the elimination/],
    ['winnings paid', { winningsPaidAt: Timestamp.now() }, /already been paid/],
    ['staged winnings', { cashWinnings: 500_00 }, /staged/],
    ['bounty earnings', { bountyEarnings: 100_00, bountiesKnockoutCount: 1 }, /bounty/],
    ['last-longer winner', { isLastLongerWinner: true }, /last-longer/],
  ])('refuses to void an entry with %s', async (_label, overrides, msg) => {
    seedEntry(makeVoidableEntry(overrides))
    await expect(voidEntryWithRefund(ARGS)).rejects.toThrow(EntryNotVoidableError)
    await expect(
      voidEntryWithRefund({ ...ARGS }).catch((e) => Promise.reject(e))
    ).rejects.toThrow(msg)
    expect(mockState.calls.set).toHaveLength(0)
  })

  it('replays the same gesture on an already-voided entry (no writes, no audit)', async () => {
    seedEntry(
      makeVoidableEntry({
        voidedAt: Timestamp.now(),
        voidedBy: 'cashier-1',
        voidReason: 'wrong player selected',
      })
    )
    const res = await voidEntryWithRefund(ARGS)
    expect(res.alreadyVoided).toBe(true)
    expect(mockState.calls.set).toHaveLength(0)
    expect(mockState.calls.update).toHaveLength(0)
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })

  it('refuses a DIFFERENT gesture on an already-voided entry', async () => {
    seedEntry(
      makeVoidableEntry({
        voidedAt: Timestamp.now(),
        voidedBy: 'someone-else',
        voidReason: 'other reason',
      })
    )
    await expect(voidEntryWithRefund(ARGS)).rejects.toThrow(EntryAlreadyVoidedError)
  })

  it('refuses the readonly role', async () => {
    seedEntry(makeVoidableEntry())
    await expect(voidEntryWithRefund({ ...ARGS, actorRole: 'readonly' })).rejects.toThrow(
      RoleNotAuthorizedError
    )
  })

  it('requires a reason', async () => {
    seedEntry(makeVoidableEntry())
    await expect(voidEntryWithRefund({ ...ARGS, reason: '  ' })).rejects.toThrow(/reason/)
  })
})
