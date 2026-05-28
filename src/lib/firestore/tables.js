// Typed CRUD + subscriptions for the `tournaments/{tid}/tables` subcollection.

import { Table } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  subscribeToCollection,
} from './_client'
import { tablePath, tablesCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getTable(tournamentId, tableId) {
  return validatedGet(tablePath(tournamentId, tableId), Table)
}

export function listTables(tournamentId, queryFn) {
  return validatedGetMany(tablesCollectionPath(tournamentId), Table, queryFn)
}

export function createTable(tournamentId, data) {
  const id = data.id ?? generateId()
  return validatedSet(tablePath(tournamentId, id), Table, { ...data, id, tournamentId })
}

/**
 * Partial update. Seat moves during balancing should use runValidatedTransaction
 * to update two tables atomically.
 */
export function updateTable(tournamentId, tableId, partialData) {
  return validatedUpdate(tablePath(tournamentId, tableId), partialData)
}

export function subscribeToTables(tournamentId, onUpdate, queryFn, onError) {
  return subscribeToCollection(
    tablesCollectionPath(tournamentId),
    Table,
    onUpdate,
    queryFn,
    onError
  )
}
