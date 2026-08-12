// Schema for the `registrationRequests` top-level collection (Phase 6.2).
// Mirrors docs/schema/canonical-schema.md §3.7.
//
// A player-initiated tournament registration that could NOT be completed as an
// instant wallet-paid entry (insufficient balance, or the tournament requires
// desk handling). The registerSelf Cloud Function creates these; the Floor App
// registration desk resolves them — 'confirmed' via the normal registerEntry
// flow (taking payment at the desk), or 'cancelled' with a reason.
//
// Instant wallet-paid registrations do NOT create a request doc — they create
// the entry directly (audit-logged), so this queue only ever holds work the
// desk actually needs to act on.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  FirestoreTimestamp,
  NullableTimestamp,
} from './_shared'

const State = z.enum(['pending', 'confirmed', 'cancelled'])

export const RegistrationRequest = z
  .object({
    id: DocumentId,
    playerId: DocumentRef,
    tournamentId: DocumentRef,

    state: State,

    // requested (always set). requestedByUid is the player's own auth uid —
    // NOT a staff uid — so the request is traceable to the app account even
    // if the player link is later changed.
    requestedAt: FirestoreTimestamp,
    requestedByUid: z.string().min(1),
    requestedVia: z.literal('playerApp'),

    // Why the instant path didn't take it (shown to the desk).
    //   insufficientBalance — wallet doesn't cover buyIn + hospitality
    //   multiSession        — multi-day/flight event; the player must pick a
    //                         flight at the desk
    //   playerChoice        — app offered instant pay, player chose the desk
    reason: z.enum(['insufficientBalance', 'multiSession', 'playerChoice']).nullable(),

    // confirmed (state='confirmed' only): the entry the desk created.
    entryId: DocumentRef.nullable(),
    resolvedBy: DocumentRef.nullable(),
    resolvedAt: NullableTimestamp,

    // cancelled (state='cancelled' only)
    cancelReason: z.string().nullable(),

    // Standard (createdAt == requestedAt)
    createdAt: FirestoreTimestamp,
    updatedAt: FirestoreTimestamp,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.state === 'confirmed') {
      if (r.entryId === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entryId'], message: 'required when state=confirmed' })
      }
      if (r.resolvedBy === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolvedBy'], message: 'required when state=confirmed' })
      }
      if (r.resolvedAt === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolvedAt'], message: 'required when state=confirmed' })
      }
    }
    if (r.state === 'cancelled') {
      if (r.resolvedBy === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolvedBy'], message: 'required when state=cancelled' })
      }
      if (r.resolvedAt === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolvedAt'], message: 'required when state=cancelled' })
      }
      if (r.cancelReason === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cancelReason'], message: 'required when state=cancelled' })
      }
    }
    if (r.state === 'pending') {
      const stray = [
        ['entryId', r.entryId],
        ['resolvedBy', r.resolvedBy],
        ['resolvedAt', r.resolvedAt],
        ['cancelReason', r.cancelReason],
      ].filter(([, v]) => v !== null)
      for (const [field] of stray) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'must be null when state=pending' })
      }
    }
  })
