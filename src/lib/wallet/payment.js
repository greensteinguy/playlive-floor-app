// Tournament payment operations. Four methods (per wallet-design.md Q1):
//   - cash / eftpos: external — no wallet impact, just records the method
//   - wallet: debits the wallet balance (HARD invariant: balance >= 0, no override)
//   - ticket: marks a ticket used, optionally with a top-up via another method.
//             Face-value-vs-cost rule has a manager override path.
//
// Each operation writes both the entries doc and the wallet rows in a single
// Firestore transaction so we can never have an entry without its payment record
// (or vice versa).

import {
  runValidatedTransaction,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Player, Entry, WalletTransaction, Ticket } from '../schema'
import {
  now,
  wrapWalletErrors,
  validateManagerOverride,
  emitManagerOverride,
} from './_shared'
import {
  InsufficientWalletBalanceError,
  TicketBelowFaceValueError,
  TicketAlreadyUsedError,
} from './errors'

// ── Common ─────────────────────────────────────────────────────────────────

/**
 * Caller provides this — the full Entry shape minus what the wallet module sets
 * (paymentMethod, paymentAmount, paymentReference, walletTransactionId).
 * The wallet module fills those four in based on which `payVia*` helper is called.
 */
function assertEntryDataShape(entryData) {
  if (!entryData || typeof entryData !== 'object') {
    throw new Error('entryData is required and must be an object')
  }
  for (const requiredField of [
    'tournamentId',
    'playerId',
    'originSessionId',
    'entryType',
    'entryNumber',
    'registeredAt',
    'registeredBy',
  ]) {
    if (entryData[requiredField] === undefined) {
      throw new Error(`entryData.${requiredField} is required`)
    }
  }
}

/**
 * Default values for fresh entries' runtime/outcome fields — the wallet module
 * fills these so the caller only has to provide the payment-relevant data.
 */
function defaultEntryRuntimeFields() {
  return {
    legacyId: null,
    currentTableId: null,
    currentSeatNumber: null,
    bustedAt: null,
    bustedInSessionId: null,
    finishingPlace: null,
    bountyEarnings: 0,
    bountiesKnockoutCount: 0,
    cashWinnings: 0,
    ticketWinnings: 0,
    lastLongerDeck: null,
    isLastLongerWinner: false,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    notes: null,
  }
}

// ── pay via external method (cash or EFTPOS) ───────────────────────────────

/**
 * Pay for an entry via cash or EFTPOS. No wallet balance impact — money went
 * to the till or the EFTPOS terminal directly. The ledger row exists for
 * audit / reconciliation.
 *
 * @param {object} args
 * @param {object} args.entryData            Entry fields (see assertEntryDataShape)
 * @param {number} args.totalCost            integer cents, what the player paid (buyIn + hospitalityCost)
 * @param {'cash'|'eftpos'} args.method
 * @param {string|null} args.reference       EFTPOS approval code / "cash" / etc.
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 *
 * @returns {Promise<{ entryId: string, walletTransactionId: string }>}
 */
export async function payViaExternalMethod({
  entryData,
  totalCost,
  method,
  reference,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('payViaExternalMethod', async () => {
    assertEntryDataShape(entryData)
    if (totalCost <= 0) throw new Error(`totalCost must be > 0 (got ${totalCost})`)
    if (method !== 'cash' && method !== 'eftpos') {
      throw new Error(`method must be 'cash' or 'eftpos' (got "${method}")`)
    }

    const entryId = generateId()
    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      // walletTransactions: spend with method=cash|eftpos, no balance change
      tx.set(paths.walletTransactionPath(entryData.playerId, walletTransactionId), WalletTransaction, {
        playerId: entryData.playerId,
        type: 'spend',
        amount: totalCost,
        method,
        reference,
        relatedDocId: entryId,
        actorId,
        actorRole,
        timestamp,
        notes: null,
      })

      // entries
      tx.set(paths.entryPath(entryData.tournamentId, entryId), Entry, {
        ...defaultEntryRuntimeFields(),
        ...entryData,
        tournamentId: entryData.tournamentId,
        paymentMethod: method,
        paymentAmount: totalCost,
        paymentReference: reference,
        walletTransactionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      return { entryId, walletTransactionId }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'entry.created',
      targetType: 'entry',
      targetId: entryId,
      timestamp,
      metadata: { tournamentId: entryData.tournamentId, paymentMethod: method, paymentAmount: totalCost },
    })

    return result
  })
}

// ── pay via wallet ─────────────────────────────────────────────────────────

/**
 * Pay for an entry by debiting the player's wallet balance.
 *
 * HARD invariant: rejects with InsufficientWalletBalanceError if the player's
 * balance is less than totalCost. No manager override path. Cashier must take
 * a deposit (or use a different method) first.
 */
export async function payViaWallet({
  entryData,
  totalCost,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('payViaWallet', async () => {
    assertEntryDataShape(entryData)
    if (totalCost <= 0) throw new Error(`totalCost must be > 0 (got ${totalCost})`)

    const entryId = generateId()
    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(entryData.playerId), Player)

      // HARD invariant — no override
      if (player.walletBalance < totalCost) {
        throw new InsufficientWalletBalanceError({
          playerId: entryData.playerId,
          currentBalance: player.walletBalance,
          requestedAmount: totalCost,
        })
      }

      tx.set(paths.walletTransactionPath(entryData.playerId, walletTransactionId), WalletTransaction, {
        playerId: entryData.playerId,
        type: 'spend',
        amount: totalCost,
        method: 'wallet',
        reference: null,
        relatedDocId: entryId,
        actorId,
        actorRole,
        timestamp,
        notes: null,
      })

      tx.update(paths.playerPath(entryData.playerId), {
        walletBalance: player.walletBalance - totalCost,
        updatedAt: timestamp,
      })

      tx.set(paths.entryPath(entryData.tournamentId, entryId), Entry, {
        ...defaultEntryRuntimeFields(),
        ...entryData,
        tournamentId: entryData.tournamentId,
        paymentMethod: 'wallet',
        paymentAmount: totalCost,
        paymentReference: null,
        walletTransactionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      return { entryId, walletTransactionId }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'entry.created',
      targetType: 'entry',
      targetId: entryId,
      timestamp,
      metadata: { tournamentId: entryData.tournamentId, paymentMethod: 'wallet', paymentAmount: totalCost },
    })

    return result
  })
}

// ── pay via ticket (with optional top-up) ──────────────────────────────────

/**
 * Pay for an entry by redeeming a ticket. Default rule: ticket face value must
 * be >= total cost (the "equal-or-greater" rule from SOW §3.4). If face value
 * is less, a manager override is required.
 *
 * If face value is GREATER than total cost, the difference stays with the venue
 * (no refund to the player). This matches Casinoware behaviour and the original
 * SOW.
 *
 * If face value is LESS than total cost AND a top-up method is provided, the
 * shortfall is paid via that method (cash or EFTPOS) — recorded as a second
 * walletTransactions row.
 *
 * @param {object} args
 * @param {object} args.entryData
 * @param {number} args.totalCost          integer cents
 * @param {string} args.ticketId           the ticket to redeem
 * @param {object|null} args.topUp         { method: 'cash'|'eftpos', reference: string } | null
 * @param {object|null} args.managerOverride  { reason: string } | null — required when faceValue < totalCost AND no top-up
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 *
 * @returns {Promise<{ entryId: string, ticketUseTransactionId: string, topUpTransactionId: string|null }>}
 */
export async function payViaTicket({
  entryData,
  totalCost,
  ticketId,
  topUp = null,
  managerOverride = null,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('payViaTicket', async () => {
    assertEntryDataShape(entryData)
    if (totalCost <= 0) throw new Error(`totalCost must be > 0 (got ${totalCost})`)

    const entryId = generateId()
    const ticketUseTransactionId = generateId()
    const topUpTransactionId = topUp ? generateId() : null
    const timestamp = now()

    if (topUp) {
      if (topUp.method !== 'cash' && topUp.method !== 'eftpos') {
        throw new Error(`topUp.method must be 'cash' or 'eftpos' (got "${topUp.method}")`)
      }
    }

    let overrideUsed = false

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(entryData.playerId), Player)
      const ticket = await tx.get(paths.ticketPath(entryData.playerId, ticketId), Ticket)

      if (ticket.state === 'used') {
        throw new TicketAlreadyUsedError(ticketId)
      }

      const faceValue = ticket.faceValue
      const shortfall = totalCost - faceValue // positive when ticket isn't enough

      if (shortfall > 0) {
        if (topUp) {
          // OK — the top-up will cover the shortfall.
        } else if (managerOverride) {
          validateManagerOverride(managerOverride)
          overrideUsed = true
          // Proceed with ticket as full payment — the shortfall is absorbed by the venue.
        } else {
          throw new TicketBelowFaceValueError({ ticketId, faceValue, totalCost })
        }
      }

      // Mark the ticket used
      tx.update(paths.ticketPath(entryData.playerId, ticketId), {
        state: 'used',
        usedAt: timestamp,
        usedOnEntryId: entryId,
        usedOnTournamentId: entryData.tournamentId,
        updatedAt: timestamp,
      })

      // walletTransactions: ticketUse (no balance change; the ticket itself is the payment)
      tx.set(paths.walletTransactionPath(entryData.playerId, ticketUseTransactionId), WalletTransaction, {
        playerId: entryData.playerId,
        type: 'ticketUse',
        amount: Math.min(faceValue, totalCost),
        method: 'ticket',
        reference: null,
        relatedDocId: ticketId,
        actorId,
        actorRole,
        timestamp,
        notes: null,
      })

      // Top-up walletTransaction, if shortfall is being covered
      if (topUp && shortfall > 0) {
        tx.set(paths.walletTransactionPath(entryData.playerId, topUpTransactionId), WalletTransaction, {
          playerId: entryData.playerId,
          type: 'spend',
          amount: shortfall,
          method: topUp.method,
          reference: topUp.reference ?? null,
          relatedDocId: entryId,
          actorId,
          actorRole,
          timestamp,
          notes: 'ticket top-up',
        })
      }

      // Player ticketBalance debit
      tx.update(paths.playerPath(entryData.playerId), {
        ticketBalance: player.ticketBalance - faceValue,
        updatedAt: timestamp,
      })

      // entries doc
      tx.set(paths.entryPath(entryData.tournamentId, entryId), Entry, {
        ...defaultEntryRuntimeFields(),
        ...entryData,
        tournamentId: entryData.tournamentId,
        paymentMethod: 'ticket',
        paymentAmount: totalCost,
        paymentReference: ticketId, // the ticket id is the payment reference
        walletTransactionId: ticketUseTransactionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      return { entryId, ticketUseTransactionId, topUpTransactionId }
    })

    // Audit log: entry created
    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'entry.created',
      targetType: 'entry',
      targetId: entryId,
      timestamp,
      metadata: {
        tournamentId: entryData.tournamentId,
        paymentMethod: 'ticket',
        paymentAmount: totalCost,
        ticketId,
        topUpMethod: topUp?.method ?? null,
      },
    })

    // Audit log: manager override, if used
    if (overrideUsed) {
      await emitManagerOverride({
        actorId,
        overrideType: 'ticketBelowFaceValue',
        reason: managerOverride.reason,
        targetType: 'ticket',
        targetId: ticketId,
        context: { entryId, ticketId, totalCost },
      })
    }

    return result
  })
}
