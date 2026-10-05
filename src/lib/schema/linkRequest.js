// Schema for the `linkRequests` top-level collection (Phase 6.2).
// Mirrors docs/schema/canonical-schema.md §3.8.
//
// Written ONLY by the linkPlayerAccount Cloud Function when phone auto-match
// fails to find exactly one unmerged, unlinked player for a verified phone
// number. Staff resolve at the desk: pick the right player (or create one) →
// 'linked' (the resolving op also stamps players.authUid + the playerId
// custom claim), or 'rejected'. Players never read or write these.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  FirestoreTimestamp,
  NullableTimestamp,
} from './_shared'

const State = z.enum(['pending', 'linked', 'rejected'])

export const LinkRequest = z
  .object({
    id: DocumentId,
    authUid: z.string().min(1),

    // The phone number as verified by Firebase phone auth (E.164). Kept for
    // the desk to search against; player-doc phones are stored as-entered,
    // which is exactly why auto-match can fail.
    phone: z.string().min(1),

    state: State,

    // Why auto-match failed (shown to the desk).
    reason: z.enum(['noMatch', 'multipleMatches', 'matchedPlayerAlreadyLinked']),
    candidatePlayerIds: z.array(DocumentRef),

    requestedAt: FirestoreTimestamp,

    // resolution (state != 'pending')
    playerId: DocumentRef.nullable(),
    resolvedBy: DocumentRef.nullable(),
    resolvedAt: NullableTimestamp,
    resolutionNote: z.string().nullable(),

    // Standard (createdAt == requestedAt)
    createdAt: FirestoreTimestamp,
    updatedAt: FirestoreTimestamp,
  })
  .strict()
  .superRefine((l, ctx) => {
    if (l.state === 'linked' && l.playerId === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['playerId'], message: 'required when state=linked' })
    }
    if (l.state !== 'pending') {
      if (l.resolvedBy === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolvedBy'], message: `required when state=${l.state}` })
      }
      if (l.resolvedAt === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolvedAt'], message: `required when state=${l.state}` })
      }
    }
    if (l.state === 'pending') {
      const stray = [
        ['playerId', l.playerId],
        ['resolvedBy', l.resolvedBy],
        ['resolvedAt', l.resolvedAt],
      ].filter(([, v]) => v !== null)
      for (const [field] of stray) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'must be null when state=pending' })
      }
    }
  })
