// Schema for the `players` top-level collection.
// Mirrors docs/schema/canonical-schema.md §3.2.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  NonEmptyString,
  Money,
  CountryCode,
  AuditFields,
  ArchiveField,
  NullableTimestamp,
} from './_shared'

export const Player = z
  .object({
    id: DocumentId,
    legacyId: z.number().int().nullable(),

    // Names — first/last mandatory; displayName overrides "First Last" when set.
    firstName: NonEmptyString,
    lastName: NonEmptyString,
    displayName: z.string().nullable(),

    // Contact — phone mandatory, others optional. Phone stored as-entered (no E.164 normalization in v1).
    phone: NonEmptyString,
    email: z.string().email().nullable(),
    streetAddress: z.string().nullable(),

    // Country code (legacy 'ensign' field; for flag display)
    countryCode: CountryCode.nullable(),

    // Derived / cached. Updated atomically alongside walletTransactions writes.
    // walletBalance is a HARD invariant >= 0 — see canonical-schema.md §6.2.
    walletBalance: Money,
    ticketBalance: Money,
    totalDeposited: Money,

    // Merge history (per the duplicate-merge tool, Phase 1 task 1.8)
    isMerged: z.boolean(),
    mergedIntoId: DocumentRef.nullable(),
    mergedAt: NullableTimestamp,

    // Standard
    ...AuditFields,
    ...ArchiveField,
  })
  .strict()
  .superRefine((p, ctx) => {
    // Invariant: walletBalance >= 0 (HARD — no manager override; per §6.2 named exception).
    // Money already enforces >= 0, but call this out explicitly so a future refactor
    // doesn't accidentally relax it.
    if (p.walletBalance < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['walletBalance'],
        message: 'walletBalance must never be negative — hard invariant per canonical-schema.md §6.2',
      })
    }

    // Invariant: if isMerged is true, mergedIntoId and mergedAt must both be set.
    // If false, both must be null.
    if (p.isMerged) {
      if (p.mergedIntoId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mergedIntoId'],
          message: 'mergedIntoId is required when isMerged is true',
        })
      }
      if (p.mergedAt === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mergedAt'],
          message: 'mergedAt is required when isMerged is true',
        })
      }
    } else {
      if (p.mergedIntoId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mergedIntoId'],
          message: 'mergedIntoId must be null when isMerged is false',
        })
      }
      if (p.mergedAt !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mergedAt'],
          message: 'mergedAt must be null when isMerged is false',
        })
      }
    }
  })
