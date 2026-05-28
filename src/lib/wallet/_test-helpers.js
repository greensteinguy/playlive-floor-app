// Shared test helpers for wallet operation tests.
//
// Tests stub `../firestore` so no real Firestore is hit. The factory below
// builds the typical mock-`tx` and reads/writes a fake "store" indexed by
// stringified path. That lets a test seed the store with a Player or Ticket
// and then assert on what set/update calls were made.

import { vi } from 'vitest'
import { Timestamp } from 'firebase/firestore'

// ── Path builders (mirror src/lib/firestore/_paths.js exactly) ─────────────
// Tests compare against these so call-site path layout is part of the contract.

export const playerPath = (id) => ['players', id]
export const walletTransactionPath = (pid, tid) => ['players', pid, 'walletTransactions', tid]
export const ticketPath = (pid, tid) => ['players', pid, 'tickets', tid]
export const entryPath = (tid, eid) => ['tournaments', tid, 'entries', eid]
export const bountyDrawPath = (tid, did) => ['tournaments', tid, 'bountyDraws', did]
export const withdrawalRequestPath = (id) => ['withdrawalRequests', id]

/**
 * Build a fresh mock-store + tx pair. Each test gets its own.
 * The store keyword indexes by JSON.stringify(pathParts) so any path-builder
 * convention works without coupling.
 */
export function makeMockStore() {
  const store = new Map()

  const key = (pathParts) => JSON.stringify(pathParts)

  function seed(pathParts, data) {
    store.set(key(pathParts), data)
  }

  function get(pathParts) {
    return store.get(key(pathParts))
  }

  // calls.set[i] = { path, schemaName, data }
  // calls.update[i] = { path, partial }
  const calls = { set: [], update: [], delete: [], get: [] }

  const tx = {
    get: vi.fn(async (pathParts /*, schema */) => {
      calls.get.push({ path: pathParts })
      const data = store.get(key(pathParts))
      if (data === undefined) {
        const err = new Error(`mock store: no doc at ${key(pathParts)}`)
        err.name = 'NotFoundError'
        throw err
      }
      // The real client passes data through Zod and returns the parsed shape;
      // for tests we trust the seeded data and skip validation.
      return data
    }),
    set: vi.fn((pathParts, schema, data) => {
      calls.set.push({ path: pathParts, schemaName: schema?._def?.typeName ?? 'unknown', data })
      // Persist into the store so subsequent reads in the same op see it.
      store.set(key(pathParts), { ...data, id: pathParts[pathParts.length - 1] })
    }),
    update: vi.fn((pathParts, partial) => {
      calls.update.push({ path: pathParts, partial })
      const existing = store.get(key(pathParts)) ?? {}
      store.set(key(pathParts), { ...existing, ...partial })
    }),
    delete: vi.fn((pathParts) => {
      calls.delete.push({ path: pathParts })
      store.delete(key(pathParts))
    }),
  }

  return { store, tx, calls, seed, get }
}

// ── Domain fixtures ────────────────────────────────────────────────────────
// Minimal shapes for the docs the wallet ops read. We don't validate inside
// the mock tx, so these only need to carry the fields the wallet ops actually
// read (mostly *Balance fields, state, faceValue).

export function makePlayer(overrides = {}) {
  return {
    id: 'player-1',
    legacyId: null,
    firstName: 'Test',
    lastName: 'User',
    displayName: null,
    phone: '0400',
    email: null,
    streetAddress: null,
    countryCode: null,
    walletBalance: 0,
    ticketBalance: 0,
    totalDeposited: 0,
    isMerged: false,
    mergedIntoId: null,
    mergedAt: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: 'system',
    archivedAt: null,
    ...overrides,
  }
}

export function makeTicket(overrides = {}) {
  return {
    id: 'ticket-1',
    playerId: 'player-1',
    faceValue: 50_00,
    state: 'unused',
    issuedAt: Timestamp.now(),
    issuedReason: null,
    issuedFromTournamentId: null,
    usedAt: null,
    usedOnEntryId: null,
    usedOnTournamentId: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  }
}

export function makeWithdrawalRequest(overrides = {}) {
  return {
    id: 'wr-1',
    playerId: 'player-1',
    amount: 5_000,
    payoutMethod: 'cash',
    state: 'pending',
    requestedBy: 'cashier-1',
    requestedAt: Timestamp.now(),
    completedBy: null,
    completedAt: null,
    externalReference: null,
    walletTransactionId: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  }
}

export function makeBountyDraw(overrides = {}) {
  return {
    id: 'draw-1',
    tournamentId: 'tournament-1',
    bountyValue: 1_000_00,
    drawnAt: Timestamp.now(),
    drawnBy: 'td-1',
    knockedOutEntryId: 'entry-out',
    knockerEntryId: 'entry-knocker',
    walletTransactionId: null,
    notes: null,
    ...overrides,
  }
}

/**
 * Fresh entryData arg suitable for payViaExternalMethod / payViaWallet / payViaTicket.
 * Only the seven required fields per assertEntryDataShape — the wallet module
 * fills in the rest.
 */
export function makeEntryData(overrides = {}) {
  return {
    tournamentId: 'tournament-1',
    playerId: 'player-1',
    originSessionId: 'session-1',
    entryType: 'initial',
    entryNumber: 1,
    registeredAt: Timestamp.now(),
    registeredBy: 'cashier-1',
    ...overrides,
  }
}
