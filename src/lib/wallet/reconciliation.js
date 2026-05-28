// Wallet reconciliation helpers — used by:
//   - end-of-day cashier reconciliation view
//   - the "rebuild balance from ledger" sanity check
//   - the operator-facing report on total wallet liability

import { walletTransactions, players } from '../firestore'
import { balanceDelta } from './_shared'

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

  const totals = {
    deposits: { cash: 0, eftpos: 0, payid: 0 },
    spendsExternal: { cash: 0, eftpos: 0 },
    spendsFromWallet: 0,
    ticketUses: 0,
    winCredits: 0,
    withdrawalsCompleted: 0,
    adjustments: { credit: 0, debit: 0 },        // bookkeeping corrections (writeAdjustment)
    managerCredits: 0,                            // intentional manager-authorized credits
    managerDebits: 0,                             // intentional manager-authorized debits
  }

  for (const tx of txs) {
    switch (tx.type) {
      case 'deposit':
        if (tx.method && totals.deposits[tx.method] !== undefined) {
          totals.deposits[tx.method] += tx.amount
        }
        break
      case 'spend':
        if (tx.method === 'wallet') {
          totals.spendsFromWallet += tx.amount
        } else if (tx.method === 'cash' || tx.method === 'eftpos') {
          totals.spendsExternal[tx.method] += tx.amount
        }
        break
      case 'ticketUse':
        totals.ticketUses += tx.amount
        break
      case 'winCredit':
        totals.winCredits += tx.amount
        break
      case 'withdrawalComplete':
        totals.withdrawalsCompleted += tx.amount
        break
      case 'adjustment': {
        if (tx.direction === 'credit') totals.adjustments.credit += tx.amount
        else if (tx.direction === 'debit') totals.adjustments.debit += tx.amount
        break
      }
      case 'managerCredit':
        totals.managerCredits += tx.amount
        break
      case 'managerDebit':
        totals.managerDebits += tx.amount
        break
      // openingBalance / withdrawalRequest / withdrawalCancel — not relevant for daily recon
      default:
        break
    }
  }

  return {
    totals,
    transactionCount: txs.length,
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
    if (tx.type === 'adjustment') {
      derived += tx.direction === 'credit' ? tx.amount : -tx.amount
    } else {
      derived += balanceDelta({ type: tx.type, amount: tx.amount, method: tx.method })
    }
  }

  return {
    cachedBalance: player.walletBalance,
    derivedBalance: derived,
    drift: player.walletBalance - derived,
    transactionsConsidered: txs.length,
  }
}
