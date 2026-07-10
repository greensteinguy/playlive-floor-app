// Pure categorization for the end-of-day reconciliation view (Phase 4 task 4.9).
//
// Turns a window of raw walletTransaction rows into the buckets staff
// physically reconcile at close:
//
//   - Money IN by external method — deposits (cash / EFTPOS / PayID) plus
//     buy-ins paid directly by cash / EFTPOS. Wallet- and ticket-paid buy-ins
//     are NOT external money in (the money entered the till on an earlier day,
//     as a deposit or a ticket grant), so they land in walletActivity instead.
//   - Wallet activity — everything that moved the app-side wallet ledger:
//     wallet-paid buy-ins, win credits, completed withdrawals, manager
//     credits/debits, adjustments (credit vs debit). Ticket-paid buy-ins are
//     included as an informational line (they touch no total).
//   - Money OUT — completed withdrawals: the side the till / banking app pays.
//   - externalTotals — the headline: total external money taken per method,
//     which the cashier holds against the till count, the EFTPOS settlement,
//     and the bank statement (PayID).
//
// Sign/direction decisions are NOT re-derived here: every per-row wallet
// effect comes from `walletTxDelta` (src/lib/wallet/_shared.js) — the same
// single source of truth the per-player ledger and balance verification use.
// Adjustments are split credit-vs-debit by the SIGN of that delta, never by
// re-reading `direction` or parsing notes.
//
// Pure module: no Firestore reads, no React. Unit-tested directly.

import { walletTxDelta } from './_shared'

/** { count, total } accumulator. Totals are integer cents, always >= 0. */
function bucket() {
  return { count: 0, total: 0 }
}

function add(b, amount) {
  b.count += 1
  b.total += amount
}

/**
 * External payment methods, in the order the cashier reconciles them
 * (till count, EFTPOS settlement, bank statement).
 */
export const EXTERNAL_METHODS = ['cash', 'eftpos', 'payid']

/**
 * Build the reconciliation report for a set of walletTransaction rows
 * (already filtered to the date window by the caller's query).
 *
 * @param {Array<object>} transactions raw walletTransaction docs
 * @returns {{
 *   externalTotals: { cash: number, eftpos: number, payid: number },
 *   moneyIn: {
 *     deposits: { cash: Bucket, eftpos: Bucket, payid: Bucket },
 *     buyIns:   { cash: Bucket, eftpos: Bucket },
 *     total: number,
 *   },
 *   walletActivity: {
 *     walletBuyIns: Bucket,
 *     ticketBuyIns: Bucket,             // informational — no wallet/external effect
 *     winCredits: Bucket,
 *     withdrawalsCompleted: Bucket,
 *     managerCredits: Bucket,
 *     managerDebits: Bucket,
 *     adjustmentsCredit: Bucket,
 *     adjustmentsDebit: Bucket,
 *     netWalletChange: number,          // signed cents, via walletTxDelta (SSOT)
 *   },
 *   moneyOut: { withdrawalsCompleted: Bucket, total: number },
 *   other: {
 *     openingBalances: Bucket,
 *     withdrawalRequests: Bucket,
 *     withdrawalCancels: Bucket,
 *   },
 *   transactionCount: number,
 * }}
 *   where Bucket = { count: number, total: number } (total in positive cents).
 */
export function buildReconciliationReport(transactions) {
  const report = {
    externalTotals: { cash: 0, eftpos: 0, payid: 0 },
    moneyIn: {
      deposits: { cash: bucket(), eftpos: bucket(), payid: bucket() },
      buyIns: { cash: bucket(), eftpos: bucket() },
      total: 0,
    },
    walletActivity: {
      walletBuyIns: bucket(),
      ticketBuyIns: bucket(),
      winCredits: bucket(),
      withdrawalsCompleted: bucket(),
      managerCredits: bucket(),
      managerDebits: bucket(),
      adjustmentsCredit: bucket(),
      adjustmentsDebit: bucket(),
      netWalletChange: 0,
    },
    moneyOut: { withdrawalsCompleted: bucket(), total: 0 },
    other: {
      openingBalances: bucket(),
      withdrawalRequests: bucket(),
      withdrawalCancels: bucket(),
    },
    transactionCount: transactions.length,
  }

  for (const tx of transactions) {
    // SSOT for the row's wallet effect — throws loudly on an unknown type,
    // which is what we want: silently dropping money from a reconciliation
    // report is worse than an error the cashier can escalate.
    const delta = walletTxDelta(tx)
    report.walletActivity.netWalletChange += delta

    switch (tx.type) {
      case 'deposit':
        // Schema guarantees deposit method is one of the enum values; only the
        // external three make sense for a deposit (guard mirrors reconciliation.js).
        if (report.moneyIn.deposits[tx.method] !== undefined) {
          add(report.moneyIn.deposits[tx.method], tx.amount)
        }
        break
      case 'spend':
        if (tx.method === 'wallet') {
          add(report.walletActivity.walletBuyIns, tx.amount)
        } else if (report.moneyIn.buyIns[tx.method] !== undefined) {
          // cash / eftpos — external money handed over at the desk
          add(report.moneyIn.buyIns[tx.method], tx.amount)
        }
        break
      case 'ticketUse':
        add(report.walletActivity.ticketBuyIns, tx.amount)
        break
      case 'winCredit':
        add(report.walletActivity.winCredits, tx.amount)
        break
      case 'withdrawalComplete':
        // Both a wallet event (balance debited) and the money-out side the
        // till / banking app physically paid.
        add(report.walletActivity.withdrawalsCompleted, tx.amount)
        add(report.moneyOut.withdrawalsCompleted, tx.amount)
        break
      case 'managerCredit':
        add(report.walletActivity.managerCredits, tx.amount)
        break
      case 'managerDebit':
        add(report.walletActivity.managerDebits, tx.amount)
        break
      case 'adjustment':
        // Credit vs debit decided by the SIGN of walletTxDelta — the SSOT —
        // not by re-reading direction here.
        add(
          delta > 0 ? report.walletActivity.adjustmentsCredit : report.walletActivity.adjustmentsDebit,
          tx.amount
        )
        break
      case 'openingBalance':
        add(report.other.openingBalances, tx.amount)
        break
      case 'withdrawalRequest':
        add(report.other.withdrawalRequests, tx.amount)
        break
      case 'withdrawalCancel':
        add(report.other.withdrawalCancels, tx.amount)
        break
      default:
        // Unreachable: walletTxDelta above already threw for unknown types.
        break
    }
  }

  // Headline external totals: everything that physically entered via each
  // method today. Withdrawals are money OUT and are reported separately —
  // the ledger doesn't record which channel paid them (typically bank
  // transfer via the stored BSB/account), so they can't be netted per method.
  for (const method of EXTERNAL_METHODS) {
    report.externalTotals[method] =
      report.moneyIn.deposits[method].total + (report.moneyIn.buyIns[method]?.total ?? 0)
  }
  report.moneyIn.total =
    report.externalTotals.cash + report.externalTotals.eftpos + report.externalTotals.payid
  report.moneyOut.total = report.moneyOut.withdrawalsCompleted.total

  return report
}

// ── Date-range presets ───────────────────────────────────────────────────────
//
// The venue's day is the machine's LOCAL day (Australia/Melbourne — the
// codebase treats local time as venue time, matching the audit log's
// `new Date(iso + 'T00:00:00')` custom-range boundaries). All boundaries below
// are therefore built with local-time Date APIs, never UTC.

export const RECON_DATE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom' },
]

/** Local midnight at the start of the given date's day. */
function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Last millisecond of the given date's local day. */
function endOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** The same local time `days` days before `d` (DST-safe via setDate). */
function daysBefore(d, days) {
  const out = new Date(d)
  out.setDate(out.getDate() - days)
  return out
}

/**
 * Resolve a preset id (+ custom YYYY-MM-DD inputs) to a { since, until } pair
 * of Dates, both inclusive, aligned to LOCAL day boundaries.
 *
 * "Last 7 days" = the 7 local days ending today (today plus the 6 before it);
 * likewise "Last 30 days". A custom range missing either end leaves that end
 * undefined (open-ended), matching the audit log.
 *
 * @param {string} presetId one of RECON_DATE_PRESETS ids
 * @param {{ customFrom?: string, customTo?: string, now?: Date }} [opts]
 * @returns {{ since: Date|undefined, until: Date|undefined }}
 */
export function reconDateRange(presetId, { customFrom = '', customTo = '', now = new Date() } = {}) {
  switch (presetId) {
    case 'today':
      return { since: startOfLocalDay(now), until: endOfLocalDay(now) }
    case 'yesterday': {
      const y = daysBefore(now, 1)
      return { since: startOfLocalDay(y), until: endOfLocalDay(y) }
    }
    case '7d':
      return { since: startOfLocalDay(daysBefore(now, 6)), until: endOfLocalDay(now) }
    case '30d':
      return { since: startOfLocalDay(daysBefore(now, 29)), until: endOfLocalDay(now) }
    case 'custom':
      return {
        // Local-time parse, same convention as the audit log's custom range.
        since: customFrom ? new Date(customFrom + 'T00:00:00') : undefined,
        until: customTo ? new Date(customTo + 'T23:59:59.999') : undefined,
      }
    default:
      return { since: undefined, until: undefined }
  }
}

// ── CSV summary rows ─────────────────────────────────────────────────────────

/** Cents → plain dollars string for CSV cells (no "$" so spreadsheets can sum). */
function csvDollars(cents) {
  return (cents / 100).toFixed(2)
}

/**
 * Flatten a report into rows for the summary CSV export. Columns:
 * section / line / count / amount (dollars). Pure, so the export content is
 * unit-testable without a DOM.
 *
 * @param {ReturnType<typeof buildReconciliationReport>} report
 * @returns {Array<{ section: string, line: string, count: number|string, amount: string }>}
 */
export function summaryCsvRows(report) {
  const rows = []
  const push = (section, line, b) => rows.push({ section, line, count: b.count, amount: csvDollars(b.total) })

  push('Money in', 'Deposits — cash', report.moneyIn.deposits.cash)
  push('Money in', 'Deposits — EFTPOS', report.moneyIn.deposits.eftpos)
  push('Money in', 'Deposits — PayID', report.moneyIn.deposits.payid)
  push('Money in', 'Buy-ins — cash', report.moneyIn.buyIns.cash)
  push('Money in', 'Buy-ins — EFTPOS', report.moneyIn.buyIns.eftpos)

  push('Wallet activity', 'Wallet-paid buy-ins', report.walletActivity.walletBuyIns)
  push('Wallet activity', 'Ticket-paid buy-ins', report.walletActivity.ticketBuyIns)
  push('Wallet activity', 'Win credits', report.walletActivity.winCredits)
  push('Wallet activity', 'Withdrawals completed', report.walletActivity.withdrawalsCompleted)
  push('Wallet activity', 'Manager credits', report.walletActivity.managerCredits)
  push('Wallet activity', 'Manager debits', report.walletActivity.managerDebits)
  push('Wallet activity', 'Adjustments — credit', report.walletActivity.adjustmentsCredit)
  push('Wallet activity', 'Adjustments — debit', report.walletActivity.adjustmentsDebit)
  rows.push({
    section: 'Wallet activity',
    line: 'Net wallet change',
    count: '',
    amount: csvDollars(report.walletActivity.netWalletChange),
  })

  push('Money out', 'Withdrawals paid', report.moneyOut.withdrawalsCompleted)

  rows.push({ section: 'External totals', line: 'Cash', count: '', amount: csvDollars(report.externalTotals.cash) })
  rows.push({ section: 'External totals', line: 'EFTPOS', count: '', amount: csvDollars(report.externalTotals.eftpos) })
  rows.push({ section: 'External totals', line: 'PayID', count: '', amount: csvDollars(report.externalTotals.payid) })

  return rows
}
