// Single import point for player-domain operations.
//
// Usage:
//   import { mergePlayer, normalizePhone, AlreadyMergedError } from '../lib/players'

export { mergePlayer } from './merge'
export { normalizePhone, findDuplicateCandidates } from './duplicates'

export {
  PlayerMergeError,
  AlreadyMergedError,
  SameSourceAndTargetError,
  ActiveEntriesError,
  PendingWithdrawalsError,
} from './errors'
