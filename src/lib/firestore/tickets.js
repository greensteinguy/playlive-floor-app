// Typed access for the `players/{pid}/tickets` subcollection.
//
// Like walletTransactions, ticket state changes (issue, use) should go through
// the wallet module so the ledger and ticket-state writes are atomic. Direct
// reads are fine.

import { collectionGroup, query, where, getDocs } from 'firebase/firestore'
import { db, USE_MOCK_DATA } from '../../firebase/config'
import { Ticket } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  subscribeToCollection,
} from './_client'
import { ticketPath, ticketsCollectionPath, TICKETS } from './_paths'
import { MockModeError, ValidationError } from './_errors'

export function getTicket(playerId, ticketId) {
  return validatedGet(ticketPath(playerId, ticketId), Ticket)
}

export function listTickets(playerId, queryFn) {
  return validatedGetMany(ticketsCollectionPath(playerId), Ticket, queryFn)
}

export function subscribeToTickets(playerId, onUpdate, queryFn, onError) {
  return subscribeToCollection(ticketsCollectionPath(playerId), Ticket, onUpdate, queryFn, onError)
}

/**
 * Collection group query: all unused tickets across every player.
 * For venue-wide ticket-liability reporting.
 */
export async function listAllUnusedTickets() {
  if (USE_MOCK_DATA) throw new MockModeError()
  const q = query(collectionGroup(db, TICKETS), where('state', '==', 'unused'))
  const snap = await getDocs(q)
  return snap.docs.map((docSnap) => {
    const data = { id: docSnap.id, ...docSnap.data() }
    const result = Ticket.safeParse(data)
    if (!result.success) {
      throw new ValidationError(docSnap.ref.path, result.error, 'read')
    }
    return result.data
  })
}
