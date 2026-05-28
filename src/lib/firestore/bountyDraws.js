// Typed CRUD for the `tournaments/{tid}/bountyDraws` subcollection.

import { BountyDraw } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  subscribeToCollection,
} from './_client'
import { bountyDrawPath, bountyDrawsCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getBountyDraw(tournamentId, drawId) {
  return validatedGet(bountyDrawPath(tournamentId, drawId), BountyDraw)
}

export function listBountyDraws(tournamentId, queryFn) {
  return validatedGetMany(bountyDrawsCollectionPath(tournamentId), BountyDraw, queryFn)
}

/**
 * Record a bounty draw. Typically called by the Mystery Bounty UI on each
 * knockout. The walletTransactionId remains null until the cashier confirms
 * the win-credit (per wallet-design.md Q4 — no auto-credit). At that point,
 * the wallet module updates the bountyDraw to set walletTransactionId and
 * writes the corresponding winCredit walletTransaction atomically.
 */
export function createBountyDraw(tournamentId, data) {
  const id = data.id ?? generateId()
  return validatedSet(bountyDrawPath(tournamentId, id), BountyDraw, {
    ...data,
    id,
    tournamentId,
  })
}

export function updateBountyDraw(tournamentId, drawId, partialData) {
  return validatedUpdate(bountyDrawPath(tournamentId, drawId), partialData)
}

export function subscribeToBountyDraws(tournamentId, onUpdate, queryFn, onError) {
  return subscribeToCollection(
    bountyDrawsCollectionPath(tournamentId),
    BountyDraw,
    onUpdate,
    queryFn,
    onError
  )
}
