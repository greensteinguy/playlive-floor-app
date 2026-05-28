// Withdrawal request lifecycle.
//
// Two-step pattern (per SOW §3.4):
//   - Any Cashier or Manager creates the request (state='pending').
//   - Only a Manager can mark it 'completed', which atomically debits the
//     player's wallet and writes a walletTransactions row of type='withdrawalComplete'.
//   - Either role can cancel a 'pending' request — no wallet impact.
//
// Role enforcement happens here at the app layer (per "enforce at app, not rules" —
// DECISIONS.md). Firestore rules don't check actor role on these writes.

import {
  runValidatedTransaction,
  validatedSet,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Player, WalletTransaction, WithdrawalRequest } from '../schema'
import { now, wrapWalletErrors } from './_shared'
import {
  InsufficientWalletBalanceError,
  RoleNotAuthorizedError,
  WithdrawalStateError,
} from './errors'

/**
 * Create a withdrawal request (state=pending). Any Cashier or Manager can do this.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount             integer cents
 * @param {'cash'|'eftposRefund'|'bankTransfer'} args.payoutMethod
 * @param {string} args.actorId
 * @param {'manager'|'cashier'} args.actorRole
 */
export async function createWithdrawalRequest({
  playerId,
  amount,
  payoutMethod,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('createWithdrawalRequest', async () => {
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)
    if (!['manager', 'cashier'].includes(actorRole)) {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'cashier or manager',
        action: 'createWithdrawalRequest',
      })
    }

    const id = generateId()
    const timestamp = now()

    await validatedSet(paths.withdrawalRequestPath(id), WithdrawalRequest, {
      id,
      playerId,
      amount,
      payoutMethod,
      state: 'pending',
      requestedBy: actorId,
      requestedAt: timestamp,
      completedBy: null,
      completedAt: null,
      externalReference: null,
      walletTransactionId: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'withdrawal.requested',
      targetType: 'withdrawalRequest',
      targetId: id,
      timestamp,
      metadata: { playerId, amount, payoutMethod },
    })

    return { withdrawalRequestId: id }
  })
}

/**
 * Complete a pending withdrawal. MANAGER ONLY (enforced here, not in rules).
 * Atomically:
 *   - sets withdrawalRequest state=completed
 *   - writes walletTransactions row (type=withdrawalComplete)
 *   - debits player walletBalance
 *
 * Includes the HARD wallet ≥ 0 check — if completing this withdrawal would
 * push balance negative, throws InsufficientWalletBalanceError (no override).
 *
 * @param {object} args
 * @param {string} args.requestId
 * @param {string} args.actorId        the Manager doing the completion
 * @param {string|null} [args.externalReference]  bank transfer ref, EFTPOS approval, etc.
 */
export async function completeWithdrawal({
  requestId,
  actorId,
  actorRole,
  externalReference = null,
}) {
  return wrapWalletErrors('completeWithdrawal', async () => {
    if (actorRole !== 'manager') {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'manager',
        action: 'completeWithdrawal',
      })
    }

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const request = await tx.get(paths.withdrawalRequestPath(requestId), WithdrawalRequest)
      if (request.state !== 'pending') {
        throw new WithdrawalStateError({
          requestId,
          currentState: request.state,
          attemptedTransition: 'complete',
        })
      }

      const player = await tx.get(paths.playerPath(request.playerId), Player)
      if (player.walletBalance < request.amount) {
        throw new InsufficientWalletBalanceError({
          playerId: request.playerId,
          currentBalance: player.walletBalance,
          requestedAmount: request.amount,
        })
      }

      // walletTransactions: withdrawalComplete (debits balance)
      tx.set(paths.walletTransactionPath(request.playerId, walletTransactionId), WalletTransaction, {
        playerId: request.playerId,
        type: 'withdrawalComplete',
        amount: request.amount,
        method: null,
        reference: externalReference,
        relatedDocId: requestId,
        actorId,
        actorRole,
        timestamp,
        notes: null,
      })

      // Update withdrawalRequest state
      tx.update(paths.withdrawalRequestPath(requestId), {
        state: 'completed',
        completedBy: actorId,
        completedAt: timestamp,
        externalReference,
        walletTransactionId,
        updatedAt: timestamp,
      })

      // Debit player balance
      tx.update(paths.playerPath(request.playerId), {
        walletBalance: player.walletBalance - request.amount,
        updatedAt: timestamp,
      })

      return { walletTransactionId, newBalance: player.walletBalance - request.amount }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'withdrawal.completed',
      targetType: 'withdrawalRequest',
      targetId: requestId,
      timestamp,
      metadata: { walletTransactionId, externalReference },
    })

    return result
  })
}

/**
 * Cancel a pending withdrawal. No wallet impact (request was never completed).
 * Either Cashier or Manager can cancel.
 *
 * @param {object} args
 * @param {string} args.requestId
 * @param {string} args.actorId
 * @param {'cashier'|'manager'} args.actorRole
 * @param {string} args.cancelReason  required, non-empty
 */
export async function cancelWithdrawal({
  requestId,
  actorId,
  actorRole,
  cancelReason,
}) {
  return wrapWalletErrors('cancelWithdrawal', async () => {
    if (!['cashier', 'manager'].includes(actorRole)) {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'cashier or manager',
        action: 'cancelWithdrawal',
      })
    }
    if (typeof cancelReason !== 'string' || cancelReason.trim() === '') {
      throw new Error('cancelReason is required (non-empty string)')
    }

    const timestamp = now()

    await runValidatedTransaction(async (tx) => {
      const request = await tx.get(paths.withdrawalRequestPath(requestId), WithdrawalRequest)
      if (request.state !== 'pending') {
        throw new WithdrawalStateError({
          requestId,
          currentState: request.state,
          attemptedTransition: 'cancel',
        })
      }

      tx.update(paths.withdrawalRequestPath(requestId), {
        state: 'cancelled',
        cancelledBy: actorId,
        cancelledAt: timestamp,
        cancelReason,
        updatedAt: timestamp,
      })
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'withdrawal.cancelled',
      targetType: 'withdrawalRequest',
      targetId: requestId,
      timestamp,
      metadata: { cancelReason },
    })
  })
}
