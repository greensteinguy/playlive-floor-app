// Wallet deposit operation.
//
// Records that a deposit happened. The actual money has already moved (cash to
// till / EFTPOS settled / PayID received) — this is the record-keeping write.
// See SOW v0.7 §3.4 and docs/wallet-design.md.

import { runValidatedTransaction, generateId, auditLog, paths } from '../firestore'
import { Player, WalletTransaction } from '../schema'
import { now, balanceDelta, wrapWalletErrors } from './_shared'

/**
 * Record a deposit to a player's wallet.
 *
 * Idempotency: pass `walletTransactionId` generated when the confirm screen is
 * shown (one id per cashier gesture). The transaction probes that id first —
 * if the row already exists the earlier attempt actually committed (e.g. the
 * 10s write timeout fired on a slow network and the cashier retried), so the
 * call returns the existing row's result instead of double-crediting. Omitting
 * the id preserves the old behaviour (a fresh id per call, no replay window).
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount   integer cents, > 0
 * @param {'cash'|'eftpos'|'payid'} args.method
 * @param {string} args.reference  EFTPOS approval / PayID txid / "cash" / etc.
 * @param {string} args.actorId   auth uid of the cashier who entered the deposit
 * @param {'manager'|'td'|'cashier'} args.actorRole
 * @param {string|null} [args.notes]
 * @param {string|null} [args.walletTransactionId]  gesture-scoped idempotency key
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number, alreadyRecorded?: true }>}
 */
export async function recordDeposit({
  playerId,
  amount,
  method,
  reference,
  actorId,
  actorRole,
  notes = null,
  walletTransactionId: providedTransactionId = null,
}) {
  return wrapWalletErrors('recordDeposit', async () => {
    if (amount <= 0) {
      throw new Error(`amount must be > 0 (got ${amount}). Deposits are always positive.`)
    }
    if (!['cash', 'eftpos', 'payid'].includes(method)) {
      throw new Error(`method must be one of cash/eftpos/payid (got "${method}").`)
    }

    const walletTransactionId = providedTransactionId ?? generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      // Idempotency probe — a doc at this id means this exact gesture already
      // committed. Return its result; write nothing.
      const existing = await tx.getOptional(
        paths.walletTransactionPath(playerId, walletTransactionId),
        WalletTransaction
      )
      const player = await tx.get(paths.playerPath(playerId), Player)
      if (existing) {
        return { walletTransactionId, newBalance: player.walletBalance, alreadyRecorded: true }
      }
      const delta = balanceDelta({ type: 'deposit', amount })
      const newBalance = player.walletBalance + delta

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'deposit',
        amount,
        method,
        reference,
        relatedDocId: null,
        actorId,
        actorRole,
        timestamp,
        notes,
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: newBalance,
        totalDeposited: player.totalDeposited + amount,
        updatedAt: timestamp,
      })

      return { walletTransactionId, newBalance }
    })

    // A replayed gesture already wrote its audit row the first time.
    if (result.alreadyRecorded) return result

    // Audit log — best-effort, outside the transaction.
    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.deposit',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: {
        walletTransactionId,
        amount,
        method,
        reference,
      },
    })

    return result
  })
}
