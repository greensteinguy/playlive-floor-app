// Rules tests for firestore.rules — runs against the Firestore emulator
// started by `firebase emulators:exec` (see `npm run test:rules`).
//
// Philosophy (per docs/DECISIONS.md 27 May 2026): rules are a role-gate,
// not a business-invariant enforcer. So these tests cover authentication +
// role-vs-collection access matrix only — they don't assert anything about
// document shape, balance arithmetic, or state transitions (the wallet
// module's tier-1 tests cover those).

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc,
  setDoc,
  getDoc,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  getDocs,
  setLogLevel,
} from 'firebase/firestore'

setLogLevel('error') // quiet the SDK

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RULES_PATH = path.resolve(HERE, '../../firestore.rules')

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rules',
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  if (testEnv) await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

// ── Context builders ───────────────────────────────────────────────────────
// Each role gets a freshly authenticated context with the matching custom claim.

const ctxFor = (role) =>
  role
    ? testEnv.authenticatedContext(`user-${role}`, { role }).firestore()
    : testEnv.unauthenticatedContext().firestore()

const ctxNoRole = () =>
  testEnv.authenticatedContext('user-noclaim', {}).firestore()

// Seed a doc via the privileged "with security rules disabled" context.
// Used to set up reads we expect to succeed.
async function seed(pathParts, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...pathParts), data)
  })
}

// ── Per-collection matrix ──────────────────────────────────────────────────
// Each entry: { path, write: [allowed roles], read: [allowed roles] }
// "all" means manager + td + cashier + readonly.

const ALL = ['manager', 'td', 'cashier', 'readonly']
const STAFF = ['manager', 'td', 'cashier']

const matrix = [
  // Top-level
  { name: 'tournaments',         pathParts: ['tournaments', 't1'],                                  read: ALL, write: ['manager', 'td'] },
  { name: 'players',             pathParts: ['players', 'p1'],                                       read: ALL, write: ['manager', 'cashier'] },
  { name: 'withdrawalRequests',  pathParts: ['withdrawalRequests', 'wr1'],                           read: ALL, write: ['manager', 'cashier'] },
  { name: 'structureTemplates',  pathParts: ['structureTemplates', 'st1'],                           read: ALL, write: ['manager', 'td'] },
  { name: 'tournamentTemplates', pathParts: ['tournamentTemplates', 'tt1'],                          read: ALL, write: ['manager', 'td'] },
  { name: 'auditLog',            pathParts: ['auditLog', 'a1'],                                      read: ['manager'], write: STAFF },
  { name: 'settings',            pathParts: ['settings', 'venue'],                                   read: ALL, write: ['manager'] },
  { name: 'displayScreens',      pathParts: ['displayScreens', 'bar-tv'],                            read: ALL, write: ['manager', 'td'] },
  { name: 'displayGroups',       pathParts: ['displayGroups', 'g1'],                                 read: ALL, write: ['manager', 'td'] },

  // Subcollections under tournaments
  { name: 'sessions',    pathParts: ['tournaments', 't1', 'sessions', 's1'],   read: ALL, write: ['manager', 'td'] },
  { name: 'entries',     pathParts: ['tournaments', 't1', 'entries', 'e1'],    read: ALL, write: STAFF },
  { name: 'tables',      pathParts: ['tournaments', 't1', 'tables', 'tb1'],    read: ALL, write: ['manager', 'td'] },
  { name: 'bountyDraws', pathParts: ['tournaments', 't1', 'bountyDraws', 'd1'],read: ALL, write: STAFF },

  // Subcollections under players
  { name: 'walletTransactions', pathParts: ['players', 'p1', 'walletTransactions', 'wt1'], read: ALL, write: STAFF },
  { name: 'tickets',            pathParts: ['players', 'p1', 'tickets', 'tk1'],            read: ALL, write: STAFF },
]

describe('firestore.rules — unauthenticated users', () => {
  it.each(matrix)('cannot read $name', async ({ pathParts }) => {
    await seed(pathParts, { seeded: true })
    const db = ctxFor(null)
    await assertFails(getDoc(doc(db, ...pathParts)))
  })

  it.each(matrix)('cannot write $name', async ({ pathParts }) => {
    const db = ctxFor(null)
    await assertFails(setDoc(doc(db, ...pathParts), { x: 1 }))
  })
})

describe('firestore.rules — authenticated user with no role claim', () => {
  it.each(matrix)('cannot read $name', async ({ pathParts }) => {
    await seed(pathParts, { seeded: true })
    await assertFails(getDoc(doc(ctxNoRole(), ...pathParts)))
  })

  it.each(matrix)('cannot write $name', async ({ pathParts }) => {
    await assertFails(setDoc(doc(ctxNoRole(), ...pathParts), { x: 1 }))
  })
})

describe('firestore.rules — authenticated user with an UNKNOWN role claim', () => {
  // A garbage role should be treated like no role.
  it.each(matrix)('cannot read $name', async ({ pathParts }) => {
    await seed(pathParts, { seeded: true })
    await assertFails(getDoc(doc(ctxFor('intern'), ...pathParts)))
  })

  it.each(matrix)('cannot write $name', async ({ pathParts }) => {
    await assertFails(setDoc(doc(ctxFor('intern'), ...pathParts), { x: 1 }))
  })
})

describe('firestore.rules — per-role read access', () => {
  for (const role of ALL) {
    describe(`role=${role}`, () => {
      it.each(matrix)('reading $name', async ({ pathParts, read }) => {
        await seed(pathParts, { seeded: true })
        const db = ctxFor(role)
        if (read.includes(role)) {
          await assertSucceeds(getDoc(doc(db, ...pathParts)))
        } else {
          await assertFails(getDoc(doc(db, ...pathParts)))
        }
      })
    })
  }
})

describe('firestore.rules — per-role write access', () => {
  for (const role of ALL) {
    describe(`role=${role}`, () => {
      it.each(matrix)('writing $name', async ({ pathParts, write }) => {
        const db = ctxFor(role)
        if (write.includes(role)) {
          await assertSucceeds(setDoc(doc(db, ...pathParts), { x: 1 }))
        } else {
          await assertFails(setDoc(doc(db, ...pathParts), { x: 1 }))
        }
      })
    })
  }
})

// ── Collection-group queries ───────────────────────────────────────────────
// Rules v2: nested matches don't authorize collectionGroup() queries — the
// explicit {path=**} blocks in firestore.rules do. Queries below mirror the
// app's real collection-group queries (entries.js, tickets.js,
// walletTransactions.js). The emulator doesn't enforce composite indexes,
// so these exercise rules only; index coverage lives in firestore.indexes.json.

describe('firestore.rules — collection-group queries', () => {
  const groups = [
    {
      name: 'entries',
      seedDocs: [
        { pathParts: ['tournaments', 't1', 'entries', 'e1'], data: { playerId: 'p1', registeredAt: 1 } },
        { pathParts: ['tournaments', 't2', 'entries', 'e2'], data: { playerId: 'p1', registeredAt: 2 } },
      ],
      // listEntriesByPlayer()
      buildQuery: (db) =>
        query(collectionGroup(db, 'entries'), where('playerId', '==', 'p1'), orderBy('registeredAt', 'desc')),
    },
    {
      name: 'tickets',
      seedDocs: [
        { pathParts: ['players', 'p1', 'tickets', 'tk1'], data: { state: 'unused' } },
        { pathParts: ['players', 'p2', 'tickets', 'tk2'], data: { state: 'unused' } },
      ],
      // listAllUnusedTickets()
      buildQuery: (db) => query(collectionGroup(db, 'tickets'), where('state', '==', 'unused')),
    },
    {
      name: 'walletTransactions',
      seedDocs: [
        { pathParts: ['players', 'p1', 'walletTransactions', 'wt1'], data: { type: 'deposit', timestamp: 1 } },
        { pathParts: ['players', 'p2', 'walletTransactions', 'wt2'], data: { type: 'deposit', timestamp: 2 } },
      ],
      // listAllWalletTransactions()
      buildQuery: (db) => query(collectionGroup(db, 'walletTransactions'), orderBy('timestamp', 'desc')),
    },
  ]

  for (const { name, seedDocs, buildQuery } of groups) {
    describe(`collectionGroup('${name}')`, () => {
      beforeEach(async () => {
        for (const { pathParts, data } of seedDocs) {
          await seed(pathParts, data)
        }
      })

      it.each(ALL)('role=%s can query', async (role) => {
        await assertSucceeds(getDocs(buildQuery(ctxFor(role))))
      })

      it('unauthenticated user cannot query', async () => {
        await assertFails(getDocs(buildQuery(ctxFor(null))))
      })

      it('authenticated user with no role claim cannot query', async () => {
        await assertFails(getDocs(buildQuery(ctxNoRole())))
      })

      it('authenticated user with an unknown role claim cannot query', async () => {
        await assertFails(getDocs(buildQuery(ctxFor('intern'))))
      })
    })
  }
})

describe('firestore.rules — default deny on unknown collection paths', () => {
  const unknownPaths = [
    ['unknown', 'doc1'],
    ['secret', 'doc1'],
    ['players', 'p1', 'bsbAccounts', 'b1'], // hypothetical not-in-schema subcollection
  ]
  it.each(unknownPaths)('manager cannot read %s/%s', async (...pathParts) => {
    await seed(pathParts, { seeded: true })
    await assertFails(getDoc(doc(ctxFor('manager'), ...pathParts)))
  })
  it.each(unknownPaths)('manager cannot write %s/%s', async (...pathParts) => {
    await assertFails(setDoc(doc(ctxFor('manager'), ...pathParts), { x: 1 }))
  })
})

// ── Phase 6.2: Player App account branch ───────────────────────────────────
// Players sign in with phone OTP; the linkPlayerAccount function stamps a
// `playerId` custom claim. These tests cover the self-read branch that claim
// unlocks — and that it unlocks nothing else.

describe('firestore.rules — player-app accounts (playerId claim)', () => {
  const linkedCtx = () =>
    testEnv.authenticatedContext('app-user-1', { playerId: 'player-1' }).firestore()
  const otherLinkedCtx = () =>
    testEnv.authenticatedContext('app-user-2', { playerId: 'player-2' }).firestore()

  describe('players self-read', () => {
    it('linked player reads their own player doc', async () => {
      await seed(['players', 'player-1'], { firstName: 'A' })
      await assertSucceeds(getDoc(doc(linkedCtx(), 'players', 'player-1')))
    })

    it("linked player cannot read another player's doc", async () => {
      await seed(['players', 'player-1'], { firstName: 'A' })
      await assertFails(getDoc(doc(otherLinkedCtx(), 'players', 'player-1')))
    })

    it('phone-authed user with NO playerId claim reads nothing', async () => {
      await seed(['players', 'player-1'], { firstName: 'A' })
      await assertFails(getDoc(doc(ctxNoRole(), 'players', 'player-1')))
    })

    it('linked player cannot write their own player doc', async () => {
      await assertFails(setDoc(doc(linkedCtx(), 'players', 'player-1'), { firstName: 'X' }))
    })

    it('linked player reads own walletTransactions and tickets', async () => {
      await seed(['players', 'player-1', 'walletTransactions', 'tx1'], { amount: 100 })
      await seed(['players', 'player-1', 'tickets', 't1'], { faceValue: 100 })
      await assertSucceeds(getDoc(doc(linkedCtx(), 'players', 'player-1', 'walletTransactions', 'tx1')))
      await assertSucceeds(getDoc(doc(linkedCtx(), 'players', 'player-1', 'tickets', 't1')))
    })

    it("linked player cannot read another player's ledger", async () => {
      await seed(['players', 'player-1', 'walletTransactions', 'tx1'], { amount: 100 })
      await assertFails(getDoc(doc(otherLinkedCtx(), 'players', 'player-1', 'walletTransactions', 'tx1')))
    })

    it('linked player cannot use the walletTransactions collection group', async () => {
      await seed(['players', 'player-1', 'walletTransactions', 'tx1'], { amount: 100, playerId: 'player-1' })
      await assertFails(getDocs(query(collectionGroup(linkedCtx(), 'walletTransactions'), where('playerId', '==', 'player-1'))))
    })
  })

  describe('tournaments visibility', () => {
    it('linked player reads a non-draft tournament', async () => {
      await seed(['tournaments', 'tour-1'], { status: 'lateRegOpen' })
      await assertSucceeds(getDoc(doc(linkedCtx(), 'tournaments', 'tour-1')))
    })

    it('linked player cannot read a draft tournament', async () => {
      await seed(['tournaments', 'tour-1'], { status: 'draft' })
      await assertFails(getDoc(doc(linkedCtx(), 'tournaments', 'tour-1')))
    })

    it('status-constrained list query succeeds for a linked player', async () => {
      await seed(['tournaments', 'tour-1'], { status: 'scheduled' })
      const q = query(
        collection(linkedCtx(), 'tournaments'),
        where('status', 'in', ['scheduled', 'lateRegOpen', 'lateRegClosed', 'finished'])
      )
      await assertSucceeds(getDocs(q))
    })

    it('UNconstrained list query fails for a linked player (could surface drafts)', async () => {
      await seed(['tournaments', 'tour-1'], { status: 'scheduled' })
      await assertFails(getDocs(collection(linkedCtx(), 'tournaments')))
    })

    it('linked player cannot read tournament subcollections (entries)', async () => {
      await seed(['tournaments', 'tour-1', 'entries', 'e1'], { playerId: 'player-1' })
      await assertFails(getDoc(doc(linkedCtx(), 'tournaments', 'tour-1', 'entries', 'e1')))
    })

    it('linked player cannot write tournaments', async () => {
      await assertFails(setDoc(doc(linkedCtx(), 'tournaments', 'tour-1'), { status: 'scheduled' }))
    })
  })

  describe('registrationRequests', () => {
    it('linked player reads their own request', async () => {
      await seed(['registrationRequests', 'rr1'], { playerId: 'player-1', state: 'pending' })
      await assertSucceeds(getDoc(doc(linkedCtx(), 'registrationRequests', 'rr1')))
    })

    it("linked player cannot read another player's request", async () => {
      await seed(['registrationRequests', 'rr1'], { playerId: 'player-1', state: 'pending' })
      await assertFails(getDoc(doc(otherLinkedCtx(), 'registrationRequests', 'rr1')))
    })

    it('linked player cannot create a request directly (function-only)', async () => {
      await assertFails(setDoc(doc(linkedCtx(), 'registrationRequests', 'rr2'), {
        playerId: 'player-1', state: 'pending',
      }))
    })

    it('cashier reads and resolves requests; readonly cannot resolve', async () => {
      await seed(['registrationRequests', 'rr1'], { playerId: 'player-1', state: 'pending' })
      await assertSucceeds(getDoc(doc(ctxFor('cashier'), 'registrationRequests', 'rr1')))
      await assertSucceeds(setDoc(doc(ctxFor('cashier'), 'registrationRequests', 'rr1'), { state: 'cancelled' }, { merge: true }))
      await assertFails(setDoc(doc(ctxFor('readonly'), 'registrationRequests', 'rr1'), { state: 'cancelled' }, { merge: true }))
    })
  })

  describe('linkRequests (desk-only)', () => {
    it('cashier + manager read; player and readonly cannot', async () => {
      await seed(['linkRequests', 'lr1'], { authUid: 'app-user-1', state: 'pending' })
      await assertSucceeds(getDoc(doc(ctxFor('cashier'), 'linkRequests', 'lr1')))
      await assertSucceeds(getDoc(doc(ctxFor('manager'), 'linkRequests', 'lr1')))
      await assertFails(getDoc(doc(ctxFor('readonly'), 'linkRequests', 'lr1')))
      // even the player the request is ABOUT cannot read it
      await assertFails(getDoc(doc(linkedCtx(), 'linkRequests', 'lr1')))
    })
  })
})
