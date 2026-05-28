// Re-exports for src/lib/schema. Single import point for the rest of the app.
//
// Usage:
//   import { Tournament, Player, WalletTransaction } from '../lib/schema'
//   const t = Tournament.parse(rawData)             // throws on invalid
//   const result = Tournament.safeParse(rawData)   // { success, data?, error? }

// Top-level collections
export { Tournament } from './tournament'
export { Player } from './player'
export { WithdrawalRequest } from './withdrawalRequest'
export { StructureTemplate } from './structureTemplate'
export { TournamentTemplate } from './tournamentTemplate'
export { AuditLogEntry, WELL_KNOWN_ACTION_TYPES } from './auditLog'

// Subcollections under tournaments
export { Session } from './session'
export { Entry } from './entry'
export { Table } from './table'
export { BountyDraw } from './bountyDraw'

// Subcollections under players
export { WalletTransaction } from './walletTransaction'
export { Ticket } from './ticket'

// Embedded sub-schemas (exported in case anyone needs to validate just a part)
export { Structure, StructureEntry, LevelEntry, BreakEntry } from './structure'
export { PayoutStructure } from './payoutStructure'

// Shared primitives (occasionally useful at call sites — e.g., form-level money validation)
export {
  Money,
  PositiveMoney,
  ChipCount,
  CountryCode,
  Role,
  ActorRole,
  FirestoreTimestamp,
  NonEmptyString,
  DocumentId,
  DocumentRef,
} from './_shared'
