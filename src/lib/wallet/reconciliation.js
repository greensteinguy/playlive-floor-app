// Wallet reconciliation helpers — used by:
//   - end-of-day cashier reconciliation view
//   - the "rebuild balance from ledger" sanity check
//   - the operator-facing report on total wallet liability

import { walletTransactions, players } from '../firestore'
import { walletTxDelta } from './_shared'
import { buildReconciliationReport } from './reconciliationReport'

/**
 * Aggregate walletTransactions across all players for a time window. Returns
 * a per-method / per-type breakdown suitable for the end-of-day reconciliation
 * UI (Phase 4 task 4.9).
 *
 * Compares to: bank statement (PayID + bank transfers), EFTPOS settlement
 * (eftpos), and physical till count (cash).
 *
 * @param {object} args
 * @param {Date|import('firebase/firestore').Timestamp} args.since
 * @param {Date|import('firebase/firestore').Timestamp} args.until
 *
 * @returns {Promise<{
 *   totals: {
 *     deposits:  { cash: number, eftpos: number, payid: number },
 *     spendsExternal: { cash: number, eftpos: number },
 *     spendsFromWallet: number,
 *     ticketUses: number,
 *     winCredits: number,
 *     withdrawalsCompleted: number,
 *     adjustments: { credit: number, debit: number },  // bookkeeping corrections
 *     managerCredits: number,                          // intentional manager-authorized credits
 *     managerDebits: number                            // intentional manager-authorized debits
 *   },
 *   transactionCount: number,
 *   periodNote: string
 * }>}
 */
export async function getReconciliationTotals({ since, until }) {
  const txs = await walletTransactions.listAllWalletTransactions({ since, until })

  // Categorization lives in the pure module (reconciliationReport.js) — one
  // categorizer shared with the reconciliation page. This function keeps its
  // original flat shape for existing callers.
  const report = buildReconciliationReport(txs)

  const totals = {
    deposits: {
      cash: report.moneyIn.deposits.cash.total,
      eftpos: report.moneyIn.deposits.eftpos.total,
      payid: report.moneyIn.deposits.payid.total,
    },
    spendsExternal: {
      cash: report.moneyIn.buyIns.cash.total,
      eftpos: report.moneyIn.buyIns.eftpos.total,
    },
    spendsFromWallet: report.walletActivity.walletBuyIns.total,
    ticketUses: report.walletActivity.ticketBuyIns.total,
    winCredits: report.walletActivity.winCredits.total,
    withdrawalsCompleted: report.walletActivity.withdrawalsCompleted.total,
    adjustments: {
      credit: report.walletActivity.adjustmentsCredit.total,   // bookkeeping corrections (writeAdjustment)
      debit: report.walletActivity.adjustmentsDebit.total,
    },
    managerCredits: report.walletActivity.managerCredits.total, // intentional manager-authorized credits
    managerDebits: report.walletActivity.managerDebits.total,   // intentional manager-authorized debits
  }

  return {
    totals,
    transactionCount: report.transactionCount,
    periodNote: `from ${since} to ${until}`,
  }
}

/**
 * Rebuild a player's walletBalance from the ground up by summing their ledger.
 * Reports any drift from the cached `players/{pid}.walletBalance` so the
 * operator can investigate.
 *
 * Use this:
 *   - As a routine sanity check (e.g., once a week per active player)
 *   - When investigating a complaint ("my balance is wrong")
 *   - As part of the migration import verification
 *
 * Does NOT auto-correct drift. Surfacing it is the wallet module's job;
 * deciding what to do about it is operational.
 *
 * @param {string} playerId
 * @returns {Promise<{
 *   cachedBalance: number,
 *   derivedBalance: number,
 *   drift: number,           // cached - derived; 0 = healthy
 *   transactionsConsidered: number
 * }>}
 */
export async function verifyBalanceMatchesLedger(playerId) {
  const [player, txs] = await Promise.all([
    players.getPlayer(playerId),
    walletTransactions.listWalletTransactions(playerId),
  ])

  let derived = 0
  for (const tx of txs) {
    derived += walletTxDelta(tx)
  }

  return {
    cachedBalance: player.walletBalance,
    derivedBalance: derived,
    drift: player.walletBalance - derived,
    transactionsConsidered: txs.length,
  }
}
