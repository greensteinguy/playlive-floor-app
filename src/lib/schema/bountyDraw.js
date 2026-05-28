// Schema for the `tournaments/{tid}/bountyDraws` subcollection.
// Mirrors docs/schema/canonical-schema.md §5.4.
//
// One doc per drawn Mystery Bounty. The "remaining pool" is computed as
// tournaments/{tid}.bountyPoolConfig.bountyValues minus the values present here.

import { z } from 'zod'
import { DocumentId, DocumentRef, PositiveMoney, FirestoreTimestamp } from './_shared'

export const BountyDraw = z
  .object({
    id: DocumentId,
    tournamentId: DocumentRef,

    bountyValue: PositiveMoney,
    drawnAt: FirestoreTimestamp,
    drawnBy: DocumentRef, // auth uid

    knockedOutEntryId: DocumentRef,
    knockerEntryId: DocumentRef,

    // Set when the cashier confirms the win-credit (per wallet-design.md Q4 — no auto-credit).
    // Null until then.
    walletTransactionId: DocumentRef.nullable(),

    notes: z.string().nullable(),
  })
  .strict()
  .superRefine((d, ctx) => {
    // Sanity: the knocker and the knocked-out can't be the same entry.
    if (d.knockedOutEntryId === d.knockerEntryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['knockedOutEntryId'],
        message: 'knockedOutEntryId and knockerEntryId must be different entries',
      })
    }
  })
