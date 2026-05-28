// Ticket issuance. (Ticket USE happens in payment.payViaTicket.)
//
// Tickets are issued for satellite wins, comps, or imported as part of the
// migration (issuedReason='openingBalance' / similar).

import {
  runValidatedTransaction,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Player, Ticket } from '../schema'
import { now, wrapWalletErrors } from './_shared'

/**
 * Issue a new ticket to a player. Atomically credits the player's ticketBalance.
 *
 * @param {object} args
 * @param {string} args.playerId
 * @param {number} args.faceValue           integer cents, > 0
 * @param {string|null} [args.issuedReason] e.g. 'satelliteWin', 'comp', 'openingBalance'
 * @param {string|null} [args.issuedFromTournamentId]  set when the ticket was won in a satellite
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'|'system'} args.actorRole
 *
 * @returns {Promise<{ ticketId: string, newTicketBalance: number }>}
 */
export async function issueTicket({
  playerId,
  faceValue,
  issuedReason = null,
  issuedFromTournamentId = null,
  actorId,
  actorRole,
}) {
  return wrapWalletErrors('issueTicket', async () => {
    if (faceValue <= 0) throw new Error(`faceValue must be > 0 (got ${faceValue})`)

    const ticketId = generateId()
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      const player = await tx.get(paths.playerPath(playerId), Player)

      tx.set(paths.ticketPath(playerId, ticketId), Ticket, {
        playerId,
        faceValue,
        state: 'unused',
        issuedAt: timestamp,
        issuedReason,
        issuedFromTournamentId,
        usedAt: null,
        usedOnEntryId: null,
        usedOnTournamentId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      tx.update(paths.playerPath(playerId), {
        ticketBalance: player.ticketBalance + faceValue,
        updatedAt: timestamp,
      })

      return { ticketId, newTicketBalance: player.ticketBalance + faceValue }
    })

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'wallet.ticketIssued',
      targetType: 'ticket',
      targetId: ticketId,
      timestamp,
      metadata: { playerId, faceValue, issuedReason, issuedFromTournamentId },
    })

    return result
  })
}
