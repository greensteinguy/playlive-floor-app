// Typed CRUD + subscriptions for the `registrationRequests` top-level
// collection (Phase 6.2). Requests are CREATED only by the registerSelf
// Cloud Function; the desk resolves them here (confirm after registering the
// player through the normal flow, or cancel with a reason).

import { RegistrationRequest } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedUpdate,
  subscribeToCollection,
} from './_client'
import { registrationRequestPath, registrationRequestsCollectionPath } from './_paths'

export function getRegistrationRequest(id) {
  return validatedGet(registrationRequestPath(id), RegistrationRequest)
}

export function listRegistrationRequests(queryFn) {
  return validatedGetMany(registrationRequestsCollectionPath(), RegistrationRequest, queryFn)
}

/** Partial update — desk resolution (confirm / cancel) only. */
export function updateRegistrationRequest(id, partialData) {
  return validatedUpdate(registrationRequestPath(id), partialData)
}

export function subscribeToRegistrationRequests(onUpdate, queryFn, onError) {
  return subscribeToCollection(
    registrationRequestsCollectionPath(),
    RegistrationRequest,
    onUpdate,
    queryFn,
    onError
  )
}
