// Manager-authorized credits and debits to a player's wallet.
//
// Distinct from `writeAdjustment` — these are INTENTIONAL ledger moves a
// manager performs (comps, goodwill credits, recouping over-credits, etc.),
// not corrections of data-entry mistakes. The distinction matters for:
//   - Audit clarity: "wallet.managerCredit" vs "wallet.adjustment"
//   - Reconciliation: managers can see how much goodwill credit is being
//     extended vs how much is going to bookkeeping fixes
//   - Operational policy: manager-authorized ledger moves carry weight that
//     a mid-shift correction doesn't
//
// Both operations are MANAGER-ONLY (enforced here + at the schema layer as
// defence in depth). Both require a non-empty reason (captured in `notes` on
// the walletTransactions row + the audit log).
//
// The HARD wallet ≥ 0 invariant still applies to recordManagerDebit — a debit
// that would push balance negative is rejected. No override. (Per Guy's
// clarification: wallet going negative is venue liability, not a favour.)

import {
  runValidatedTransaction,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Player, WalletTransaction } from '../schema'
import { now, wrapWalletErrors } from './_shared'
import { InsufficientWalletBalanceError, RoleNotAuthorizedError } from './errors'

/**
 * Manager-authorized credit to a player's wallet. Use for comps, goodwill,
 * extending player credit, loyalty bonuses — any time a manager intentionally
 * adds money to a wallet without a corresponding real-money inflow.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount        integer cents, > 0
 * @param {string} args.reason        required, non-empty — manager's justification
 * @param {string} args.actorId       the manager performing the credit
 * @param {'manager'} args.actorRole  must be 'manager' — RoleNotAuthorizedError otherwise
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number }>}
 */
export async function recordManagerCredit({
  playerId,
  amount,
  reason,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('recordManagerCredit', async () => {
    if (actorRole !== 'manager') {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'manager',
        action: 'recordManagerCredit',
      })
    }
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('reason is required (non-empty string)')
    }

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(playerId), Player)

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'managerCredit',
        amount,
        method: null,
        reference: null,
        relatedDocId: null,
        actorId,
        actorRole,
        timestamp,
        notes: reason,
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
      actionType: 'wallet.managerCredit',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: {
        walletTransactionId,
        amount,
        reason,
      },
    })

    return result
  })
}

/**
 * Manager-authorized debit from a player's wallet. Use for recouping an
 * over-credit, reversing a prior manager comp, or any other intentional
 * removal of wallet balance by a manager.
 *
 * HARD invariant: throws InsufficientWalletBalanceError if the debit would
 * push balance negative. No override path — wallet ≥ 0 is venue liability,
 * not a favour.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount        integer cents, > 0
 * @param {string} args.reason        required, non-empty
 * @param {string} args.actorId
 * @param {'manager'} args.actorRole
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number }>}
 */
export async function recordManagerDebit({
  playerId,
  amount,
  reason,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('recordManagerDebit', async () => {
    if (actorRole !== 'manager') {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'manager',
        action: 'recordManagerDebit',
      })
    }
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('reason is required (non-empty string)')
    }

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(playerId), Player)

      // HARD invariant
      if (player.walletBalance < amount) {
        throw new InsufficientWalletBalanceError({
          playerId,
          currentBalance: player.walletBalance,
          requestedAmount: amount,
        })
      }

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'managerDebit',
        amount,
        method: null,
        reference: null,
        relatedDocId: null,
        actorId,
        actorRole,
        timestamp,
        notes: reason,
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: player.walletBalance - amount,
        updatedAt: timestamp,
      })

      return { walletTransactionId, newBalance: player.walletBalance - amount }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.managerDebit',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: {
        walletTransactionId,
        amount,
        reason,
      },
    })

    return result
  })
}
