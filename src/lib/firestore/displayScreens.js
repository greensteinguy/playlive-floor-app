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

export function createDisplayScreen({ id, name, groupId = null }, actorId) {
  const now = Timestamp.now()
  return validatedSet(displayScreenPath(id), DisplayScreen, {
    id,
    name,
    tournamentId: null,
    screen: null,
    groupId,
    followGroup: true,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  })
}

const SCREEN_FIELDS = ['name', 'tournamentId', 'screen', 'groupId', 'followGroup']

/**
 * Change a screen's label, pick or set membership. Build set moves and
 * overrides with planMoveScreen / planScreenOverride (lib/display.js) so the
 * TV never jumps unexpectedly.
 */
export function updateDisplayScreen(id, patch, actorId) {
  const update = { updatedAt: Timestamp.now(), updatedBy: actorId }
  for (const k of SCREEN_FIELDS) if (patch[k] !== undefined) update[k] = patch[k]
  return validatedUpdate(displayScreenPath(id), update)
}

export function deleteDisplayScreen(id) {
  return validatedDelete(displayScreenPath(id))
}
