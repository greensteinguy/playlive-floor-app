// Player merge — combine a "source" duplicate record into a "target" canonical
// record. Lives outside the wallet module because the operation is a
// player-domain action that happens to touch balances; the wallet module's
// helpers are designed for everyday money flows, not one-off identity surgery.
//
// What it does, in one transaction:
//   1. Refuses if source.isMerged (can't double-merge) or target.isMerged.
//   2. Refuses if sourceId === targetId.
//   3. Refuses if source has active (non-busted, non-voided) entries.
//      (Settle them first — see canonical-schema.md §3.2.)
//   4. Refuses if source has pending withdrawalRequests.
//      (Cancel them first — see canonical-schema.md §3.3.)
//   5. Moves every UNUSED ticket from /players/source/tickets/* to
//      /players/target/tickets/* (re-keyed playerId). Used tickets stay
//      attached to source for audit history.
//   6. Adds source.walletBalance + ticketBalance + totalDeposited to target.
//   7. Zeros source's balances and sets isMerged=true, mergedIntoId=target,
//      mergedAt=now.
//   8. Writes a `player.merged` auditLog entry after commit.
//
// Source's walletTransactions subcollection is left in place — historical
// truth for "what happened under the old player id" stays attached to that
// id. Queries that need the union should follow `mergedIntoId`.
//
// Phase 1 v1: no un-merge. Once merged, source is permanently tagged. The
// UI requires manager confirmation (type "MERGE") before invoking this.

import {
  runValidatedTransaction,
  auditLog,
  paths,
  entries,
  withdrawalRequests,
  tickets,
} from '../firestore'
import { Player, Ticket } from '../schema'
import { now } from '../wallet/_shared'
import {
  PlayerMergeError,
  AlreadyMergedError,
  SameSourceAndTargetError,
  ActiveEntriesError,
  PendingWithdrawalsError,
} from './errors'

/**
 * Merge `sourceId` into `targetId`.
 *
 * @param {object} args
 * @param {string} args.sourceId    — the duplicate to deprecate
 * @param {string} args.targetId    — the canonical record to keep
 * @param {string} args.actorId     — manager performing the merge
 * @param {'manager'} args.actorRole — must be 'manager'; enforced at the UI
 *                                     and Firestore rules layers
 *
 * @returns {Promise<{
 *   transferred: {
 *     walletBalance: number,
 *     ticketBalance: number,
 *     totalDeposited: number,
 *     ticketsMoved: number,
 *   }
 * }>}
 */
export async function mergePlayer({ sourceId, targetId, actorId, actorRole }) {
  if (typeof sourceId !== 'string' || sourceId.trim() === '') {
    throw new PlayerMergeError('sourceId is required (non-empty string)')
  }
  if (typeof targetId !== 'string' || targetId.trim() === '') {
    throw new PlayerMergeError('targetId is required (non-empty string)')
  }
  if (sourceId === targetId) {
    throw new SameSourceAndTargetError(sourceId)
  }

  // ── Pre-transaction safety checks (collection-group queries can't run
  //    inside a Firestore transaction, so we check before commit. There's a
  //    narrow race window where a new entry/withdrawal could be created
  //    between this check and commit — acceptable for venue ops where merges
  //    are a deliberate, low-frequency manager action.)

  const allEntries = await entries.listEntriesByPlayer(sourceId)
  const activeEntries = allEntries.filter((e) => e.bustedAt === null && e.voidedAt === null)
  if (activeEntries.length > 0) {
    throw new ActiveEntriesError({
      sourceId,
      count: activeEntries.length,
      sampleEntryId: activeEntries[0].id,
    })
  }

  const allWithdrawals = await withdrawalRequests.listWithdrawalRequests(
    // Inline a filter rather than depending on the wrappers exposing a "by
    // player + state" helper — this is a one-off shape used only here.
    undefined
  )
  const pendingForSource = allWithdrawals.filter(
    (w) => w.playerId === sourceId && w.state === 'pending'
  )
  if (pendingForSource.length > 0) {
    throw new PendingWithdrawalsError({
      sourceId,
      count: pendingForSource.length,
      sampleRequestId: pendingForSource[0].id,
    })
  }

  // List unused ticket IDs to move. We re-read each ticket inside the
  // transaction to confirm it's still unused (a ticket used between this
  // query and the commit is dropped from the transfer list — not an error,
  // just no longer movable).
  const sourceTickets = await tickets.listTickets(sourceId)
  const unusedTicketIds = sourceTickets.filter((t) => t.state === 'unused').map((t) => t.id)

  const timestamp = now()

  const result = await runValidatedTransaction(async (tx) => {
    // Reads first.
    const source = await tx.get(paths.playerPath(sourceId), Player)
    if (source.isMerged) {
      throw new AlreadyMergedError({ playerId: sourceId, mergedIntoId: source.mergedIntoId })
    }
    const target = await tx.get(paths.playerPath(targetId), Player)
    if (target.isMerged) {
      throw new AlreadyMergedError({ playerId: targetId, mergedIntoId: target.mergedIntoId })
    }

    const ticketsToMove = []
    for (const ticketId of unusedTicketIds) {
      const ticket = await tx.get(paths.ticketPath(sourceId, ticketId), Ticket)
      if (ticket.state === 'unused') {
        ticketsToMove.push(ticket)
      }
    }

    // Writes.
    // 1. Move every still-unused ticket onto the target.
    for (const t of ticketsToMove) {
      tx.set(paths.ticketPath(targetId, t.id), Ticket, {
        ...t,
        playerId: targetId,
        updatedAt: timestamp,
      })
      tx.delete(paths.ticketPath(sourceId, t.id))
    }

    // 2. Accumulate balances onto target.
    tx.update(paths.playerPath(targetId), {
      walletBalance:  target.walletBalance  + source.walletBalance,
      ticketBalance:  target.ticketBalance  + source.ticketBalance,
      totalDeposited: target.totalDeposited + source.totalDeposited,
      updatedAt: timestamp,
    })

    // 3. Mark source as merged and zero its balances. walletTransactions stay
    //    attached to source — historical audit trail.
    tx.update(paths.playerPath(sourceId), {
      isMerged: true,
      mergedIntoId: targetId,
      mergedAt: timestamp,
      walletBalance: 0,
      ticketBalance: 0,
      updatedAt: timestamp,
    })

    return {
      transferred: {
        walletBalance: source.walletBalance,
        ticketBalance: source.ticketBalance,
        totalDeposited: source.totalDeposited,
        ticketsMoved: ticketsToMove.length,
      },
    }
  })

  // Best-effort audit entry after commit. Skip-on-failure matches the rest of
  // the app — a missed audit row shouldn't undo a successful merge.
  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'player.merged',
    targetType: 'player',
    targetId,
    timestamp,
    metadata: {
      sourceId,
      mergedIntoId: targetId,
      ...result.transferred,
    },
  })

  return result
}
