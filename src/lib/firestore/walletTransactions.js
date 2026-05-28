// Typed access for the `players/{pid}/walletTransactions` subcollection.
//
// **You almost never call these directly from app code.** The wallet module
// (Phase 1 task 1.7) is the only safe writer — it wraps every walletTransaction
// write inside a runValidatedTransaction that also updates the player's cached
// balance atomically. Bypassing the wallet module risks drift between the
// ledger and the cached `players/{pid}.walletBalance`.
//
// Read helpers below are safe to use directly (for ledger view, daily
// reconciliation, etc.).

import { collectionGroup, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db, USE_MOCK_DATA, USE_EMULATOR } from '../../firebase/config'
import { WalletTransaction } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  subscribeToCollection,
} from './_client'
import {
  walletTransactionPath,
  walletTransactionsCollectionPath,
  WALLET_TRANSACTIONS,
} from './_paths'
import { MockModeError, ValidationError } from './_errors'

export function getWalletTransaction(playerId, txId) {
  return validatedGet(walletTransactionPath(playerId, txId), WalletTransaction)
}

/**
 * List a single player's wallet transactions. Use queryFn to add ordering
 * (typically orderBy('timestamp', 'desc')) and limits for paginated ledger views.
 */
export function listWalletTransactions(playerId, queryFn) {
  return validatedGetMany(walletTransactionsCollectionPath(playerId), WalletTransaction, queryFn)
}

export function subscribeToWalletTransactions(playerId, onUpdate, queryFn, onError) {
  return subscribeToCollection(
    walletTransactionsCollectionPath(playerId),
    WalletTransaction,
    onUpdate,
    queryFn,
    onError
  )
}

/**
 * Collection group query: all wallet transactions across every player.
 * Used by the end-of-day reconciliation view, audit pages, etc.
 *
 * @param {object} options
 * @param {Date|import('firebase/firestore').Timestamp} [options.since]
 * @param {Date|import('firebase/firestore').Timestamp} [options.until]
 * @param {string} [options.type]  - filter by walletTransaction type (e.g. 'deposit')
 *
 * Requires composite indexes on (timestamp desc) and (type + timestamp desc) —
 * called out in canonical-schema.md §7.
 */
export async function listAllWalletTransactions({ since, until, type } = {}) {
  if (USE_MOCK_DATA && !USE_EMULATOR) throw new MockModeError()
  const clauses = []
  if (type) clauses.push(where('type', '==', type))
  if (since) clauses.push(where('timestamp', '>=', since))
  if (until) clauses.push(where('timestamp', '<=', until))
  clauses.push(orderBy('timestamp', 'desc'))
  const q = query(collectionGroup(db, WALLET_TRANSACTIONS), ...clauses)
  const snap = await getDocs(q)
  return snap.docs.map((docSnap) => {
    const data = { id: docSnap.id, ...docSnap.data() }
    const result = WalletTransaction.safeParse(data)
    if (!result.success) {
      throw new ValidationError(docSnap.ref.path, result.error, 'read')
    }
    return result.data
  })
}
