// Typed CRUD + subscriptions for the `tournaments/{tid}/entries` subcollection.
//
// For cross-tournament queries like "all entries by player X" use a Firestore
// collection group query against the 'entries' collection group (see
// canonical-schema.md §7 — index needed on playerId + registeredAt). Helper
// for that lives below.

import { collectionGroup, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db, USE_MOCK_DATA, USE_EMULATOR } from '../../firebase/config'
import { Entry } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  subscribeToCollection,
} from './_client'
import { entryPath, entriesCollectionPath, ENTRIES } from './_paths'
import { generateId } from './_ids'
import { MockModeError, ValidationError } from './_errors'

export function getEntry(tournamentId, entryId) {
  return validatedGet(entryPath(tournamentId, entryId), Entry)
}

export function listEntries(tournamentId, queryFn) {
  return validatedGetMany(entriesCollectionPath(tournamentId), Entry, queryFn)
}

/**
 * Create an entry. Typically called inside runValidatedTransaction so that the
 * entry write and the wallet/ticket writes succeed atomically together.
 */
export function createEntry(tournamentId, data) {
  const id = data.id ?? generateId()
  return validatedSet(entryPath(tournamentId, id), Entry, { ...data, id, tournamentId })
}

export function updateEntry(tournamentId, entryId, partialData) {
  return validatedUpdate(entryPath(tournamentId, entryId), partialData)
}

export function subscribeToEntries(tournamentId, onUpdate, queryFn, onError) {
  return subscribeToCollection(
    entriesCollectionPath(tournamentId),
    Entry,
    onUpdate,
    queryFn,
    onError
  )
}

/**
 * Collection group query: all entries by a specific player across every
 * tournament. Returns entries sorted by registration time (newest first).
 *
 * Requires the composite index on entries.playerId + entries.registeredAt
 * (called out in canonical-schema.md §7).
 */
export async function listEntriesByPlayer(playerId) {
  if (USE_MOCK_DATA && !USE_EMULATOR) throw new MockModeError()
  const q = query(
    collectionGroup(db, ENTRIES),
    where('playerId', '==', playerId),
    orderBy('registeredAt', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map((docSnap) => {
    const data = { id: docSnap.id, ...docSnap.data() }
    const result = Entry.safeParse(data)
    if (!result.success) {
      throw new ValidationError(docSnap.ref.path, result.error, 'read')
    }
    return result.data
  })
}
