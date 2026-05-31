// Player-domain typed errors. Follows the same pattern as
// src/lib/wallet/errors.js — a base class so callers can catch either a
// specific case or the whole family.
//
// PlayerError is the family base: the profile ops (createPlayer / updatePlayer)
// throw it directly for input-validation failures, the same way tournaments.js
// throws TournamentError. The merge tool's errors (PlayerMergeError + its
// subclasses) extend it, so `catch (e instanceof PlayerError)` covers the whole
// player domain while `e instanceof PlayerMergeError` still narrows to a merge.

export class PlayerError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PlayerError'
  }
}

export class PlayerMergeError extends PlayerError {
  constructor(message) {
    super(message)
    this.name = 'PlayerMergeError'
  }
}

export class AlreadyMergedError extends PlayerMergeError {
  constructor({ playerId, mergedIntoId }) {
    super(
      `Player ${playerId} is already merged (into ${mergedIntoId ?? '?'}). ` +
      `Cannot merge again.`
    )
    this.name = 'AlreadyMergedError'
    this.playerId = playerId
    this.mergedIntoId = mergedIntoId
  }
}

export class SameSourceAndTargetError extends PlayerMergeError {
  constructor(playerId) {
    super(`Cannot merge player ${playerId} into itself.`)
    this.name = 'SameSourceAndTargetError'
    this.playerId = playerId
  }
}

export class ActiveEntriesError extends PlayerMergeError {
  constructor({ sourceId, count, sampleEntryId }) {
    super(
      `Cannot merge player ${sourceId}: ${count} active tournament ${count === 1 ? 'entry' : 'entries'} ` +
      `(e.g. ${sampleEntryId}). Bust, void, or finish them first.`
    )
    this.name = 'ActiveEntriesError'
    this.sourceId = sourceId
    this.count = count
    this.sampleEntryId = sampleEntryId
  }
}

export class PendingWithdrawalsError extends PlayerMergeError {
  constructor({ sourceId, count, sampleRequestId }) {
    super(
      `Cannot merge player ${sourceId}: ${count} pending withdrawal ${count === 1 ? 'request' : 'requests'} ` +
      `(e.g. ${sampleRequestId}). Cancel or complete them first.`
    )
    this.name = 'PendingWithdrawalsError'
    this.sourceId = sourceId
    this.count = count
    this.sampleRequestId = sampleRequestId
  }
}
