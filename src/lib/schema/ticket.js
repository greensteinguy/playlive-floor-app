// Schema for the `players/{pid}/tickets` subcollection.
// Mirrors docs/schema/canonical-schema.md §4.2 and docs/wallet-design.md.
//
// Tickets are tournament-entry only in v1 (per wallet-design.md Q5).
// Equal-or-greater rule (faceValue >= tournament cost) is enforced at the
// wallet module layer, with a manager override path — not in this validator.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  PositiveMoney,
  FirestoreTimestamp,
  NullableTimestamp,
} from './_shared'

const State = z.enum(['unused', 'used'])

export const Ticket = z
  .object({
    id: DocumentId,
    playerId: DocumentRef, // denormalized; matches path's {pid}

    faceValue: PositiveMoney,
    state: State,

    issuedAt: FirestoreTimestamp,
    issuedReason: z.string().nullable(),
    issuedFromTournamentId: DocumentRef.nullable(),

    usedAt: NullableTimestamp,
    usedOnEntryId: DocumentRef.nullable(),
    usedOnTournamentId: DocumentRef.nullable(),

    createdAt: FirestoreTimestamp,
    updatedAt: FirestoreTimestamp,
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.state === 'used') {
      // Used tickets must have all three "used*" fields populated.
      if (t.usedAt === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['usedAt'],
          message: 'usedAt is required when state=used',
        })
      }
      if (t.usedOnEntryId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['usedOnEntryId'],
          message: 'usedOnEntryId is required when state=used',
        })
      }
      if (t.usedOnTournamentId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['usedOnTournamentId'],
          message: 'usedOnTournamentId is required when state=used',
        })
      }
    } else {
      // Unused tickets must have all "used*" fields null.
      if (t.usedAt !== null || t.usedOnEntryId !== null || t.usedOnTournamentId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['state'],
          message: 'usedAt / usedOnEntryId / usedOnTournamentId must all be null when state=unused',
        })
      }
    }
  })
