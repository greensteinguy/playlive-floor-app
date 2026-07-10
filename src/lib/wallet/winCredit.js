// Crediting tournament winnings to a player's wallet.
//
// Per wallet-design.md Q4: NO auto-credit. The cashier confirms each winCredit
// before it lands on the player's wallet. The UI for the confirmation flow lives
// in Phase 4 task 4.7; this module is the underlying write.

import {
  runValidatedTransaction,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Player, WalletTransaction, BountyDraw, Entry, Ticket } from '../schema'
import { now, wrapWalletErrors } from './_shared'
import { RoleNotAuthorizedError, TicketAlreadyIssuedError } from './errors'

/**
 * Credit cash winnings to a player's wallet. Use for normal payouts (1st, 2nd,
 * etc.) and for satellite tickets that have been converted to cash.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.amount         integer cents, > 0
 * @param {string|null} args.relatedDocId  typically the entries/{id} this is paying out
 * @param {string} args.actorId        the cashier confirming the credit
 * @param {'manager'|'td'|'cashier'} args.actorRole
 * @param {string|null} [args.notes]
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number }>}
 */
export async function confirmWinCredit({
  playerId,
  amount,
  relatedDocId = null,
  actorId,
  actorRole,
  notes = null,
}) {
  return wrapWalletErrors('confirmWinCredit', async () => {
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(playerId), Player)

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'winCredit',
        amount,
        method: null,
        reference: null,
        relatedDocId,
        actorId,
        actorRole,
        timestamp,
        notes,
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: player.walletBalance + amount,
        updatedAt: timestamp,
      })

      return { walletTransactionId, newBalance: player.walletBalance + amount }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.winCredit',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: { walletTransactionId, amount, relatedDocId },
    })

    return result
  })
}

/**
 * Cashier-confirms a tournament payout row (task 4.7): in ONE transaction,
 * set the entry's cashWinnings to the actually-paid amount, stamp
 * winningsPaidAt, link winningsWalletTransactionId, write the winCredit
 * walletTransactions row (relatedDocId = the entry id), and credit the
 * player's wallet balance. One confirm per row, no bulk auto-credit (per
 * wallet-design Q4). Idempotent by construction: winningsPaidAt is re-read
 * inside the transaction, so a second confirm — even racing the first —
 * is refused.
 *
 * Role gate: cashier + manager only (the payout SCREEN is broader, but the
 * money action is the cashier's — enforced here, mirroring completeWithdrawal).
 *
 * @param {object} args
 * @param {string} args.tournamentId
 * @param {string} args.entryId
 * @param {number} args.amount     the payable amount being paid (integer cents, > 0) —
 *                                 the staged deal amount or the calculated table amount
 * @param {string} args.actorId
 * @param {'manager'|'cashier'} args.actorRole
 * @param {string|null} [args.notes]
 *
 * @returns {Promise<{ walletTransactionId: string, playerId: string, newBalance: number }>}
 */
export async function confirmEntryWinCredit({
  tournamentId,
  entryId,
  amount,
  actorId,
  actorRole,
  notes = null,
}) {
  return wrapWalletErrors('confirmEntryWinCredit', async () => {
    if (actorRole !== 'cashier' && actorRole !== 'manager') {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'cashier or manager',
        action: 'confirming a winnings payout',
      })
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`amount must be integer cents > 0 (got ${amount})`)
    }

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const entry = await tx.get(paths.entryPath(tournamentId, entryId), Entry)
      if (entry.voidedAt !== null) {
        throw new Error(`entry ${entryId} is voided — there is nothing to pay out`)
      }
      if (entry.winningsPaidAt !== null) {
        throw new Error(
          `entry ${entryId} winnings are already paid (winningsPaidAt is set). Cannot confirm twice.`
        )
      }

      const player = await tx.get(paths.playerPath(entry.playerId), Player)

      tx.set(paths.walletTransactionPath(entry.playerId, walletTransactionId), WalletTransaction, {
        playerId: entry.playerId,
        type: 'winCredit',
        amount,
        method: null,
        reference: null,
        relatedDocId: entryId,
        actorId,
        actorRole,
        timestamp,
        notes,
      })

      tx.update(paths.playerPath(entry.playerId), {
        walletBalance: player.walletBalance + amount,
        updatedAt: timestamp,
      })

      // cashWinnings is set to what was ACTUALLY paid (idempotent-ensure: a
      // staged deal amount is usually already equal; a calculator-confirmed row
      // gets it recorded here). Full-doc set so the entry re-validates whole.
      tx.set(paths.entryPath(tournamentId, entryId), Entry, {
        ...entry,
        cashWinnings: amount,
        winningsPaidAt: timestamp,
        winningsWalletTransactionId: walletTransactionId,
        updatedAt: timestamp,
      })

      return {
        walletTransactionId,
        playerId: entry.playerId,
        newBalance: player.walletBalance + amount,
      }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.winCredit',
      targetType: 'player',
      targetId: result.playerId,
      timestamp,
      metadata: {
        walletTransactionId: result.walletTransactionId,
        amount,
        relatedDocId: entryId,
        tournamentId,
        source: 'tournamentPayout',
      },
    })

    return result
  })
}

/**
 * Cashier-confirms a satellite ticket win (task 4.7, ticket half): in ONE
 * transaction, create the wallet-side ticket (face value = the entry's
 * ticketWinnings, recorded at the milestone exit), stamp ticketIssuedAt +
 * issuedTicketId on the entry, and credit the player's ticketBalance. No
 * auto-issue at the table (per wallet-design Q4's no-auto-credit principle) —
 * this confirm IS the issuance.
 *
 * The ticket doc replicates issueTicket's exact writes (ticket doc + player
 * ticketBalance) inside this transaction — issueTicket opens its own
 * transaction and can't be nested, and the entry stamp must be atomic with the
 * ticket creation or a crash between them would double-issue on retry.
 * Idempotent by construction: ticketIssuedAt is re-read inside the
 * transaction, so a second confirm — even racing the first — is refused
 * (TicketAlreadyIssuedError).
 *
 * Role gate: cashier + manager only, mirroring confirmEntryWinCredit.
 *
 * @param {object} args
 * @param {string} args.tournamentId
 * @param {string} args.entryId
 * @param {string} args.actorId
 * @param {'manager'|'cashier'} args.actorRole
 *
 * @returns {Promise<{ ticketId: string, playerId: string, faceValue: number, newTicketBalance: number }>}
 */
export async function confirmEntryTicketWin({ tournamentId, entryId, actorId, actorRole }) {
  return wrapWalletErrors('confirmEntryTicketWin', async () => {
    if (actorRole !== 'cashier' && actorRole !== 'manager') {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'cashier or manager',
        action: 'issuing a satellite ticket win',
      })
    }

    const ticketId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const entry = await tx.get(paths.entryPath(tournamentId, entryId), Entry)
      if (entry.voidedAt !== null) {
        throw new Error(`entry ${entryId} is voided — there is no ticket win to issue`)
      }
      if (entry.ticketIssuedAt !== null) {
        throw new TicketAlreadyIssuedError({ entryId, issuedTicketId: entry.issuedTicketId })
      }
      const faceValue = entry.ticketWinnings
      if (!Number.isInteger(faceValue) || faceValue <= 0) {
        throw new Error(
          `entry ${entryId} has no ticket winnings recorded (ticketWinnings=${faceValue})`
        )
      }

      const player = await tx.get(paths.playerPath(entry.playerId), Player)

      // The ticket doc — same shape/semantics as issueTicket's write.
      tx.set(paths.ticketPath(entry.playerId, ticketId), Ticket, {
        playerId: entry.playerId,
        faceValue,
        state: 'unused',
        issuedAt: timestamp,
        issuedReason: 'satelliteWin',
        issuedFromTournamentId: tournamentId,
        usedAt: null,
        usedOnEntryId: null,
        usedOnTournamentId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      // ticketBalance credit — same as issueTicket's player update.
      tx.update(paths.playerPath(entry.playerId), {
        ticketBalance: player.ticketBalance + faceValue,
        updatedAt: timestamp,
      })

      // Idempotency stamp + two-way trace. Full-doc set so the entry
      // re-validates whole (both-or-neither invariant included).
      tx.set(paths.entryPath(tournamentId, entryId), Entry, {
        ...entry,
        ticketIssuedAt: timestamp,
        issuedTicketId: ticketId,
        updatedAt: timestamp,
      })

      return {
        ticketId,
        playerId: entry.playerId,
        faceValue,
        newTicketBalance: player.ticketBalance + faceValue,
      }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.ticketIssued',
      targetType: 'ticket',
      targetId: result.ticketId,
      timestamp,
      metadata: {
        playerId: result.playerId,
        faceValue: result.faceValue,
        issuedReason: 'satelliteWin',
        issuedFromTournamentId: tournamentId,
        entryId,
        source: 'tournamentPayout',
      },
    })

    return result
  })
}

/**
 * Credit a Mystery Bounty win to the knocker's wallet. Also links the
 * bountyDraws doc to the winCredit walletTransactions row (so the bounty
 * payment can be traced both ways).
 *
 * @param {object} args
 * @param {string} args.tournamentId
 * @param {string} args.drawId
 * @param {string} args.playerId       the knocker (winning player)
 * @param {number} args.amount         the bounty value, integer cents
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 *
 * @returns {Promise<{ walletTransactionId: string, newBalance: number }>}
 */
export async function confirmBountyWinCredit({
  tournamentId,
  drawId,
  playerId,
  amount,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('confirmBountyWinCredit', async () => {
    if (amount <= 0) throw new Error(`amount must be > 0 (got ${amount})`)

    const walletTransactionId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const draw = await tx.get(paths.bountyDrawPath(tournamentId, drawId), BountyDraw)
      if (draw.walletTransactionId !== null) {
        throw new Error(
          `BountyDraw ${drawId} is already confirmed (walletTransactionId is set). ` +
          `Cannot confirm twice.`
        )
      }

      const player = await tx.get(paths.playerPath(playerId), Player)

      tx.set(paths.walletTransactionPath(playerId, walletTransactionId), WalletTransaction, {
        playerId,
        type: 'winCredit',
        amount,
        method: null,
        reference: null,
        relatedDocId: drawId,
        actorId,
        actorRole,
        timestamp,
        notes: 'bounty draw',
      })

      tx.update(paths.playerPath(playerId), {
        walletBalance: player.walletBalance + amount,
        updatedAt: timestamp,
      })

      tx.update(paths.bountyDrawPath(tournamentId, drawId), {
        walletTransactionId,
      })

      return { walletTransactionId, newBalance: player.walletBalance + amount }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.winCredit',
      targetType: 'player',
      targetId: playerId,
      timestamp,
      metadata: { walletTransactionId, amount, drawId, tournamentId, source: 'bounty' },
    })

    return result
  })
}
