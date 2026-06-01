import { describe, it, expect } from 'vitest'
import {
  buildLedger,
  summarizeLedger,
  ledgerTypeLabel,
  ledgerMethodLabel,
  ledgerAmountTone,
  ledgerFilterMatch,
  LEDGER_FILTERS,
} from './walletLedger'

// Minimal walletTransaction-shaped fixtures. buildLedger / walletTxDelta only
// read type / amount / method / direction / timestamp, so we keep these lean.
let seq = 0
function tx(partial, tMillis) {
  seq += 1
  return {
    id: `tx-${seq}`,
    type: 'deposit',
    amount: 0,
    method: null,
    direction: null,
    reference: null,
    timestamp: { toMillis: () => tMillis },
    ...partial,
  }
}

describe('ledgerTypeLabel', () => {
  it('labels the common types', () => {
    expect(ledgerTypeLabel({ type: 'deposit' })).toBe('Deposit')
    expect(ledgerTypeLabel({ type: 'spend' })).toBe('Buy-in')
    expect(ledgerTypeLabel({ type: 'winCredit' })).toBe('Winnings')
    expect(ledgerTypeLabel({ type: 'withdrawalComplete' })).toBe('Withdrawal paid')
    expect(ledgerTypeLabel({ type: 'managerCredit' })).toBe('Manager credit')
  })

  it('surfaces the credit/debit sense of an adjustment', () => {
    expect(ledgerTypeLabel({ type: 'adjustment', direction: 'credit' })).toBe('Adjustment (credit)')
    expect(ledgerTypeLabel({ type: 'adjustment', direction: 'debit' })).toBe('Adjustment (debit)')
  })

  it('falls back to the raw type for an unknown value', () => {
    expect(ledgerTypeLabel({ type: 'somethingNew' })).toBe('somethingNew')
  })
})

describe('ledgerMethodLabel', () => {
  it('maps each method', () => {
    expect(ledgerMethodLabel({ method: 'cash' })).toBe('Cash')
    expect(ledgerMethodLabel({ method: 'eftpos' })).toBe('EFTPOS')
    expect(ledgerMethodLabel({ method: 'payid' })).toBe('PayID')
    expect(ledgerMethodLabel({ method: 'wallet' })).toBe('From wallet')
    expect(ledgerMethodLabel({ method: 'ticket' })).toBe('Ticket')
  })

  it('shows an em dash for a null method', () => {
    expect(ledgerMethodLabel({ method: null })).toBe('—')
  })
})

describe('ledgerAmountTone', () => {
  it('classifies by sign', () => {
    expect(ledgerAmountTone(500)).toBe('credit')
    expect(ledgerAmountTone(-500)).toBe('debit')
    expect(ledgerAmountTone(0)).toBe('none')
  })
})

describe('ledgerFilterMatch', () => {
  it('the "all" filter matches every type', () => {
    const all = LEDGER_FILTERS.find((f) => f.id === 'all')
    expect(ledgerFilterMatch(all, 'deposit')).toBe(true)
    expect(ledgerFilterMatch(all, 'withdrawalComplete')).toBe(true)
  })

  it('groups deposits, buy-ins, winnings, withdrawals, and adjustments', () => {
    const group = (id) => LEDGER_FILTERS.find((f) => f.id === id)
    expect(ledgerFilterMatch(group('deposits'), 'deposit')).toBe(true)
    expect(ledgerFilterMatch(group('deposits'), 'openingBalance')).toBe(true)
    expect(ledgerFilterMatch(group('deposits'), 'spend')).toBe(false)

    expect(ledgerFilterMatch(group('buyins'), 'spend')).toBe(true)
    expect(ledgerFilterMatch(group('buyins'), 'ticketUse')).toBe(true)

    expect(ledgerFilterMatch(group('winnings'), 'winCredit')).toBe(true)
    expect(ledgerFilterMatch(group('winnings'), 'deposit')).toBe(false)

    expect(ledgerFilterMatch(group('withdrawals'), 'withdrawalRequest')).toBe(true)
    expect(ledgerFilterMatch(group('withdrawals'), 'withdrawalComplete')).toBe(true)
    expect(ledgerFilterMatch(group('withdrawals'), 'withdrawalCancel')).toBe(true)

    expect(ledgerFilterMatch(group('adjustments'), 'adjustment')).toBe(true)
    expect(ledgerFilterMatch(group('adjustments'), 'managerCredit')).toBe(true)
    expect(ledgerFilterMatch(group('adjustments'), 'managerDebit')).toBe(true)
  })
})

describe('buildLedger', () => {
  it('returns [] for no transactions', () => {
    expect(buildLedger([], 0)).toEqual([])
  })

  it('orders newest-first and anchors the latest running balance to the cached balance', () => {
    // Out-of-order input; timestamps decide order.
    const txs = [
      tx({ type: 'deposit', amount: 10000, method: 'cash' }, 1000), // +100.00
      tx({ type: 'winCredit', amount: 20000 }, 4000), // +200.00
      tx({ type: 'spend', amount: 8000, method: 'wallet' }, 2000), // -80.00
      tx({ type: 'ticketUse', amount: 5000, method: 'ticket', relatedDocId: 'tk-1' }, 3000), // 0
    ]
    // 100 - 80 + 0 + 200 = 220.00 → 22000 cents
    const rows = buildLedger(txs, 22000)

    expect(rows.map((r) => r.tx.type)).toEqual(['winCredit', 'ticketUse', 'spend', 'deposit'])
    // Newest row reconciles to the header balance exactly.
    expect(rows[0].balanceAfter).toBe(22000)
    // Running balance unwinds correctly through the neutral ticketUse row.
    expect(rows.map((r) => r.balanceAfter)).toEqual([22000, 2000, 2000, 10000])
    expect(rows.map((r) => r.delta)).toEqual([20000, 0, -8000, 10000])
  })

  it('handles adjustment direction, manager debit, and a non-wallet (cash) buy-in', () => {
    const txs = [
      tx({ type: 'openingBalance', amount: 5000, method: null, reference: 'opening_balance' }, 1000), // +50
      tx({ type: 'spend', amount: 8000, method: 'cash' }, 2000), // 0 (external, not from wallet)
      tx({ type: 'adjustment', amount: 1000, direction: 'credit' }, 3000), // +10
      tx({ type: 'adjustment', amount: 500, direction: 'debit' }, 4000), // -5
      tx({ type: 'managerDebit', amount: 2000, method: null, notes: 'recoup' }, 5000), // -20
    ]
    // 50 + 0 + 10 - 5 - 20 = 35.00
    const rows = buildLedger(txs, 3500)

    expect(rows[0].balanceAfter).toBe(3500) // managerDebit, newest
    expect(rows.map((r) => r.delta)).toEqual([-2000, -500, 1000, 0, 5000])
    // Oldest → newest balances: 50, 50, 60, 55, 35
    expect(rows.map((r) => r.balanceAfter)).toEqual([3500, 5500, 6000, 5000, 5000])
  })

  it('pushes any ledger drift into the implied opening balance, keeping the newest row on the cached value', () => {
    const txs = [tx({ type: 'deposit', amount: 10000, method: 'cash' }, 1000)]
    // Cached balance disagrees with the single +100 deposit (drift of +50).
    const rows = buildLedger(txs, 15000)
    expect(rows[0].balanceAfter).toBe(15000) // still pinned to the header
  })
})

describe('summarizeLedger', () => {
  it('splits lifetime money-in from money-out, ignoring neutral rows', () => {
    const txs = [
      tx({ type: 'deposit', amount: 10000, method: 'cash' }, 1), // +100 in
      tx({ type: 'winCredit', amount: 20000 }, 2), // +200 in
      tx({ type: 'spend', amount: 8000, method: 'wallet' }, 3), // -80 out
      tx({ type: 'spend', amount: 5000, method: 'cash' }, 4), // 0 neutral
      tx({ type: 'managerDebit', amount: 2000, method: null, notes: 'x' }, 5), // -20 out
    ]
    expect(summarizeLedger(txs)).toEqual({ moneyIn: 30000, moneyOut: 10000 })
  })
})
