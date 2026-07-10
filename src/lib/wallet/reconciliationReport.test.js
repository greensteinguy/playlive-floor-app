// Unit tests for the pure end-of-day reconciliation categorizer (task 4.9).
//
// Every type × method combination lands in exactly the bucket the cashier
// reconciles it from. Sign decisions come from walletTxDelta (SSOT), so the
// adjustment split is tested against the delta sign, not the direction field
// in isolation.

import { describe, it, expect } from 'vitest'
import {
  buildReconciliationReport,
  summaryCsvRows,
  reconDateRange,
  RECON_DATE_PRESETS,
  EXTERNAL_METHODS,
} from './reconciliationReport'

// Minimal walletTransaction-shaped fixtures — the categorizer only reads
// type / amount / method / direction (same lean style as walletLedger.test.js).
let seq = 0
function tx(partial) {
  seq += 1
  return {
    id: `tx-${seq}`,
    playerId: 'player-1',
    type: 'deposit',
    amount: 0,
    method: null,
    direction: null,
    ...partial,
  }
}

describe('buildReconciliationReport', () => {
  it('returns all-zero buckets for an empty window', () => {
    const r = buildReconciliationReport([])
    expect(r.transactionCount).toBe(0)
    expect(r.externalTotals).toEqual({ cash: 0, eftpos: 0, payid: 0 })
    expect(r.moneyIn.total).toBe(0)
    expect(r.moneyIn.deposits.cash).toEqual({ count: 0, total: 0 })
    expect(r.moneyIn.buyIns.eftpos).toEqual({ count: 0, total: 0 })
    expect(r.walletActivity.netWalletChange).toBe(0)
    expect(r.moneyOut.total).toBe(0)
  })

  // ── Money IN by external method ────────────────────────────────────────────

  it('splits deposits by external method with counts', () => {
    const r = buildReconciliationReport([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({ type: 'deposit', amount: 50_00, method: 'cash' }),
      tx({ type: 'deposit', amount: 200_00, method: 'eftpos' }),
      tx({ type: 'deposit', amount: 75_00, method: 'payid' }),
    ])
    expect(r.moneyIn.deposits.cash).toEqual({ count: 2, total: 150_00 })
    expect(r.moneyIn.deposits.eftpos).toEqual({ count: 1, total: 200_00 })
    expect(r.moneyIn.deposits.payid).toEqual({ count: 1, total: 75_00 })
  })

  it('counts cash/EFTPOS buy-ins as external money in', () => {
    const r = buildReconciliationReport([
      tx({ type: 'spend', amount: 30_00, method: 'cash' }),
      tx({ type: 'spend', amount: 30_00, method: 'cash' }),
      tx({ type: 'spend', amount: 60_00, method: 'eftpos' }),
    ])
    expect(r.moneyIn.buyIns.cash).toEqual({ count: 2, total: 60_00 })
    expect(r.moneyIn.buyIns.eftpos).toEqual({ count: 1, total: 60_00 })
    // External buy-ins never touch the wallet balance.
    expect(r.walletActivity.netWalletChange).toBe(0)
  })

  it('does NOT count wallet- or ticket-paid buy-ins as external money in', () => {
    const r = buildReconciliationReport([
      tx({ type: 'spend', amount: 40_00, method: 'wallet' }),
      tx({ type: 'ticketUse', amount: 50_00, method: 'ticket', relatedDocId: 'ticket-1' }),
    ])
    expect(r.externalTotals).toEqual({ cash: 0, eftpos: 0, payid: 0 })
    expect(r.moneyIn.total).toBe(0)
    expect(r.walletActivity.walletBuyIns).toEqual({ count: 1, total: 40_00 })
    expect(r.walletActivity.ticketBuyIns).toEqual({ count: 1, total: 50_00 })
  })

  // ── Wallet activity ──────────────────────────────────────────────────────────

  it('buckets each wallet-activity type with count + total', () => {
    const r = buildReconciliationReport([
      tx({ type: 'spend', amount: 40_00, method: 'wallet' }),
      tx({ type: 'winCredit', amount: 500_00 }),
      tx({ type: 'winCredit', amount: 250_00 }),
      tx({ type: 'withdrawalComplete', amount: 100_00 }),
      tx({ type: 'managerCredit', amount: 25_00 }),
      tx({ type: 'managerDebit', amount: 15_00 }),
    ])
    expect(r.walletActivity.walletBuyIns).toEqual({ count: 1, total: 40_00 })
    expect(r.walletActivity.winCredits).toEqual({ count: 2, total: 750_00 })
    expect(r.walletActivity.withdrawalsCompleted).toEqual({ count: 1, total: 100_00 })
    expect(r.walletActivity.managerCredits).toEqual({ count: 1, total: 25_00 })
    expect(r.walletActivity.managerDebits).toEqual({ count: 1, total: 15_00 })
    // Net via walletTxDelta: -40 + 750 - 100 + 25 - 15 = +620
    expect(r.walletActivity.netWalletChange).toBe(620_00)
  })

  it('splits adjustments credit vs debit by the walletTxDelta sign', () => {
    const r = buildReconciliationReport([
      tx({ type: 'adjustment', amount: 10_00, direction: 'credit' }),
      tx({ type: 'adjustment', amount: 5_00, direction: 'debit' }),
      // Regression guard (same class of bug as the old notes-parser): a debit
      // whose free text mentions "credit" must still land in the debit bucket.
      tx({
        type: 'adjustment',
        amount: 30_00,
        direction: 'debit',
        notes: 'adjustment: debit — over-credited yesterday',
      }),
    ])
    expect(r.walletActivity.adjustmentsCredit).toEqual({ count: 1, total: 10_00 })
    expect(r.walletActivity.adjustmentsDebit).toEqual({ count: 2, total: 35_00 })
    expect(r.walletActivity.netWalletChange).toBe(10_00 - 35_00)
  })

  // ── Money OUT ────────────────────────────────────────────────────────────────

  it('reports completed withdrawals as money out (and as wallet activity)', () => {
    const r = buildReconciliationReport([
      tx({ type: 'withdrawalComplete', amount: 100_00 }),
      tx({ type: 'withdrawalComplete', amount: 60_00 }),
    ])
    expect(r.moneyOut.withdrawalsCompleted).toEqual({ count: 2, total: 160_00 })
    expect(r.moneyOut.total).toBe(160_00)
    expect(r.walletActivity.withdrawalsCompleted).toEqual({ count: 2, total: 160_00 })
    // Withdrawals must not reduce the per-method external IN totals.
    expect(r.externalTotals).toEqual({ cash: 0, eftpos: 0, payid: 0 })
  })

  it('parks requests/cancels/opening balances outside the money buckets', () => {
    const r = buildReconciliationReport([
      tx({ type: 'withdrawalRequest', amount: 100_00 }),
      tx({ type: 'withdrawalCancel', amount: 100_00 }),
      tx({ type: 'openingBalance', amount: 1_000_00 }),
    ])
    expect(r.other.withdrawalRequests).toEqual({ count: 1, total: 100_00 })
    expect(r.other.withdrawalCancels).toEqual({ count: 1, total: 100_00 })
    expect(r.other.openingBalances).toEqual({ count: 1, total: 1_000_00 })
    expect(r.moneyIn.total).toBe(0)
    expect(r.moneyOut.total).toBe(0)
    // openingBalance credits the wallet (walletTxDelta), requests/cancels don't.
    expect(r.walletActivity.netWalletChange).toBe(1_000_00)
  })

  // ── Headline external totals ─────────────────────────────────────────────────

  it('externalTotals = deposits + external buy-ins per method (the till/settlement line)', () => {
    const r = buildReconciliationReport([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({ type: 'spend', amount: 30_00, method: 'cash' }),
      tx({ type: 'deposit', amount: 200_00, method: 'eftpos' }),
      tx({ type: 'spend', amount: 70_00, method: 'eftpos' }),
      tx({ type: 'deposit', amount: 50_00, method: 'payid' }),
      // None of these may leak into the external line:
      tx({ type: 'spend', amount: 40_00, method: 'wallet' }),
      tx({ type: 'ticketUse', amount: 50_00, method: 'ticket', relatedDocId: 't' }),
      tx({ type: 'winCredit', amount: 500_00 }),
      tx({ type: 'withdrawalComplete', amount: 100_00 }),
    ])
    expect(r.externalTotals).toEqual({ cash: 130_00, eftpos: 270_00, payid: 50_00 })
    expect(r.moneyIn.total).toBe(450_00)
    expect(r.transactionCount).toBe(9)
  })

  it('covers every type × method combination in one mixed day', () => {
    const r = buildReconciliationReport([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({ type: 'deposit', amount: 200_00, method: 'eftpos' }),
      tx({ type: 'deposit', amount: 50_00, method: 'payid' }),
      tx({ type: 'spend', amount: 30_00, method: 'cash' }),
      tx({ type: 'spend', amount: 70_00, method: 'eftpos' }),
      tx({ type: 'spend', amount: 40_00, method: 'wallet' }),
      tx({ type: 'ticketUse', amount: 50_00, method: 'ticket', relatedDocId: 't' }),
      tx({ type: 'winCredit', amount: 500_00 }),
      tx({ type: 'withdrawalComplete', amount: 100_00 }),
      tx({ type: 'adjustment', amount: 10_00, direction: 'credit' }),
      tx({ type: 'adjustment', amount: 5_00, direction: 'debit' }),
      tx({ type: 'managerCredit', amount: 25_00 }),
      tx({ type: 'managerDebit', amount: 15_00 }),
      tx({ type: 'openingBalance', amount: 1_000_00 }),
      tx({ type: 'withdrawalRequest', amount: 100_00 }),
      tx({ type: 'withdrawalCancel', amount: 100_00 }),
    ])
    expect(r.transactionCount).toBe(16)
    expect(r.externalTotals).toEqual({ cash: 130_00, eftpos: 270_00, payid: 50_00 })
    expect(r.moneyOut.total).toBe(100_00)
    // Net wallet: +350 deposits… no — deposits credit the wallet:
    // +100+200+50 (deposits) -40 (wallet spend) +500 (win) -100 (withdrawal)
    // +10 -5 (adjustments) +25 -15 (manager) +1000 (opening) = +1725
    expect(r.walletActivity.netWalletChange).toBe(1_725_00)
  })

  it('throws loudly on an unknown transaction type instead of dropping money', () => {
    expect(() =>
      buildReconciliationReport([tx({ type: 'mysteryType', amount: 10_00 })])
    ).toThrow(/unknown type/)
  })

  it('EXTERNAL_METHODS lists the three reconcilable channels in order', () => {
    expect(EXTERNAL_METHODS).toEqual(['cash', 'eftpos', 'payid'])
  })
})

// ── Date-range presets (venue-local day boundaries) ──────────────────────────

describe('reconDateRange', () => {
  // A fixed "now" late in the local evening, so UTC-vs-local mistakes would
  // shift the derived day (Melbourne is UTC+10/+11).
  const now = new Date(2026, 6, 9, 22, 30, 45) // 9 Jul 2026, 22:30:45 local

  it('has presets matching the exported list', () => {
    const ids = RECON_DATE_PRESETS.map((p) => p.id)
    expect(ids).toEqual(['today', 'yesterday', '7d', '30d', 'custom'])
  })

  it("'today' spans local midnight to 23:59:59.999 of the same local day", () => {
    const { since, until } = reconDateRange('today', { now })
    expect(since).toEqual(new Date(2026, 6, 9, 0, 0, 0, 0))
    expect(until).toEqual(new Date(2026, 6, 9, 23, 59, 59, 999))
  })

  it("'yesterday' spans exactly the previous local day", () => {
    const { since, until } = reconDateRange('yesterday', { now })
    expect(since).toEqual(new Date(2026, 6, 8, 0, 0, 0, 0))
    expect(until).toEqual(new Date(2026, 6, 8, 23, 59, 59, 999))
  })

  it("'yesterday' crosses a month boundary correctly", () => {
    const firstOfMonth = new Date(2026, 6, 1, 3, 0, 0)
    const { since, until } = reconDateRange('yesterday', { now: firstOfMonth })
    expect(since).toEqual(new Date(2026, 5, 30, 0, 0, 0, 0))
    expect(until).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999))
  })

  it("'7d' covers the 7 local days ending today", () => {
    const { since, until } = reconDateRange('7d', { now })
    expect(since).toEqual(new Date(2026, 6, 3, 0, 0, 0, 0))
    expect(until).toEqual(new Date(2026, 6, 9, 23, 59, 59, 999))
  })

  it("'30d' covers the 30 local days ending today", () => {
    const { since, until } = reconDateRange('30d', { now })
    expect(since).toEqual(new Date(2026, 5, 10, 0, 0, 0, 0))
    expect(until).toEqual(new Date(2026, 6, 9, 23, 59, 59, 999))
  })

  it("'custom' parses YYYY-MM-DD as local day boundaries (audit-log convention)", () => {
    const { since, until } = reconDateRange('custom', {
      customFrom: '2026-07-01',
      customTo: '2026-07-05',
      now,
    })
    expect(since).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0))
    expect(until).toEqual(new Date(2026, 6, 5, 23, 59, 59, 999))
  })

  it("'custom' leaves a missing end open", () => {
    expect(reconDateRange('custom', { customFrom: '2026-07-01', now }).until).toBeUndefined()
    expect(reconDateRange('custom', { customTo: '2026-07-05', now }).since).toBeUndefined()
  })

  it('returns an open range for an unknown preset id', () => {
    expect(reconDateRange('nope', { now })).toEqual({ since: undefined, until: undefined })
  })
})

// ── Summary CSV rows ──────────────────────────────────────────────────────────

describe('summaryCsvRows', () => {
  it('flattens the report into section/line/count/amount rows in dollars', () => {
    const report = buildReconciliationReport([
      tx({ type: 'deposit', amount: 100_00, method: 'cash' }),
      tx({ type: 'deposit', amount: 25_50, method: 'cash' }),
      tx({ type: 'spend', amount: 30_00, method: 'eftpos' }),
      tx({ type: 'withdrawalComplete', amount: 60_00 }),
    ])
    const rows = summaryCsvRows(report)

    const cashDeposits = rows.find((r) => r.line === 'Deposits — cash')
    expect(cashDeposits).toEqual({
      section: 'Money in',
      line: 'Deposits — cash',
      count: 2,
      amount: '125.50',
    })

    const eftposBuyIns = rows.find((r) => r.line === 'Buy-ins — EFTPOS')
    expect(eftposBuyIns.amount).toBe('30.00')

    const withdrawals = rows.find((r) => r.section === 'Money out')
    expect(withdrawals).toEqual({
      section: 'Money out',
      line: 'Withdrawals paid',
      count: 1,
      amount: '60.00',
    })

    const externalCash = rows.find((r) => r.section === 'External totals' && r.line === 'Cash')
    expect(externalCash.amount).toBe('125.50')
    const externalEftpos = rows.find((r) => r.section === 'External totals' && r.line === 'EFTPOS')
    expect(externalEftpos.amount).toBe('30.00')
    const externalPayid = rows.find((r) => r.section === 'External totals' && r.line === 'PayID')
    expect(externalPayid.amount).toBe('0.00')
  })

  it('formats a negative net wallet change with a minus sign', () => {
    const report = buildReconciliationReport([
      tx({ type: 'spend', amount: 40_00, method: 'wallet' }),
    ])
    const net = summaryCsvRows(report).find((r) => r.line === 'Net wallet change')
    expect(net.amount).toBe('-40.00')
    expect(net.count).toBe('')
  })
})
