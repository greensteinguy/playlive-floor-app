// Schema for the `tournaments/{tid}/tables` subcollection.
// Mirrors docs/schema/canonical-schema.md §5.3.
//
// One doc per table-instance-per-session — "table 1" in Day 1 and "table 1" in
// Day 2 are separate docs with different sessionIds.
//
// dealerMinutes for the tournament is derived from this collection — sum of
// (closedAt - openedAt) across all tables with closedAt set. No separate field.

import { z } from 'zod'
import { DocumentId, DocumentRef, FirestoreTimestamp, NullableTimestamp } from './_shared'

const Status = z.enum(['open', 'broken'])

const Seat = z
  .object({
    seatNumber: z.number().int().positive(),
    entryId: DocumentRef.nullable(),
  })
  .strict()

export const Table = z
  .object({
    id: DocumentId,
    tournamentId: DocumentRef,
    sessionId: DocumentRef,

    tableNumber: z.number().int().positive(),
    seatCount: z.number().int().positive(),

    openedAt: NullableTimestamp,
    closedAt: NullableTimestamp,
    status: Status,
    // Active = the (open) table is being filled — random seating + balancing only
    // ever touch active tables. A deactivated table is open (dealer ready) but
    // skipped, so the TD can open ahead of need and fill it when ready.
    // `.default(true)` keeps reads of docs created before this field valid.
    active: z.boolean().default(true),

    // seats array length must equal seatCount (validated below)
    seats: z.array(Seat),

    createdAt: FirestoreTimestamp,
    updatedAt: FirestoreTimestamp,
  })
  .strict()
  .superRefine((t, ctx) => {
    // Invariant: seats array length matches seatCount.
    if (t.seats.length !== t.seatCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seats'],
        message: `seats array length (${t.seats.length}) must equal seatCount (${t.seatCount})`,
      })
    }

    // Invariant: seatNumbers are 1..seatCount and unique.
    const numbers = t.seats.map((s) => s.seatNumber).sort((a, b) => a - b)
    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i] !== i + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['seats'],
          message: `seat numbers must be 1..${t.seatCount}; got [${numbers.join(', ')}]`,
        })
        break
      }
    }

    // Invariant: a closed table can't be open.
    if (t.status === 'broken' && t.closedAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closedAt'],
        message: 'closedAt must be set when status=broken',
      })
    }

    // Invariant: closedAt requires openedAt to also be set (you can't close what never opened).
    if (t.closedAt !== null && t.openedAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['openedAt'],
        message: 'openedAt must be set when closedAt is set',
      })
    }
  })
