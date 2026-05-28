// Typed CRUD + subscriptions for the `tournaments` top-level collection.

import { Tournament } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  subscribeToDoc,
  subscribeToCollection,
} from './_client'
import { tournamentPath, tournamentsCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getTournament(id) {
  return validatedGet(tournamentPath(id), Tournament)
}

export function listTournaments(queryFn) {
  return validatedGetMany(tournamentsCollectionPath(), Tournament, queryFn)
}

/** Create a new tournament. Generates a UUID if `data.id` is not set. */
export function createTournament(data) {
  const id = data.id ?? generateId()
  return validatedSet(tournamentPath(id), Tournament, { ...data, id })
}

/** Partial update. NOT validated against full schema — caller's responsibility. */
export function updateTournament(id, partialData) {
  return validatedUpdate(tournamentPath(id), partialData)
}

export function subscribeToTournament(id, onUpdate, onError) {
  return subscribeToDoc(tournamentPath(id), Tournament, onUpdate, onError)
}

export function subscribeToTournaments(onUpdate, queryFn, onError) {
  return subscribeToCollection(tournamentsCollectionPath(), Tournament, onUpdate, queryFn, onError)
}
