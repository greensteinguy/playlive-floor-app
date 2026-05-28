// Wallet-specific typed errors. All extend WalletError so callers can catch
// either a specific case or the generic family.

export class WalletError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WalletError'
  }
}

/**
 * HARD invariant violation — no override path.
 * Thrown when an operation would push walletBalance < 0.
 */
export class InsufficientWalletBalanceError extends WalletError {
  constructor({ playerId, currentBalance, requestedAmount }) {
    super(
      `Insufficient wallet balance for player ${playerId}: ` +
      `current=${currentBalance} cents, requested=${requestedAmount} cents. ` +
      `Wallet cannot go negative (hard invariant — no manager override).`
    )
    this.name = 'InsufficientWalletBalanceError'
    this.playerId = playerId
    this.currentBalance = currentBalance
    this.requestedAmount = requestedAmount
  }
}

/**
 * Default invariant violation — overridable by a manager.
 * Thrown when a ticket's face value is less than the tournament's total cost
 * AND no manager override was provided.
 */
export class TicketBelowFaceValueError extends WalletError {
  constructor({ ticketId, faceValue, totalCost }) {
    super(
      `Ticket ${ticketId} face value (${faceValue} cents) is less than the tournament cost (${totalCost} cents). ` +
      `A manager can override this rule — pass managerOverride={reason:"..."} to allow the ticket to be used below cost.`
    )
    this.name = 'TicketBelowFaceValueError'
    this.ticketId = ticketId
    this.faceValue = faceValue
    this.totalCost = totalCost
  }
}

export class TicketAlreadyUsedError extends WalletError {
  constructor(ticketId) {
    super(`Ticket ${ticketId} is already used and cannot be used again.`)
    this.name = 'TicketAlreadyUsedError'
    this.ticketId = ticketId
  }
}

/**
 * Thrown when the caller tries to transition a withdrawalRequest from a state
 * that doesn't permit it (e.g., completing a cancelled request).
 */
export class WithdrawalStateError extends WalletError {
  constructor({ requestId, currentState, attemptedTransition }) {
    super(
      `Cannot ${attemptedTransition} withdrawalRequest ${requestId}: ` +
      `current state is "${currentState}".`
    )
    this.name = 'WithdrawalStateError'
    this.requestId = requestId
    this.currentState = currentState
    this.attemptedTransition = attemptedTransition
  }
}

/**
 * Thrown when an operation requires a specific role (e.g., Manager for withdrawal
 * completion) but the actor doesn't have it. Per the "enforce at app, not rules"
 * decision (DECISIONS.md), Firestore rules don't enforce this — the wallet module
 * does.
 */
export class RoleNotAuthorizedError extends WalletError {
  constructor({ actorRole, requiredRole, action }) {
    super(
      `Role "${actorRole}" is not authorized for ${action}. Requires role "${requiredRole}".`
    )
    this.name = 'RoleNotAuthorizedError'
    this.actorRole = actorRole
    this.requiredRole = requiredRole
    this.action = action
  }
}

/**
 * Thrown when a manager override is required (by the caller) but the supplied
 * `managerOverride` object is malformed (e.g., missing reason).
 */
export class InvalidOverrideError extends WalletError {
  constructor(message) {
    super(`Invalid manager override: ${message}`)
    this.name = 'InvalidOverrideError'
  }
}
