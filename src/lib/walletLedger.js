// Pure display/derivation helpers for the per-player wallet ledger (task 3.11).
//
// The player-profile Wallet tab renders every walletTransaction row (not just
// deposits) as a running ledger. This module turns the raw rows into a
// display-ready, newest-first list with a running wallet balance, plus the
// labels and filter groups the table needs. It is pure (no Firestore, no React)
// so it can be unit-tested directly.
//
// The signed wallet effect of each row comes from `walletTxDelta` in the wallet
// module — the SAME function reconciliation uses to rebuild a balance from the
// ledger — so the ledger's running balance can never drift from the cached
// balance for any other reason than a genuine reconciliation discrepancy.

import { walletTxDelta } from './wallet'

/** Human label per walletTransaction type. */
export const LEDGER_TYPE_LABELS = {
  deposit: 'Deposit',
  spend: 'Buy-in',
  ticketUse: 'Ticket used',
  winCredit: 'Winnings',
  withdrawalRequest: 'Withdrawal requested',
  withdrawalComplete: 'Withdrawal paid',
  withdrawalCancel: 'Withdrawal cancelled',
  adjustment: 'Adjustment',
  openingBalance: 'Opening balance',
  managerCredit: 'Manager credit',
  managerDebit: 'Manager debit',
}

/** Human label per payment method. */
export const LEDGER_METHOD_LABELS = {
  cash: 'Cash',
  eftpos: 'EFTPOS',
  payid: 'PayID',
  wallet: 'From wallet',
  ticket: 'Ticket',
}

/**
 * Type label for a row. `adjustment` carries its credit/debit sense in
 * `direction` (not in `type`), so we surface that in the label.
 */
export function ledgerTypeLabel(tx) {
  const base = LEDGER_TYPE_LABELS[tx.type] ?? tx.type
  if (tx.type === 'adjustment') {
    return `${base} (${tx.direction === 'credit' ? 'credit' : 'debit'})`
  }
  return base
}

/** Method label for a row, or '—' for the types that carry no method. */
export function ledgerMethodLabel(tx) {
  if (!tx.method) return '—'
  return LEDGER_METHOD_LABELS[tx.method] ?? tx.method
}

/**
 * Display tone for a row's amount, from its signed wallet delta:
 *   'credit' — money into the wallet (+)
 *   'debit'  — money out of the wallet (−)
 *   'none'   — no wallet-balance effect (e.g. a cash buy-in, a ticket use, or a
 *              withdrawal request/cancel — money may have moved, but not through
 *              the wallet balance)
 */
export function ledgerAmountTone(delta) {
  if (delta > 0) return 'credit'
  if (delta < 0) return 'debit'
  return 'none'
}

/**
 * Filter groups for the ledger chips. `types: null` matches everything.
 * Mirrors how the floor thinks about the ledger: money in (deposits), money
 * spent on buy-ins, winnings, withdrawals, and bookkeeping adjustments.
 */
export const LEDGER_FILTERS = [
  { id: 'all', label: 'All', types: null },
  { id: 'deposits', label: 'Deposits', types: ['deposit', 'openingBalance'] },
  { id: 'buyins', label: 'Buy-ins', types: ['spend', 'ticketUse'] },
  { id: 'winnings', label: 'Winnings', types: ['winCredit'] },
  {
    id: 'withdrawals',
    label: 'Withdrawals',
    types: ['withdrawalRequest', 'withdrawalComplete', 'withdrawalCancel'],
  },
  { id: 'adjustments', label: 'Adjustments', types: ['adjustment', 'managerCredit', 'managerDebit'] },
]

/** Does a transaction type belong to the given filter group? */
export function ledgerFilterMatch(filter, type) {
  return !filter || filter.types === null || filter.types.includes(type)
}

/** Milliseconds for a Firestore Timestamp / Date / number / null. */
function ms(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts === 'number') return ts
  return 0
}

/**
 * Build the display-ready ledger: each row tagged with its signed wallet delta
 * and the running wallet balance AFTER that transaction, sorted newest-first.
 *
 * The running balance is anchored to `currentBalance` (the cached
 * players/{pid}.walletBalance) so the most recent row's `balanceAfter` equals
 * exactly the balance shown in the page header — the ledger reconciles to the
 * header by construction. Older rows are derived by unwinding the deltas. In
 * normal operation the implied opening balance is 0; any nonzero opening would
 * indicate ledger drift (which the reconciliation view, Phase 4, surfaces).
 *
 * IMPORTANT: pass the FULL transaction set here, then filter the returned rows
 * for display — so the running balance is always computed over the whole
 * history, never over a filtered subset.
 *
 * @param {Array<object>} transactions raw walletTransaction docs
 * @param {number} currentBalance cached wallet balance, in cents
 * @returns {Array<{ tx: object, delta: number, balanceAfter: number }>}
 */
export function buildLedger(transactions, currentBalance = 0) {
  const asc = [...transactions].sort((a, b) => ms(a.timestamp) - ms(b.timestamp))
  const deltas = asc.map(walletTxDelta)
  const total = deltas.reduce((sum, d) => sum + d, 0)

  // Balance just before the earliest transaction, chosen so the final running
  // balance lands exactly on currentBalance.
  let balance = currentBalance - total
  const rows = asc.map((tx, i) => {
    balance += deltas[i]
    return { tx, delta: deltas[i], balanceAfter: balance }
  })

  rows.reverse() // newest first for display
  return rows
}

/**
 * Lifetime totals over a ledger: money credited to the wallet vs debited from
 * it (both positive cents). Neutral rows (delta 0) contribute to neither.
 */
export function summarizeLedger(transactions) {
  let moneyIn = 0
  let moneyOut = 0
  for (const tx of transactions) {
    const d = walletTxDelta(tx)
    if (d > 0) moneyIn += d
    else if (d < 0) moneyOut += -d
  }
  return { moneyIn, moneyOut }
}
