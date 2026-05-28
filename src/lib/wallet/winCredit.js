// Crediting tournament winnings to a player's wallet.
//
// Per wallet-design.md Q4: NO auto-credit. The cashier confirms each winCredit
// before it lands on the player's wallet. The UI for the confirmation flow lives
// in Phase 4 task 4.7; this module is the underlying write.

import {
  runValidatedTransaction,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Player, WalletTransaction, BountyDraw } from '../schema'
import { now, wrapWalletErrors } from './_shared'

/**
 * Credit cash winnings to a player's wallet. Use for normal payouts (1st, 2nd,
 * etc.) and for satellite tickets that have been converted to cash.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount         integer cents, > 0
 * @param {string|null} args.relatedDocId  typically the entries/{id} this is paying out
 * @param {string} args.actorId        the cashier confirming the credit
 * @param {'manager'|'td'|'cashier'} args.actorRole
 * @param {string|null} [args.notes]
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number }>}
 */
export async function confirmWinCredit({
  playerId,
  amount,
  relatedDocId = null,
  actorId,
  actorRole,
  notes = null,
}) {
  return wrapWalletErrors('confirmWinCredit', async () => {
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(playerId), Player)

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'winCredit',
        amount,
        method: null,
        reference: null,
        relatedDocId,
        actorId,
        actorRole,
        timestamp,
        notes,
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: player.walletBalance + amount,
        updatedAt: timestamp,
      })

      return { walletTransactionId, newBalance: player.walletBalance + amount }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.winCredit',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: { walletTransactionId, amount, relatedDocId },
    })

    return result
  })
}

/**
 * Credit a Mystery Bounty win to the knocker's wallet. Also links the
 * bountyDraws doc to the winCredit walletTransactions row (so the bounty
 * payment can be traced both ways).
 *
 * @param {object} args
 * @param {string} args.tournamentId
 * @param {string} args.drawId
 * @param {string} args.playerId       the knocker (winning player)
 * @param {number} args.amount         the bounty value, integer cents
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number }>}
 */
export async function confirmBountyWinCredit({
  tournamentId,
  drawId,
  playerId,
  amount,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('confirmBountyWinCredit', async () => {
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const draw = await tx.get(paths.bountyDrawPath(tournamentId, drawId), BountyDraw)
      if (draw.walletTransactionId !== null) {
        throw new Error(
          `BountyDraw ${drawId} is already confirmed (walletTransactionId is set). ` +
          `Cannot confirm twice.`
        )
      }

      const player = await tx.get(paths.playerPath(playerId), Player)

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'winCredit',
        amount,
        method: null,
        reference: null,
        relatedDocId: drawId,
        actorId,
        actorRole,
        timestamp,
        notes: 'bounty draw',
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: player.walletBalance + amount,
        updatedAt: timestamp,
      })

      tx.update(paths.bountyDrawPath(tournamentId, drawId), {
        walletTransactionId,
      })

      return { walletTransactionId, newBalance: player.walletBalance + amount }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.winCredit',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: { walletTransactionId, amount, drawId, tournamentId, source: 'bounty' },
    })

    return result
  })
}
