// Typed access to the `displayScreens` collection — the venue's named TVs.
// A TV subscribes to its own doc; the TV screens admin page subscribes to the
// whole (small) collection.

import { Timestamp } from 'firebase/firestore'
import { DisplayScreen } from '../schema'
import { subscribeToDoc, subscribeToCollection, validatedSet, validatedUpdate, validatedDelete } from './_client'
import { displayScreenPath, displayScreensCollectionPath } from './_paths'

/** Live single screen. A missing doc surfaces as NotFoundError via onError. */
export function subscribeToDisplayScreen(id, onUpdate, onError = () => {}) {
  return subscribeToDoc(displayScreenPath(id), DisplayScreen, onUpdate, onError)
}

export function subscribeToDisplayScreens(onUpdate, onError = () => {}) {
  return subscribeToCollection(displayScreensCollectionPath(), DisplayScreen, onUpdate, undefined, onError)
}

export function createDisplayScreen({ id, name }, actorId) {
  const now = Timestamp.now()
  return validatedSet(displayScreenPath(id), DisplayScreen, {
    id,
    name,
    tournamentId: null,
    screen: null,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  })
}

/** Change what a screen shows (and/or its label). */
export function updateDisplayScreen(id, { name, tournamentId, screen }, actorId) {
  const patch = { updatedAt: Timestamp.now(), updatedBy: actorId }
  if (name !== undefined) patch.name = name
  if (tournamentId !== undefined) patch.tournamentId = tournamentId
  if (screen !== undefined) patch.screen = screen
  return validatedUpdate(displayScreenPath(id), patch)
}

export function deleteDisplayScreen(id) {
  return validatedDelete(displayScreenPath(id))
}
