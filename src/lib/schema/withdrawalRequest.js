// Schema for the `withdrawalRequests` top-level collection.
// Mirrors docs/schema/canonical-schema.md §3.3.
//
// Two-step pattern: any Cashier or Manager creates the request (state='pending');
// only a Manager can mark it 'completed' (which atomically debits the wallet).

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  PositiveMoney,
  FirestoreTimestamp,
  NullableTimestamp,
} from './_shared'

const PayoutMethod = z.enum(['cash', 'eftposRefund', 'bankTransfer'])

const State = z.enum(['pending', 'completed', 'cancelled'])

export const WithdrawalRequest = z
  .object({
    id: DocumentId,
    playerId: DocumentRef,

    amount: PositiveMoney,
    payoutMethod: PayoutMethod,

    state: State,

    // requested (always set)
    requestedBy: DocumentRef,
    requestedAt: FirestoreTimestamp,

    // completed (state='completed' only)
    completedBy: DocumentRef.nullable(),
    completedAt: NullableTimestamp,
    externalReference: z.string().nullable(),
    walletTransactionId: DocumentRef.nullable(),

    // cancelled (state='cancelled' only)
    cancelledBy: DocumentRef.nullable(),
    cancelledAt: NullableTimestamp,
    cancelReason: z.string().nullable(),

    // Standard (createdAt == requestedAt)
    createdAt: FirestoreTimestamp,
    updatedAt: FirestoreTimestamp,
  })
  .strict()
  .superRefine((w, ctx) => {
    // Invariant: state-dependent field presence
    if (w.state === 'completed') {
      if (w.completedBy === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['completedBy'], message: 'required when state=completed' })
      }
      if (w.completedAt === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['completedAt'], message: 'required when state=completed' })
      }
      if (w.walletTransactionId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['walletTransactionId'],
          message: 'required when state=completed (ref to the walletTransactions doc that debited the wallet)',
        })
      }
    }
    if (w.state === 'cancelled') {
      if (w.cancelledBy === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cancelledBy'], message: 'required when state=cancelled' })
      }
      if (w.cancelledAt === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cancelledAt'], message: 'required when state=cancelled' })
      }
    }
    if (w.state === 'pending') {
      // Pending requests must not have completed/cancelled fields populated
      const stray = [
        ['completedBy', w.completedBy],
        ['completedAt', w.completedAt],
        ['walletTransactionId', w.walletTransactionId],
        ['cancelledBy', w.cancelledBy],
        ['cancelledAt', w.cancelledAt],
      ].filter(([, v]) => v !== null)
      for (const [field] of stray) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `must be null when state=pending`,
        })
      }
    }
  })
