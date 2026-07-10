import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  makeMockStore,
  makePlayer,
  makeBountyDraw,
  playerPath,
  bountyDrawPath,
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
    bountyDrawPath: (tid, did) => ['tournaments', tid, 'bountyDraws', did],
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
  },
}))

import { Timestamp } from 'firebase/firestore'
import { runValidatedTransaction, auditLog } from '../firestore'
import {
  confirmWinCredit,
  confirmEntryWinCredit,
  confirmEntryTicketWin,
  confirmBountyWinCredit,
} from './winCredit'
import { RoleNotAuthorizedError, TicketAlreadyIssuedError } from './errors'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
})

describe('confirmWinCredit', () => {
  it('happy path: credits walletBalance by amount, writes winCredit row', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 0 }))

    const result = await confirmWinCredit({
      playerId: 'player-1',
      amount: 200_00,
      relatedDocId: 'entry-99',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.newBalance).toBe(200_00)

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'winCredit',
      amount: 200_00,
      method: null,
      relatedDocId: 'entry-99',
    })

    const updateCall = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(updateCall.partial.walletBalance).toBe(200_00)
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(
      confirmWinCredit({
        playerId: 'p',
        amount,
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })
})

describe('confirmEntryWinCredit', () => {
  const entryPath = (tid, eid) => ['tournaments', tid, 'entries', eid]

  function makeEntry(overrides = {}) {
    return {
      id: 'entry-1',
      playerId: 'player-1',
      tournamentId: 'tournament-1',
      voidedAt: null,
      bustedAt: Timestamp.now(),
      bustedInSessionId: 'session-1',
      finishingPlace: 2,
      cashWinnings: 0,
      ticketWinnings: 0,
      winningsPaidAt: null,
      winningsWalletTransactionId: null,
      ...overrides,
    }
  }

  function seed({ entry = {}, walletBalance = 0 } = {}) {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance }))
    mockState.seed(entryPath('tournament-1', 'entry-1'), makeEntry(entry))
  }

  const confirmArgs = (overrides = {}) => ({
    tournamentId: 'tournament-1',
    entryId: 'entry-1',
    amount: 300_00,
    actorId: 'cashier-1',
    actorRole: 'cashier',
    ...overrides,
  })

  it('happy path: one transaction credits the wallet, writes the winCredit row, and marks the entry paid', async () => {
    seed({ walletBalance: 50_00 })

    const result = await confirmEntryWinCredit(confirmArgs())
    expect(result.newBalance).toBe(350_00)
    expect(result.playerId).toBe('player-1')

    // winCredit ledger row related to the entry
    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'winCredit',
      amount: 300_00,
      method: null,
      relatedDocId: 'entry-1',
    })

    // wallet balance credited
    const balanceUpdate = mockState.calls.update.find((c) => c.path.length === 2 && c.path[0] === 'players')
    expect(balanceUpdate.partial.walletBalance).toBe(350_00)

    // entry marked paid, cashWinnings set to the paid amount, tx linked
    const entryWrite = mockState.calls.set.find((c) => c.path[2] === 'entries')
    expect(entryWrite.data).toMatchObject({
      cashWinnings: 300_00,
      winningsWalletTransactionId: result.walletTransactionId,
    })
    expect(entryWrite.data.winningsPaidAt).not.toBeNull()

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'wallet.winCredit',
        targetId: 'player-1',
        metadata: expect.objectContaining({
          relatedDocId: 'entry-1',
          tournamentId: 'tournament-1',
          source: 'tournamentPayout',
        }),
      })
    )
  })

  it('overwrites a staged deal amount with the actually-paid amount', async () => {
    seed({ entry: { cashWinnings: 275_00 } }) // staged via deal
    await confirmEntryWinCredit(confirmArgs({ amount: 275_00 }))
    const entryWrite = mockState.calls.set.find((c) => c.path[2] === 'entries')
    expect(entryWrite.data.cashWinnings).toBe(275_00)
  })

  it('refuses a double-confirm (winningsPaidAt already set) — nothing written', async () => {
    seed({ entry: { cashWinnings: 300_00, winningsPaidAt: Timestamp.now(), winningsWalletTransactionId: 'wtx-prior' } })
    await expect(confirmEntryWinCredit(confirmArgs())).rejects.toThrow(/already paid/)
    expect(mockState.calls.set).toHaveLength(0)
    expect(mockState.calls.update).toHaveLength(0)
  })

  it('refuses a voided entry', async () => {
    seed({ entry: { voidedAt: Timestamp.now(), voidedBy: 'x', voidReason: 'dup' } })
    await expect(confirmEntryWinCredit(confirmArgs())).rejects.toThrow(/voided/)
  })

  it.each([['td'], ['readonly']])('role gate: %s cannot confirm a payout', async (actorRole) => {
    seed()
    await expect(confirmEntryWinCredit(confirmArgs({ actorRole }))).rejects.toThrow(
      RoleNotAuthorizedError
    )
  })

  it.each([[0], [-100], [10.5]])('rejects amount %s', async (amount) => {
    seed()
    await expect(confirmEntryWinCredit(confirmArgs({ amount }))).rejects.toThrow(
      /integer cents > 0/
    )
  })
})

describe('confirmEntryTicketWin', () => {
  const entryPath = (tid, eid) => ['tournaments', tid, 'entries', eid]

  // A satellite milestone winner: bust fields set, ticketWinnings recorded,
  // finishingPlace null (a milestone exit is a win, not a finishing position).
  function makeEntry(overrides = {}) {
    return {
      id: 'entry-1',
      playerId: 'player-1',
      tournamentId: 'tournament-1',
      voidedAt: null,
      bustedAt: Timestamp.now(),
      bustedInSessionId: 'session-1',
      finishingPlace: null,
      cashWinnings: 0,
      ticketWinnings: 150_00,
      winningsPaidAt: null,
      winningsWalletTransactionId: null,
      ticketIssuedAt: null,
      issuedTicketId: null,
      ...overrides,
    }
  }

  function seed({ entry = {}, ticketBalance = 0 } = {}) {
    mockState.seed(playerPath('player-1'), makePlayer({ ticketBalance }))
    mockState.seed(entryPath('tournament-1', 'entry-1'), makeEntry(entry))
  }

  const confirmArgs = (overrides = {}) => ({
    tournamentId: 'tournament-1',
    entryId: 'entry-1',
    actorId: 'cashier-1',
    actorRole: 'cashier',
    ...overrides,
  })

  it('happy path: one transaction creates the ticket, credits ticketBalance, and stamps the entry', async () => {
    seed({ ticketBalance: 50_00 })

    const result = await confirmEntryTicketWin(confirmArgs())
    expect(result.faceValue).toBe(150_00)
    expect(result.newTicketBalance).toBe(200_00)
    expect(result.playerId).toBe('player-1')

    // the wallet-side ticket doc, issueTicket's exact shape
    const ticketCall = mockState.calls.set.find((c) => c.path[2] === 'tickets')
    expect(ticketCall.path).toEqual(['players', 'player-1', 'tickets', result.ticketId])
    expect(ticketCall.data).toMatchObject({
      playerId: 'player-1',
      faceValue: 150_00,
      state: 'unused',
      issuedReason: 'satelliteWin',
      issuedFromTournamentId: 'tournament-1',
      usedAt: null,
      usedOnEntryId: null,
      usedOnTournamentId: null,
    })
    expect(ticketCall.data.issuedAt).not.toBeNull()

    // ticketBalance credited (walletBalance untouched)
    const balanceUpdate = mockState.calls.update.find((c) => c.path.length === 2 && c.path[0] === 'players')
    expect(balanceUpdate.partial.ticketBalance).toBe(200_00)
    expect(balanceUpdate.partial.walletBalance).toBeUndefined()

    // entry stamped with the idempotency marker + two-way trace
    const entryWrite = mockState.calls.set.find((c) => c.path[2] === 'entries')
    expect(entryWrite.data).toMatchObject({
      ticketWinnings: 150_00,
      issuedTicketId: result.ticketId,
    })
    expect(entryWrite.data.ticketIssuedAt).not.toBeNull()

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'wallet.ticketIssued',
        targetType: 'ticket',
        targetId: result.ticketId,
        metadata: expect.objectContaining({
          playerId: 'player-1',
          faceValue: 150_00,
          issuedReason: 'satelliteWin',
          issuedFromTournamentId: 'tournament-1',
          entryId: 'entry-1',
          source: 'tournamentPayout',
        }),
      })
    )
  })

  it('refuses a double-issue (ticketIssuedAt already set) — typed error, nothing written', async () => {
    seed({ entry: { ticketIssuedAt: Timestamp.now(), issuedTicketId: 'ticket-prior' } })
    await expect(confirmEntryTicketWin(confirmArgs())).rejects.toThrow(TicketAlreadyIssuedError)
    expect(mockState.calls.set).toHaveLength(0)
    expect(mockState.calls.update).toHaveLength(0)
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })

  it('refuses a voided entry', async () => {
    seed({ entry: { voidedAt: Timestamp.now(), voidedBy: 'x', voidReason: 'dup' } })
    await expect(confirmEntryTicketWin(confirmArgs())).rejects.toThrow(/voided/)
  })

  it('refuses an entry with no ticket winnings recorded', async () => {
    seed({ entry: { ticketWinnings: 0 } })
    await expect(confirmEntryTicketWin(confirmArgs())).rejects.toThrow(/no ticket winnings/)
    expect(mockState.calls.set).toHaveLength(0)
    expect(mockState.calls.update).toHaveLength(0)
  })

  it.each([['td'], ['readonly']])('role gate: %s cannot issue a ticket win', async (actorRole) => {
    seed()
    await expect(confirmEntryTicketWin(confirmArgs({ actorRole }))).rejects.toThrow(
      RoleNotAuthorizedError
    )
  })

  it('manager can issue', async () => {
    seed()
    await expect(
      confirmEntryTicketWin(confirmArgs({ actorId: 'manager-1', actorRole: 'manager' }))
    ).resolves.toMatchObject({ faceValue: 150_00 })
  })
})

describe('confirmBountyWinCredit', () => {
  function seed({ walletTransactionId = null } = {}) {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 0 }))
    mockState.seed(
      bountyDrawPath('tournament-1', 'draw-1'),
      makeBountyDraw({ walletTransactionId })
    )
  }

  it('happy path: credits balance + links bountyDraw to walletTransaction', async () => {
    seed()

    const result = await confirmBountyWinCredit({
      tournamentId: 'tournament-1',
      drawId: 'draw-1',
      playerId: 'player-1',
      amount: 1_000_00,
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.newBalance).toBe(1_000_00)

    const drawUpdate = mockState.calls.update.find(
      (c) => c.path[0] === 'tournaments' && c.path[2] === 'bountyDraws'
    )
    expect(drawUpdate.partial).toMatchObject({ walletTransactionId: result.walletTransactionId })
  })

  it('rejects double-confirm (bountyDraw already has walletTransactionId)', async () => {
    seed({ walletTransactionId: 'prior-tx-id' })

    await expect(
      confirmBountyWinCredit({
        tournamentId: 'tournament-1',
        drawId: 'draw-1',
        playerId: 'player-1',
        amount: 1_000_00,
        actorId: 'cashier-1',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/already confirmed/)
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(
      confirmBountyWinCredit({
        tournamentId: 't',
        drawId: 'd',
        playerId: 'p',
        amount,
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })
})
