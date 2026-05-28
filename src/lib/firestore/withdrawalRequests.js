// Typed CRUD + subscriptions for the `withdrawalRequests` top-level collection.
//
// Note: the two-step pattern (Cashier creates, Manager completes) is enforced
// by the wallet module (Phase 1 task 1.7), not here. This file is just the
// data-access primitives.

import { WithdrawalRequest } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
  subscribeToDoc,
  subscribeToCollection,
} from './_client'
import { withdrawalRequestPath, withdrawalRequestsCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getWithdrawalRequest(id) {
  return validatedGet(withdrawalRequestPath(id), WithdrawalRequest)
}

export function listWithdrawalRequests(queryFn) {
  return validatedGetMany(withdrawalRequestsCollectionPath(), WithdrawalRequest, queryFn)
}

/** Create a new withdrawal request. Generates a UUID if `data.id` is not set. */
export function createWithdrawalRequest(data) {
  const id = data.id ?? generateId()
  return validatedSet(withdrawalRequestPath(id), WithdrawalRequest, { ...data, id })
}

/**
 * Partial update. State transitions (pending → completed, pending → cancelled)
 * should go through the wallet module so the atomic walletTransaction write
 * happens in the same transaction.
 */
export function updateWithdrawalRequest(id, partialData) {
  return validatedUpdate(withdrawalRequestPath(id), partialData)
}

export function subscribeToWithdrawalRequest(id, onUpdate, onError) {
  return subscribeToDoc(withdrawalRequestPath(id), WithdrawalRequest, onUpdate, onError)
}

export function subscribeToWithdrawalRequests(onUpdate, queryFn, onError) {
  return subscribeToCollection(
    withdrawalRequestsCollectionPath(),
    WithdrawalRequest,
    onUpdate,
    queryFn,
    onError
  )
}
