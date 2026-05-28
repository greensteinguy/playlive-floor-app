import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'

vi.mock('../firestore', () => ({
  walletTransactions: {
    listAllWalletTransactions: vi.fn(),
    listWalletTransactions: vi.fn(),
  },
  players: {
    getPlayer: vi.fn(),
  },
}))

import { walletTransactions, players } from '../firestore'
import { getReconciliationTotals, verifyBalanceMatchesLedger } from './reconciliation'

function tx(overrides) {
  return {
    id: 'tx-x',
    playerId: 'player-1',
    type: 'deposit',
    amount: 0,
    method: null,
    direction: null,
    reference: null,
    relatedDocId: null,
    actorId: 'cashier-1',
    actorRole: 'cashier',
    timestamp: Timestamp.now(),
    notes: null,
    ...overrides,
  }
}

beforeEach(() => {
  walletTransactions.listAllWalletTransactions.mockReset()
  walletTransactions.listWalletTransactions.mockReset()
  players.getPlayer.mockReset()
})

describe('getReconciliationTotals', () => {
  it('aggregates across every supported type/method combination', async () => {
    walletTransactions.listAllWalletTransactions.mockResolvedValue([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({ type: 'deposit', amount: 200_00, method: 'eftpos' }),
      tx({ type: 'deposit', amount: 50_00, method: 'payid' }),
      tx({ type: 'spend', amount: 30_00, method: 'cash' }),
      tx({ type: 'spend', amount: 70_00, method: 'eftpos' }),
      tx({ type: 'spend', amount: 40_00, method: 'wallet' }),
      tx({ type: 'ticketUse', amount: 50_00, method: 'ticket', relatedDocId: 'ticket-1' }),
      tx({ type: 'winCredit', amount: 500_00 }),
      tx({ type: 'withdrawalComplete', amount: 100_00 }),
      tx({ type: 'adjustment', amount: 10_00, direction: 'credit', notes: 'adjustment: credit — typo' }),
      tx({ type: 'adjustment', amount: 5_00, direction: 'debit', notes: 'adjustment: debit — wrong player' }),
      tx({ type: 'managerCredit', amount: 25_00, actorRole: 'manager', notes: 'goodwill' }),
      tx({ type: 'managerDebit', amount: 15_00, actorRole: 'manager', notes: 'recoup' }),
      // The following should be ignored by daily recon:
      tx({ type: 'openingBalance', amount: 1_000_00, reference: 'opening_balance', actorRole: 'system' }),
      tx({ type: 'withdrawalRequest', amount: 100_00 }),
      tx({ type: 'withdrawalCancel', amount: 100_00 }),
    ])

    const { totals, transactionCount } = await getReconciliationTotals({
      since: new Date(0),
      until: new Date(),
    })

    expect(transactionCount).toBe(16)
    expect(totals.deposits).toEqual({ cash: 100_00, eftpos: 200_00, payid: 50_00 })
    expect(totals.spendsExternal).toEqual({ cash: 30_00, eftpos: 70_00 })
    expect(totals.spendsFromWallet).toBe(40_00)
    expect(totals.ticketUses).toBe(50_00)
    expect(totals.winCredits).toBe(500_00)
    expect(totals.withdrawalsCompleted).toBe(100_00)
    expect(totals.adjustments).toEqual({ credit: 10_00, debit: 5_00 })
    expect(totals.managerCredits).toBe(25_00)
    expect(totals.managerDebits).toBe(15_00)
  })

  // Regression: previously this code inferred credit/debit from notes via
  // `notes.includes('credit')`, which mis-classified debits whose reason
  // naturally mentioned "credit" (e.g. "over-credited yesterday"). Direction
  // now lives in its own field, so the reason text is free-form again.
  it('classifies adjustments by the direction field, not the notes text', async () => {
    walletTransactions.listAllWalletTransactions.mockResolvedValue([
      tx({
        type: 'adjustment',
        amount: 30_00,
        direction: 'debit',
        notes: 'adjustment: debit — over-credited yesterday by mistake',
      }),
      tx({
        type: 'adjustment',
        amount: 20_00,
        direction: 'credit',
        notes: 'adjustment: credit — debited the wrong player earlier',
      }),
    ])
    const { totals } = await getReconciliationTotals({
      since: new Date(0),
      until: new Date(),
    })
    expect(totals.adjustments).toEqual({ credit: 20_00, debit: 30_00 })
  })

  it('returns zeros for an empty window', async () => {
    walletTransactions.listAllWalletTransactions.mockResolvedValue([])
    const { totals, transactionCount } = await getReconciliationTotals({
      since: new Date(0),
      until: new Date(),
    })
    expect(transactionCount).toBe(0)
    expect(totals.spendsFromWallet).toBe(0)
    expect(totals.winCredits).toBe(0)
  })
})

describe('verifyBalanceMatchesLedger', () => {
  it('reports drift=0 when cached balance matches the ledger sum', async () => {
    players.getPlayer.mockResolvedValue({ id: 'player-1', walletBalance: 60_00 })
    walletTransactions.listWalletTransactions.mockResolvedValue([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({ type: 'spend', amount: 40_00, method: 'wallet' }),
    ])

    const result = await verifyBalanceMatchesLedger('player-1')
    expect(result.cachedBalance).toBe(60_00)
    expect(result.derivedBalance).toBe(60_00)
    expect(result.drift).toBe(0)
    expect(result.transactionsConsidered).toBe(2)
  })

  it('reports drift when cached balance disagrees with the ledger', async () => {
    players.getPlayer.mockResolvedValue({ id: 'player-1', walletBalance: 100_00 })
    walletTransactions.listWalletTransactions.mockResolvedValue([
      tx({ type: 'deposit', amount: 60_00, method: 'cash' }),
    ])

    const result = await verifyBalanceMatchesLedger('player-1')
    expect(result.cachedBalance).toBe(100_00)
    expect(result.derivedBalance).toBe(60_00)
    expect(result.drift).toBe(40_00)
  })

  it('handles adjustment rows by reading the direction field', async () => {
    players.getPlayer.mockResolvedValue({ id: 'player-1', walletBalance: 95_00 })
    walletTransactions.listWalletTransactions.mockResolvedValue([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({ type: 'adjustment', amount: 10_00, direction: 'credit', notes: 'adjustment: credit — typo' }),
      tx({ type: 'adjustment', amount: 15_00, direction: 'debit', notes: 'adjustment: debit — overcredited' }),
    ])
    const result = await verifyBalanceMatchesLedger('player-1')
    // 100 + 10 - 15 = 95
    expect(result.derivedBalance).toBe(95_00)
    expect(result.drift).toBe(0)
  })

  // Regression: a debit whose reason mentions "credit" used to be mis-summed
  // as a credit because the old reader matched on `notes.includes('credit')`.
  it('debits whose reason mentions "credit" still subtract from the derived balance', async () => {
    players.getPlayer.mockResolvedValue({ id: 'player-1', walletBalance: 70_00 })
    walletTransactions.listWalletTransactions.mockResolvedValue([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({
        type: 'adjustment',
        amount: 30_00,
        direction: 'debit',
        notes: 'adjustment: debit — over-credited the bonus yesterday',
      }),
    ])
    const result = await verifyBalanceMatchesLedger('player-1')
    // 100 - 30 = 70 (a notes-based reader would have given 100 + 30 = 130)
    expect(result.derivedBalance).toBe(70_00)
    expect(result.drift).toBe(0)
  })

  it('handles no-op types (ticketUse, withdrawalRequest, withdrawalCancel)', async () => {
    players.getPlayer.mockResolvedValue({ id: 'player-1', walletBalance: 50_00 })
    walletTransactions.listWalletTransactions.mockResolvedValue([
      tx({ type: 'deposit', amount: 50_00, method: 'cash' }),
      tx({ type: 'ticketUse', amount: 25_00, method: 'ticket', relatedDocId: 't' }),
      tx({ type: 'withdrawalRequest', amount: 30_00 }),
      tx({ type: 'withdrawalCancel', amount: 30_00 }),
    ])
    const result = await verifyBalanceMatchesLedger('player-1')
    expect(result.derivedBalance).toBe(50_00)
  })
})
