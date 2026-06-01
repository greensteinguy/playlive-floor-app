// Shared helpers used by multiple wallet operations.

import { Timestamp } from 'firebase/firestore'
import { auditLog } from '../firestore'
import { InvalidOverrideError } from './errors'

/**
 * Validate a manager override object.
 * Required shape: { reason: string } where reason is a non-empty string.
 * Throws InvalidOverrideError if shape is wrong.
 */
export function validateManagerOverride(override) {
  if (!override || typeof override !== 'object') {
    throw new InvalidOverrideError('override must be an object with a "reason" field')
  }
  if (typeof override.reason !== 'string' || override.reason.trim() === '') {
    throw new InvalidOverrideError('override.reason must be a non-empty string')
  }
}

/**
 * Emit a `manager.override` audit log entry. Best-effort (uses writeAuditLogSafe).
 *
 * @param {object} params
 * @param {string} params.actorId - the manager performing the override
 * @param {string} params.overrideType - e.g. 'ticketBelowFaceValue', 'walletNegative' (NB walletNegative shouldn't happen — hard invariant)
 * @param {string} params.reason - the manager-supplied reason
 * @param {string|null} [params.targetType]
 * @param {string|null} [params.targetId]
 * @param {object} [params.context] - additional metadata for the audit row
 */
export function emitManagerOverride({
  actorId,
  overrideType,
  reason,
  targetType = null,
  targetId = null,
  context = {},
}) {
  return auditLog.writeAuditLogSafe({
    actorId,
    actorRole: 'manager',
    actionType: 'manager.override',
    targetType,
    targetId,
    metadata: { overrideType, reason, ...context },
  })
}

/**
 * Effect a `type` value has on the running player balance, in cents.
 * Returns a signed number: positive for credit, negative for debit, 0 for no-op.
 * The wallet module uses this to compute the new balance after each ledger row.
 *
 * Mirrors the table in docs/wallet-design.md §4 / canonical-schema.md §4.1.
 */
export function balanceDelta({ type, amount, method }) {
  switch (type) {
    case 'deposit':
    case 'winCredit':
    case 'openingBalance':
    case 'managerCredit':
      return amount
    case 'spend':
      // Only wallet-method spends touch the balance.
      return method === 'wallet' ? -amount : 0
    case 'withdrawalComplete':
    case 'managerDebit':
      return -amount
    case 'adjustment':
      throw new Error('balanceDelta: adjustment requires explicit sign via context; do not infer')
    case 'ticketUse':
    case 'withdrawalRequest':
    case 'withdrawalCancel':
      return 0
    default:
      throw new Error(`balanceDelta: unknown type "${type}"`)
  }
}

/**
 * Signed wallet-balance effect of a FULL transaction row, in cents.
 * Unlike `balanceDelta`, this handles `adjustment` (which carries its sign in
 * `direction`, not in `type`) by reading the row's `direction` field, and
 * delegates every other type to `balanceDelta`.
 *
 * This is the single source of truth for "what did this ledger row do to the
 * wallet balance" — used by both reconciliation (verifyBalanceMatchesLedger)
 * and the per-player ledger view (task 3.11), so the two can never drift.
 *
 * @param {{ type: string, amount: number, method: string|null, direction: string|null }} tx
 * @returns {number} positive = credit, negative = debit, 0 = no wallet effect
 */
export function walletTxDelta(tx) {
  if (tx.type === 'adjustment') {
    return tx.direction === 'credit' ? tx.amount : -tx.amount
  }
  return balanceDelta({ type: tx.type, amount: tx.amount, method: tx.method })
}

/**
 * Effect on the running ticketBalance. Positive when a ticket is issued,
 * negative when used. Other types have no effect.
 *
 * @param {{ type: string, ticketFaceValue?: number }} args
 */
export function ticketBalanceDelta({ type, ticketFaceValue = 0 }) {
  switch (type) {
    case 'ticketIssued':
      return ticketFaceValue
    case 'ticketUse':
      return -ticketFaceValue
    default:
      return 0
  }
}

/** Convenience: a Firestore Timestamp for "now". */
export function now() {
  return Timestamp.now()
}

/**
 * Idempotent error wrap — if the inner function throws a WalletError, rethrow;
 * otherwise rethrow with a slightly clearer prefix indicating the originating
 * wallet operation. Used to make error reports unambiguous.
 */
export async function wrapWalletErrors(operationName, fn) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof Error) {
      e.message = `[wallet.${operationName}] ${e.message}`
    }
    throw e
  }
}
