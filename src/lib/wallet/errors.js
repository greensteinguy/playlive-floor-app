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

/**
 * Thrown when a cashier tries to confirm a satellite ticket win whose entry
 * already carries ticketIssuedAt (the idempotency marker stamped in the same
 * transaction that created the ticket). Re-read inside the transaction, so a
 * double-confirm — even one racing the first — is refused.
 */
export class TicketAlreadyIssuedError extends WalletError {
  constructor({ entryId, issuedTicketId }) {
    super(
      `Entry ${entryId} already has its satellite ticket issued ` +
      `(ticket ${issuedTicketId}). Cannot issue twice.`
    )
    this.name = 'TicketAlreadyIssuedError'
    this.entryId = entryId
    this.issuedTicketId = issuedTicketId
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

/**
 * Thrown when a registration transaction finds an entry doc already at the
 * deterministic entry id (`{playerId}_{entryNumber}`) and it is NOT a replay of
 * the same gesture (different actor / payment / amount). Two devices registered
 * the same player near-simultaneously — the second must NOT charge again.
 */
export class DuplicateEntryError extends WalletError {
  constructor({ entryId, playerId, entryNumber }) {
    super(
      `This player's entry #${entryNumber} already exists (${entryId}) — ` +
      `they were just registered, likely on another device or by an earlier attempt ` +
      `that actually saved. Refresh and check the roster before charging again.`
    )
    this.name = 'DuplicateEntryError'
    this.entryId = entryId
    this.playerId = playerId
    this.entryNumber = entryNumber
  }
}

/**
 * Thrown when the registration transaction re-reads the tournament and finds
 * registration is no longer open (status changed since the desk's snapshot).
 */
export class RegistrationClosedError extends WalletError {
  constructor({ tournamentId, status }) {
    super(
      `Registration is not open for tournament ${tournamentId} ` +
      `(status is now "${status}"). The tournament changed since this screen loaded — refresh.`
    )
    this.name = 'RegistrationClosedError'
    this.tournamentId = tournamentId
    this.status = status
  }
}

/**
 * Thrown when voidEntry is asked to void an entry that is already voided by a
 * DIFFERENT gesture (different actor or reason). A same-gesture retry replays
 * successfully instead.
 */
export class EntryAlreadyVoidedError extends WalletError {
  constructor({ entryId }) {
    super(`Entry ${entryId} is already voided.`)
    this.name = 'EntryAlreadyVoidedError'
    this.entryId = entryId
  }
}

/**
 * Thrown when an entry cannot be voided: it is busted (undo the elimination
 * first if the whole entry was a mistake) or money has already flowed out of
 * it (winnings paid / ticket issued / staged winnings / bounty earnings).
 */
export class EntryNotVoidableError extends WalletError {
  constructor({ entryId, reason }) {
    super(`Entry ${entryId} cannot be voided: ${reason}`)
    this.name = 'EntryNotVoidableError'
    this.entryId = entryId
    this.reason = reason
  }
}
