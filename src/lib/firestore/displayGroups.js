// Typed access to the `displayGroups` collection — sets of venue TVs that
// share one pick (see schema/displayScreen.js).

import { Timestamp } from 'firebase/firestore'
import { DisplayGroup } from '../schema'
import { subscribeToDoc, subscribeToCollection, validatedSet, validatedUpdate, runValidatedBatch } from './_client'
import { displayGroupPath, displayGroupsCollectionPath, displayScreenPath } from './_paths'
import { generateId } from './_ids'
import { planMoveScreen } from '../display'

/** Live single set. A missing doc surfaces as NotFoundError via onError. */
export function subscribeToDisplayGroup(id, onUpdate, onError = () => {}) {
  return subscribeToDoc(displayGroupPath(id), DisplayGroup, onUpdate, onError)
}

export function subscribeToDisplayGroups(onUpdate, onError = () => {}) {
  return subscribeToCollection(displayGroupsCollectionPath(), DisplayGroup, onUpdate, undefined, onError)
}

export function createDisplayGroup({ name }, actorId) {
  const now = Timestamp.now()
  const id = generateId()
  return validatedSet(displayGroupPath(id), DisplayGroup, {
    id,
    name,
    kind: 'tournament',
    tournamentId: null,
    screen: null,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  })
}

const GROUP_FIELDS = ['name', 'kind', 'tournamentId', 'screen']

export function updateDisplayGroup(id, patch, actorId) {
  const update = { updatedAt: Timestamp.now(), updatedBy: actorId }
  for (const k of GROUP_FIELDS) if (patch[k] !== undefined) update[k] = patch[k]
  return validatedUpdate(displayGroupPath(id), update)
}

/**
 * Remove a set. Its TVs leave it in the same atomic write, each keeping what
 * it was showing (planMoveScreen freezes the set's pick into the TV).
 */
export function deleteDisplayGroup(group, memberScreens, actorId) {
  const groupsById = { [group.id]: group }
  const now = Timestamp.now()
  return runValidatedBatch(({ update, delete: remove }) => {
    for (const s of memberScreens) {
      const patch = planMoveScreen(s, null, groupsById)
      if (patch) update(displayScreenPath(s.id), { ...patch, updatedAt: now, updatedBy: actorId })
    }
    remove(displayGroupPath(group.id))
  })
}
