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
