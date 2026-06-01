// Schema for the `auditLog` top-level collection.
// Mirrors docs/schema/canonical-schema.md §3.6.
//
// Action types follow a dot-separated convention (e.g., 'wallet.deposit',
// 'tournament.created'). The well-known set is enumerated below for early
// linting, but the schema accepts any non-empty string for forward compatibility
// (so introducing a new action type doesn't require a validator change).

import { z } from 'zod'
import { DocumentId, DocumentRef, NonEmptyString, ActorRole, FirestoreTimestamp } from './_shared'

/**
 * Well-known action types. Listed for reference; the validator accepts any
 * non-empty string so we can introduce new types without updating Zod first.
 * Keep this list in sync with the table in canonical-schema.md §3.6.
 */
export const WELL_KNOWN_ACTION_TYPES = /** @type {const} */ ([
  // auth
  'auth.signIn',
  'auth.signOut',
  // player
  'player.created',
  'player.updated',
  'player.merged',
  // tournament
  'tournament.created',
  'tournament.updated',
  'tournament.published',
  'tournament.statusChanged',
  'tournament.clockStarted',
  'tournament.paused',
  'tournament.resumed',
  'tournament.levelChanged',
  'tournament.clockFinished',
  'tournament.cancelled',
  'tournament.structureEdited',
  'tournament.payoutEdited',
  'tournament.dealEntered',
  // structure template
  'structureTemplate.created',
  'structureTemplate.updated',
  'structureTemplate.archived',
  // tournament template
  'tournamentTemplate.created',
  'tournamentTemplate.updated',
  'tournamentTemplate.archived',
  // entry
  'entry.created',
  'entry.busted',
  'entry.voided',
  // seating (task 3.7 / 3.8)
  'seating.drawn',
  'seating.cleared',
  'seating.seatAssigned',
  'seating.unseated',
  'seating.balanced',
  // wallet
  'wallet.deposit',
  'wallet.spend',
  'wallet.ticketUse',
  'wallet.winCredit',
  'wallet.adjustment',
  'wallet.managerCredit',
  'wallet.managerDebit',
  // withdrawal
  'withdrawal.requested',
  'withdrawal.completed',
  'withdrawal.cancelled',
  // manager override (default-invariant bypass — see canonical-schema.md §6.2)
  'manager.override',
])

export const AuditLogEntry = z
  .object({
    id: DocumentId,
    timestamp: FirestoreTimestamp,
    actorId: NonEmptyString, // 'system' for migration / scheduled jobs
    actorRole: ActorRole,

    actionType: NonEmptyString, // dot-separated; see WELL_KNOWN_ACTION_TYPES

    targetType: z.string().nullable(),
    targetId: DocumentRef.nullable(),

    // Free-form context. Different actionTypes carry different metadata; not validated here.
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict()
