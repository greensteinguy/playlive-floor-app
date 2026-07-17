// Voiding a mistaken tournament entry — the recovery path for a wrong buy-in
// (wrong player, wrong tournament, changed mind before cards in the air).
//
// Void + refund are ONE transaction: the entry can never be voided without its
// payment being reversed, and a refund can never exist against a live entry.
// What "refund" means follows the original payment method:
//   - wallet: the wallet balance is credited back (entryRefund row, method
//     'wallet' — walletTxDelta counts it).
//   - cash / eftpos: the till / EFTPOS terminal pays the money back EXTERNALLY
//     (this app records, never moves, money — SOW §3.4). The entryRefund row
//     documents it and reconciliation nets it against the day's takings.
//   - ticket: the ticket is reinstated (state back to 'unused', ticketBalance
//     restored) and any cash/EFTPOS top-up is refunded as a second row.
//
// Idempotent: voidedAt is re-read inside the transaction. A retry of the same
// gesture (same actor + reason) replays as success; a different gesture hitting
// an already-voided entry is refused (EntryAlreadyVoidedError).

import { runValidatedTransaction, generateId, auditLog, paths, entries as entriesApi, walletTransactions as walletTxApi } from '../firestore'
import { Player, Entry, WalletTransaction, Ticket, Table } from '../schema'
import { now, wrapWalletErrors } from './_shared'
import {
  RoleNotAuthorizedError,
  EntryAlreadyVoidedError,
  EntryNotVoidableError,
} from './errors'

/**
 * Void an entry and reverse its payment, atomically.
 *
 * Refused (EntryNotVoidableError) when the entry is busted (undo the
 * elimination first — a void erases the buy-in, not the result) or when money
 * has already flowed OUT of the entry (winnings paid / ticket issued / staged
 * winnings / bounty earnings / settled last-longer win) — those must be undone
 * through their own flows first.
 *
 * @param {object} args
 * @param {string} args.tournamentId
 * @param {string} args.entryId
 * @param {string} args.reason        required — shown in the ledger + audit trail
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 *
 * @returns {Promise<{
 *   refunds: Array<{ walletTransactionId: string, method: string, amount: number }>,
 *   ticketReinstatedId: string|null,
 *   alreadyVoided?: true,
 * }>}
 */
export async function voidEntryWithRefund({ tournamentId, entryId, reason, actorId, actorRole }) {
  return wrapWalletErrors('voidEntryWithRefund', async () => {
    if (typeof actorId !== 'string' || actorId.trim() === '') {
      throw new Error('actorId is required (non-empty string)')
    }
    if (!['manager', 'td', 'cashier'].includes(actorRole)) {
      throw new RoleNotAuthorizedError({
        actorRole,
        requiredRole: 'manager, td or cashier',
        action: 'voiding an entry',
      })
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('a void reason is required')
    }

    // Pre-transaction snapshot: which payment shape are we reversing? The
    // transaction re-reads everything fresh; this only locates the docs a
    // ticket-paid entry needs (a collection query can't run inside a
    // transaction, so the top-up row is found here and re-read by id inside).
    const snapshot = await entriesApi.getEntry(tournamentId, entryId)
    let topUpRowId = null
    if (snapshot.paymentMethod === 'ticket') {
      const rows = await walletTxApi.listWalletTransactions(snapshot.playerId)
      const topUp = rows.find(
        (r) => r.type === 'spend' && r.relatedDocId === entryId && r.method !== 'ticket'
      )
      topUpRowId = topUp?.id ?? null
    }

    // Refund row ids generated BEFORE the transaction so Firestore's internal
    // retries can't mint duplicates.
    const refundIds = [generateId(), generateId()]
    const timestamp = now()

    const result = await runValidatedTransaction(async (tx) => {
      // ── Reads (all before any write) ────────────────────────────────────
      const fresh = await tx.get(paths.entryPath(tournamentId, entryId), Entry)

      if (fresh.voidedAt !== null) {
        if (fresh.voidedBy === actorId && fresh.voidReason === reason) {
          // Same gesture retried after a write timeout — the void committed.
          return { refunds: [], ticketReinstatedId: null, alreadyVoided: true }
        }
        throw new EntryAlreadyVoidedError({ entryId })
      }
      if (fresh.bustedAt !== null) {
        throw new EntryNotVoidableError({
          entryId,
          reason:
            'the player has busted out — undo the elimination first if this whole entry was a mistake',
        })
      }
      if (fresh.winningsPaidAt !== null || fresh.ticketIssuedAt !== null) {
        throw new EntryNotVoidableError({
          entryId,
          reason: 'winnings have already been paid out on this entry',
        })
      }
      if ((fresh.cashWinnings ?? 0) > 0 || (fresh.ticketWinnings ?? 0) > 0) {
        throw new EntryNotVoidableError({
          entryId,
          reason: 'winnings are staged on this entry — clear them first',
        })
      }
      if ((fresh.bountyEarnings ?? 0) > 0 || (fresh.bountiesKnockoutCount ?? 0) > 0) {
        throw new EntryNotVoidableError({
          entryId,
          reason: 'bounty earnings are recorded on this entry',
        })
      }
      if (fresh.isLastLongerWinner) {
        throw new EntryNotVoidableError({
          entryId,
          reason: 'this entry is a settled last-longer winner — unsettle it first',
        })
      }

      const player = await tx.get(paths.playerPath(fresh.playerId), Player)

      let table = null
      if (fresh.currentTableId) {
        table = await tx.get(paths.tablePath(tournamentId, fresh.currentTableId), Table)
      }

      // Plan the refund rows from the fresh entry.
      const planned = [] // { method, amount }
      let walletCredit = 0
      let ticket = null
      let topUpRow = null

      if (fresh.paymentMethod === 'wallet') {
        planned.push({ method: 'wallet', amount: fresh.paymentAmount })
        walletCredit = fresh.paymentAmount
      } else if (fresh.paymentMethod === 'cash' || fresh.paymentMethod === 'eftpos') {
        planned.push({ method: fresh.paymentMethod, amount: fresh.paymentAmount })
      } else if (fresh.paymentMethod === 'ticket') {
        // paymentReference holds the redeemed ticket's id (payViaTicket).
        ticket = await tx.get(paths.ticketPath(fresh.playerId, fresh.paymentReference), Ticket)
        if (ticket.state !== 'used' || ticket.usedOnEntryId !== entryId) {
          throw new EntryNotVoidableError({
            entryId,
            reason:
              'its ticket cannot be safely reinstated (it is not marked as used on this entry) — resolve the ticket manually',
          })
        }
        planned.push({ method: 'ticket', amount: Math.min(ticket.faceValue, fresh.paymentAmount) })
        if (topUpRowId) {
          topUpRow = await tx.get(
            paths.walletTransactionPath(fresh.playerId, topUpRowId),
            WalletTransaction
          )
          if (topUpRow.amount > 0) {
            planned.push({ method: topUpRow.method, amount: topUpRow.amount })
          }
        }
        // A below-face-value manager override has no top-up row — the venue
        // absorbed the shortfall, so reinstating the ticket is the whole refund.
      }

      // ── Writes ──────────────────────────────────────────────────────────
      const refunds = planned.map((p, i) => {
        const id = refundIds[i]
        tx.set(paths.walletTransactionPath(fresh.playerId, id), WalletTransaction, {
          playerId: fresh.playerId,
          type: 'entryRefund',
          amount: p.amount,
          method: p.method,
          reference: null,
          relatedDocId: entryId,
          actorId,
          actorRole,
          timestamp,
          notes: reason,
        })
        return { walletTransactionId: id, method: p.method, amount: p.amount }
      })

      const playerUpdate = { updatedAt: timestamp }
      if (walletCredit > 0) playerUpdate.walletBalance = player.walletBalance + walletCredit
      if (ticket) playerUpdate.ticketBalance = player.ticketBalance + ticket.faceValue
      if (walletCredit > 0 || ticket) {
        tx.update(paths.playerPath(fresh.playerId), playerUpdate)
      }

      if (ticket) {
        tx.update(paths.ticketPath(fresh.playerId, ticket.id), {
          state: 'unused',
          usedAt: null,
          usedOnEntryId: null,
          usedOnTournamentId: null,
          updatedAt: timestamp,
        })
      }

      if (table) {
        tx.set(paths.tablePath(tournamentId, table.id), Table, {
          ...table,
          seats: table.seats.map((s) => (s.entryId === fresh.id ? { ...s, entryId: null } : s)),
          updatedAt: timestamp,
        })
      }

      // Full-doc set so the whole entry re-validates (void triple set together,
      // seat fields cleared).
      tx.set(paths.entryPath(tournamentId, entryId), Entry, {
        ...fresh,
        currentTableId: null,
        currentSeatNumber: null,
        voidedAt: timestamp,
        voidedBy: actorId,
        voidReason: reason,
        updatedAt: timestamp,
      })

      return { refunds, ticketReinstatedId: ticket ? ticket.id : null }
    })

    if (result.alreadyVoided) return result

    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'entry.voided',
      targetType: 'entry',
      targetId: entryId,
      timestamp,
      metadata: {
        tournamentId,
        reason,
        refunds: result.refunds.map(({ method, amount }) => ({ method, amount })),
        ticketReinstatedId: result.ticketReinstatedId,
      },
    })

    return result
  })
}
