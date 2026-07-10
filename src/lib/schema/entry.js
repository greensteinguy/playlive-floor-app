// Schema for the `tournaments/{tid}/entries` subcollection.
// Mirrors docs/schema/canonical-schema.md §5.2.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  Money,
  FirestoreTimestamp,
  NullableTimestamp,
} from './_shared'

const EntryType = z.enum(['initial', 'reentry', 'rebuy', 'addOn'])

// Four tournament-pay methods (per wallet-design.md Q1 — PayID is deposit-only).
const PaymentMethod = z.enum(['cash', 'eftpos', 'wallet', 'ticket'])

// Last-longer side bet deck (per canonical-schema.md §3.1, same as Upper/Main split).
const LastLongerDeck = z.enum(['upper', 'main'])

export const Entry = z
  .object({
    id: DocumentId,
    legacyId: z.number().int().nullable(),
    tournamentId: DocumentRef,
    playerId: DocumentRef,

    originSessionId: DocumentRef,
    entryType: EntryType,
    entryNumber: z.number().int().positive(),

    registeredAt: FirestoreTimestamp,
    registeredBy: DocumentRef,

    // Payment for this entry (one entry = one payment; re-entries are separate entry docs)
    paymentMethod: PaymentMethod,
    paymentAmount: Money,
    paymentReference: z.string().nullable(),
    walletTransactionId: DocumentRef.nullable(),

    // Live state
    currentTableId: DocumentRef.nullable(),
    currentSeatNumber: z.number().int().positive().nullable(),

    // Outcome
    bustedAt: NullableTimestamp,
    bustedInSessionId: DocumentRef.nullable(),
    finishingPlace: z.number().int().positive().nullable(),

    // Mystery Bounty earnings
    bountyEarnings: Money,
    bountiesKnockoutCount: z.number().int().nonnegative(),

    // Winnings
    cashWinnings: Money,
    ticketWinnings: Money,

    // Cashier-confirmed payout state (task 4.7). A staged amount (cashWinnings
    // set by the payout calculator confirm or a deal) is NOT paid until the
    // cashier confirms — winningsPaidAt is stamped then, in the same transaction
    // that credits the player's wallet. winningsWalletTransactionId links to
    // that winCredit walletTransactions row (two-way trace, mirroring
    // withdrawalRequests.walletTransactionId). `.default(null)` keeps docs
    // written before these fields existed valid on read.
    winningsPaidAt: NullableTimestamp.default(null),
    winningsWalletTransactionId: DocumentRef.nullable().default(null),

    // Last-longer side bet
    lastLongerDeck: LastLongerDeck.nullable(),
    isLastLongerWinner: z.boolean(),

    // Lifecycle (voided = soft-delete equivalent for entries)
    voidedAt: NullableTimestamp,
    voidedBy: DocumentRef.nullable(),
    voidReason: z.string().nullable(),

    notes: z.string().nullable(),

    // Standard (no createdBy — registeredBy serves that role; no archivedAt — voidedAt is the soft-delete)
    createdAt: FirestoreTimestamp,
    updatedAt: FirestoreTimestamp,
  })
  .strict()
  .superRefine((e, ctx) => {
    // Seat consistency: either both currentTableId and currentSeatNumber set, or both null.
    if ((e.currentTableId === null) !== (e.currentSeatNumber === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentTableId'],
        message: 'currentTableId and currentSeatNumber must both be set or both be null',
      })
    }

    // Bust consistency: bustedAt set iff bustedInSessionId set iff currentTableId/Seat cleared.
    const isBusted = e.bustedAt !== null
    if (isBusted !== (e.bustedInSessionId !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bustedInSessionId'],
        message: 'bustedAt and bustedInSessionId must both be set or both be null',
      })
    }
    if (isBusted && e.currentTableId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentTableId'],
        message: 'currentTableId must be null when entry is busted',
      })
    }

    // Paid-state consistency: a wallet-transaction link implies the row is paid.
    // (The reverse is deliberately NOT required — a future cash-at-till payout
    // channel would set winningsPaidAt without a wallet credit.)
    if (e.winningsWalletTransactionId !== null && e.winningsPaidAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['winningsWalletTransactionId'],
        message: 'winningsWalletTransactionId requires winningsPaidAt to be set',
      })
    }

    // Voided consistency: voidedAt set iff voidedBy set iff voidReason set.
    const voidedSet = [e.voidedAt, e.voidedBy, e.voidReason].filter((v) => v !== null).length
    if (voidedSet !== 0 && voidedSet !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['voidedAt'],
        message: 'voidedAt, voidedBy, voidReason must all be set or all be null',
      })
    }
  })
