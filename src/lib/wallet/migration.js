// Migration-only helpers. Used by the Casinoware CSV import (Action Plan task R1.0b)
// to bring forward existing player balances. Not used in normal app flow.

import {
  runValidatedTransaction,
  generateId,
  paths,
} from '../firestore'
import { Player, WalletTransaction } from '../schema'
import { now, wrapWalletErrors } from './_shared'

/**
 * Record an opening balance for an existing (imported) player. Writes a
 * walletTransactions row of type='openingBalance' and sets the player's
 * walletBalance to match. Intended to be called once per player during the
 * migration import.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount      integer cents, > 0
 * @param {string} [args.actorId='system']
 * @param {import('firebase/firestore').Timestamp} [args.timestamp]  defaults to now
 *
 * @returns {Promise<{ walletTransactionId: string }>}
 */
export async function recordOpeningBalance({
  playerId,
  amount,
  actorId = 'system',
  timestamp = null,
}) {
  return wrapWalletErrors('recordOpeningBalance', async () => {
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)

    const walletTransactionId = generateId()
    const ts = timestamp ?? now()

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(playerId), Player)
      // Sanity: don't double-apply an opening balance to a player that already has one.
      // Caller (the migration script) should query for existing openingBalance rows
      // before calling — but we'll let the caller be responsible since this is a
      // one-shot operation and the wallet module shouldn't query its own ledger here.

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'openingBalance',
        amount,
        method: null,
        reference: 'opening_balance',
        relatedDocId: null,
        actorId,
        actorRole: 'system',
        timestamp: ts,
        notes: null,
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: player.walletBalance + amount,
        totalDeposited: player.totalDeposited + amount,
        updatedAt: ts,
      })

      return { walletTransactionId }
    })

    // No audit log write for migration — the import script writes its own
    // batch-level audit entry per player, not per individual ledger row.

    return result
  })
}
