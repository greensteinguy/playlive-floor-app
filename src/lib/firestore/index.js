// Single import point for the data layer.
//
// Usage:
//   import { getTournament, runValidatedTransaction, generateId } from '../lib/firestore'

// Generic helpers (use directly for one-off queries; per-collection wrappers below are usually cleaner)
export {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  validatedDelete,
  subscribeToDoc,
  subscribeToCollection,
  runValidatedTransaction,
  runValidatedBatch,
} from './_client'

// Errors (for catch handlers)
export {
  DataLayerError,
  NotFoundError,
  ValidationError,
  MockModeError,
  WriteTimeoutError,
} from './_errors'

// Write-timeout deadline (exported for tests / call sites that race their own writes)
export { WRITE_TIMEOUT_MS, withWriteTimeout } from './_timeout'

// ID generator (for creating docs with client-side IDs, e.g., atomic batches of related docs)
export { generateId } from './_ids'

// Path builders (occasionally useful when the per-collection wrappers don't cover a case)
export * as paths from './_paths'

// ── Per-collection wrappers (recommended for most call sites) ──────────────

// Top-level collections
export * as tournaments from './tournaments'
export * as players from './players'
export * as withdrawalRequests from './withdrawalRequests'
export * as structureTemplates from './structureTemplates'
export * as tournamentTemplates from './tournamentTemplates'
export * as auditLog from './auditLog'

// Subcollections under tournaments
export * as sessions from './sessions'
export * as entries from './entries'
export * as tables from './tables'
export * as bountyDraws from './bountyDraws'

// Subcollections under players
export * as walletTransactions from './walletTransactions'
export * as tickets from './tickets'
