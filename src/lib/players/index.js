// Single import point for player-domain operations.
//
// Usage:
//   import { mergePlayer, normalizePhone, AlreadyMergedError } from '../lib/players'

export { mergePlayer } from './merge'
export { createPlayer, updatePlayer } from './profile'
export { normalizePhone, findDuplicateCandidates } from './duplicates'
export { searchPlayers, playerDisplayName } from './search'

export {
  PlayerError,
  PlayerMergeError,
  AlreadyMergedError,
  SameSourceAndTargetError,
  ActiveEntriesError,
  PendingWithdrawalsError,
} from './errors'
