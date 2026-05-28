// Schema for the `players/{pid}/walletTransactions` subcollection.
// Mirrors docs/schema/canonical-schema.md §4.1 and docs/wallet-design.md.
//
// Sign convention (HARD invariant, no override): amount is ALWAYS positive.
// The `type` determines whether the row credits or debits the player balance.
// See docs/wallet-design.md §4 for the type → balance-effect mapping.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  PositiveMoney,
  ActorRole,
  FirestoreTimestamp,
} from './_shared'

const Type = z.enum([
  'deposit',
  'spend',
  'ticketUse',
  'winCredit',
  'withdrawalRequest',
  'withdrawalComplete',
  'withdrawalCancel',
  'adjustment',       // for fixing data-entry mistakes
  'openingBalance',   // for migration import
  'managerCredit',    // manager-authorized credit (comp, goodwill, extending credit)
  'managerDebit',     // manager-authorized debit (recouping over-credit, etc.)
])

// Five payment methods + null for types where method doesn't apply.
const Method = z.enum(['cash', 'eftpos', 'payid', 'wallet', 'ticket'])

// Types where `method` MUST be null (the operation isn't a payment-method-bearing one).
const TYPES_REQUIRING_NULL_METHOD = new Set([
  'withdrawalRequest',
  'withdrawalComplete',
  'withdrawalCancel',
  'winCredit',
  'adjustment',
  'openingBalance',
  'managerCredit',
  'managerDebit',
])

export const WalletTransaction = z
  .object({
    id: DocumentId,
    playerId: DocumentRef, // denormalized; matches the path's {pid}

    type: Type,
    amount: PositiveMoney, // HARD invariant: always > 0

    method: Method.nullable(),
    reference: z.string().nullable(),
    relatedDocId: DocumentRef.nullable(),

    actorId: DocumentRef, // auth uid, or 'system' for openingBalance imports
    actorRole: ActorRole,

    timestamp: FirestoreTimestamp,
    notes: z.string().nullable(),
  })
  .strict()
  .superRefine((tx, ctx) => {
    // Method-vs-type invariants
    if (TYPES_REQUIRING_NULL_METHOD.has(tx.type) && tx.method !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['method'],
        message: `method must be null when type='${tx.type}'`,
      })
    }
    if (!TYPES_REQUIRING_NULL_METHOD.has(tx.type) && tx.method === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['method'],
        message: `method is required when type='${tx.type}'`,
      })
    }

    // ticketUse must reference a ticket via relatedDocId
    if (tx.type === 'ticketUse' && tx.relatedDocId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relatedDocId'],
        message: 'relatedDocId (a ticket id) is required when type=ticketUse',
      })
    }

    // openingBalance must be actorRole=system with reference='opening_balance'
    if (tx.type === 'openingBalance') {
      if (tx.actorRole !== 'system') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['actorRole'],
          message: 'actorRole must be "system" for type=openingBalance (these come from the migration import)',
        })
      }
      if (tx.reference !== 'opening_balance') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reference'],
          message: 'reference must be "opening_balance" for type=openingBalance',
        })
      }
    }

    // managerCredit / managerDebit must be performed by a manager. Enforced at the
    // wallet module too; this is defence in depth at the schema layer.
    if (tx.type === 'managerCredit' || tx.type === 'managerDebit') {
      if (tx.actorRole !== 'manager') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['actorRole'],
          message: `actorRole must be "manager" for type=${tx.type} (manager-authorized adjustment)`,
        })
      }
      // Reason must be captured — these are intentional credits/debits, not silent ledger moves.
      if (!tx.notes || tx.notes.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes'],
          message: `notes is required for type=${tx.type} (must include the manager-supplied reason)`,
        })
      }
    }
  })
