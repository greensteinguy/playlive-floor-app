// Compensating adjustment entries. The append-only ledger pattern means we
// never edit a past row — we write a new compensating row to correct mistakes.
// See docs/wallet-design.md §5.

import {
  runValidatedTransaction,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Player, WalletTransaction } from '../schema'
import { now, wrapWalletErrors } from './_shared'
import { InsufficientWalletBalanceError } from './errors'

/**
 * Write an adjustment to a player's wallet ledger. Used to correct mistakes
 * (e.g., cashier picked the wrong player on a deposit; a transaction needs to
 * be effectively undone).
 *
 * The adjustment carries a signed direction: 'credit' adds to the balance,
 * 'debit' subtracts from it. The walletTransactions row's amount is always
 * positive (per the sign convention); the direction is recorded in metadata.notes
 * AND in the audit log so reconciliation can group adjustments correctly.
 *
 * Always enforces the HARD wallet ≥ 0 invariant: a debit adjustment that
 * would push balance negative is rejected.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount               integer cents, > 0
 * @param {'credit'|'debit'} args.direction
 * @param {string} args.reason               required, non-empty — describes why
 * @param {string|null} [args.relatedDocId]  optionally points at the original transaction being corrected
 * @param {string} args.actorId
 * @param {'manager'|'cashier'} args.actorRole
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number }>}
 */
export async function writeAdjustment({
  playerId,
  amount,
  direction,
  reason,
  relatedDocId = null,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('writeAdjustment', async () => {
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)
    if (direction !== 'credit' && direction !== 'debit') {
      throw new Error(`direction must be 'credit' or 'debit' (got "${direction}")`)
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('reason is required (non-empty string)')
    }

    const walletTransactionId = generateId()
    const timestamp = now()
    const delta = direction === 'credit' ? amount : -amount

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(playerId), Player)
      const newBalance = player.walletBalance + delta
      if (newBalance < 0) {
        throw new InsufficientWalletBalanceError({
          playerId,
          currentBalance: player.walletBalance,
          requestedAmount: amount,
        })
      }

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'adjustment',
        amount, // always positive — direction is metadata
        method: null,
        reference: null,
        relatedDocId,
        actorId,
        actorRole,
        timestamp,
        notes: `adjustment: ${direction} — ${reason}`,
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: newBalance,
        updatedAt: timestamp,
      })

      return { walletTransactionId, newBalance }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.adjustment',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: {
        walletTransactionId,
        amount,
        direction,
        reason,
        relatedDocId,
      },
    })

    return result
  })
}
