// Typed CRUD + subscriptions for the `players` top-level collection.

import { Player } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  subscribeToDoc,
  subscribeToCollection,
} from './_client'
import { playerPath, playersCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getPlayer(id) {
  return validatedGet(playerPath(id), Player)
}

export function listPlayers(queryFn) {
  return validatedGetMany(playersCollectionPath(), Player, queryFn)
}

/** Create a new player. Generates a UUID if `data.id` is not set. */
export function createPlayer(data) {
  const id = data.id ?? generateId()
  return validatedSet(playerPath(id), Player, { ...data, id })
}

/**
 * Partial update. NOT validated against full schema.
 * IMPORTANT: do NOT use this to mutate walletBalance, ticketBalance, or
 * totalDeposited — those must be updated atomically with walletTransactions
 * writes inside a runValidatedTransaction. Direct updates risk drift.
 */
export function updatePlayer(id, partialData) {
  return validatedUpdate(playerPath(id), partialData)
}

export function subscribeToPlayer(id, onUpdate, onError) {
  return subscribeToDoc(playerPath(id), Player, onUpdate, onError)
}

export function subscribeToPlayers(onUpdate, queryFn, onError) {
  return subscribeToCollection(playersCollectionPath(), Player, onUpdate, queryFn, onError)
}
