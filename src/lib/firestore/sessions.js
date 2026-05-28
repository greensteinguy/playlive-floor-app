// Typed CRUD + subscriptions for the `tournaments/{tid}/sessions` subcollection.

import { Session } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  subscribeToDoc,
  subscribeToCollection,
} from './_client'
import { sessionPath, sessionsCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getSession(tournamentId, sessionId) {
  return validatedGet(sessionPath(tournamentId, sessionId), Session)
}

export function listSessions(tournamentId, queryFn) {
  return validatedGetMany(sessionsCollectionPath(tournamentId), Session, queryFn)
}

/**
 * Create a session. Generates a UUID if `data.id` is not set.
 * Typically called inside runValidatedBatch when setting up a multi-day
 * tournament — see canonical-schema.md §5.1 for the chicken-and-egg solution
 * (all sessions written atomically with client-side UUIDs).
 */
export function createSession(tournamentId, data) {
  const id = data.id ?? generateId()
  return validatedSet(sessionPath(tournamentId, id), Session, { ...data, id })
}

export function updateSession(tournamentId, sessionId, partialData) {
  return validatedUpdate(sessionPath(tournamentId, sessionId), partialData)
}

export function subscribeToSession(tournamentId, sessionId, onUpdate, onError) {
  return subscribeToDoc(sessionPath(tournamentId, sessionId), Session, onUpdate, onError)
}

export function subscribeToSessions(tournamentId, onUpdate, queryFn, onError) {
  return subscribeToCollection(
    sessionsCollectionPath(tournamentId),
    Session,
    onUpdate,
    queryFn,
    onError
  )
}
