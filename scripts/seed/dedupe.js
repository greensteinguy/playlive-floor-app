// Seed the local Firestore emulator with a handful of duplicate-player
// scenarios so the dedupe page has something to show.
//
// Usage:
//   Terminal 1:  npm run emulator
//   Terminal 2:  npm run seed:dedupe
//   Terminal 3:  npm run dev   (with VITE_FIRESTORE_EMULATOR=true)
//
// Scenarios written:
//   - A clean unique player (no duplicates) — should NOT appear on the dedupe page.
//   - A pair with the same phone in two formatting variants.
//   - A trio with the same phone in three formatting variants, one carrying
//     a wallet balance + an unused ticket so the merge transfers something
//     interesting.
//   - A pair where one record is already isMerged=true → should NOT appear.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, doc, setDoc } from 'firebase/firestore'

const PROJECT_ID = 'demo-playlive'
const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 8080

const DEV_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
`

async function pushDevRules() {
  const url = `http://${EMULATOR_HOST}:${EMULATOR_PORT}/emulator/v1/projects/${PROJECT_ID}:securityRules`
  const body = JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: DEV_RULES }] } })
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to push dev rules to emulator: ${res.status} ${text}`)
  }
}

const NOW = Timestamp.now()

function ts(daysBack = 0) {
  const d = new Date(NOW.toMillis())
  d.setDate(d.getDate() - daysBack)
  return Timestamp.fromDate(d)
}

function buildPlayer(overrides) {
  return {
    legacyId: null,
    firstName: 'Test',
    lastName: 'Player',
    displayName: null,
    phone: '0400000000',
    email: null,
    streetAddress: null,
    countryCode: null,
    walletBalance: 0,
    ticketBalance: 0,
    totalDeposited: 0,
    isMerged: false,
    mergedIntoId: null,
    mergedAt: null,
    createdAt: ts(0),
    updatedAt: ts(0),
    createdBy: 'seed-script',
    archivedAt: null,
    ...overrides,
  }
}

const PLAYERS = [
  // Clean unique — no duplicates, should not appear on dedupe page.
  { id: 'player-bob-unique', ...buildPlayer({
    firstName: 'Bob', lastName: 'Solo',
    phone: '+61 4 9999 0001',
    walletBalance: 25_00, ticketBalance: 0, totalDeposited: 25_00,
    createdAt: ts(20), updatedAt: ts(20),
  }) },

  // Pair — Alice with the same phone in two formats.
  { id: 'player-alice-1', ...buildPlayer({
    firstName: 'Alice', lastName: 'Brown',
    phone: '+61 4 1234 5678',
    walletBalance: 50_00, ticketBalance: 0, totalDeposited: 50_00,
    createdAt: ts(28), updatedAt: ts(28),
  }) },
  { id: 'player-alice-2', ...buildPlayer({
    firstName: 'Alice', lastName: 'Brown',
    phone: '0412345678', // same number, local format
    walletBalance: 12_00, ticketBalance: 0, totalDeposited: 12_00,
    createdAt: ts(3), updatedAt: ts(3),
    email: 'alice.brown@example.com',
  }) },

  // Trio — Charlie with three formatting variants, plus a ticket.
  { id: 'player-charlie-1', ...buildPlayer({
    firstName: 'Charlie', lastName: 'Davis',
    phone: '+61 4 5555 1234',
    walletBalance: 100_00, ticketBalance: 50_00, totalDeposited: 200_00,
    createdAt: ts(45), updatedAt: ts(45),
  }) },
  { id: 'player-charlie-2', ...buildPlayer({
    firstName: 'Chuck', lastName: 'Davis',
    phone: '0455551234',
    walletBalance: 0, ticketBalance: 0, totalDeposited: 30_00,
    createdAt: ts(15), updatedAt: ts(15),
  }) },
  { id: 'player-charlie-3', ...buildPlayer({
    firstName: 'C', lastName: 'Davis',
    phone: '455551234',
    walletBalance: 15_50, ticketBalance: 0, totalDeposited: 15_50,
    createdAt: ts(2), updatedAt: ts(2),
  }) },

  // Already-merged — should NOT appear on the dedupe page.
  { id: 'player-david-merged', ...buildPlayer({
    firstName: 'David', lastName: 'Eng',
    phone: '0466666666',
    isMerged: true,
    mergedIntoId: 'player-david-canonical',
    mergedAt: ts(40),
    createdAt: ts(60), updatedAt: ts(40),
  }) },
  { id: 'player-david-canonical', ...buildPlayer({
    firstName: 'David', lastName: 'Eng',
    phone: '0466666666',
    walletBalance: 0, ticketBalance: 0, totalDeposited: 200_00,
    createdAt: ts(70), updatedAt: ts(40),
  }) },
]

// One unused ticket attached to player-charlie-1 (50_00 — matches the
// ticketBalance on that player). Lets the merge transfer move it.
const TICKETS = [
  {
    parent: 'player-charlie-1',
    data: {
      playerId: 'player-charlie-1',
      faceValue: 50_00,
      state: 'unused',
      issuedAt: ts(10),
      issuedReason: 'satelliteWin',
      issuedFromTournamentId: null,
      usedAt: null,
      usedOnEntryId: null,
      usedOnTournamentId: null,
      createdAt: ts(10),
      updatedAt: ts(10),
    },
  },
]

async function main() {
  console.log(
    `Seeding ${PLAYERS.length} players + ${TICKETS.length} ticket(s) into emulator (project=${PROJECT_ID})…`
  )

  await pushDevRules()

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: DEV_RULES,
      host: EMULATOR_HOST,
      port: EMULATOR_PORT,
    },
  })

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      for (const p of PLAYERS) {
        await setDoc(doc(db, 'players', p.id), p)
      }
      for (const t of TICKETS) {
        const id = `tk-${t.parent}`
        await setDoc(doc(db, 'players', t.parent, 'tickets', id), { id, ...t.data })
      }
    })
    console.log('Seed complete. Open /admin/dedupe to inspect.')
  } finally {
    await testEnv.cleanup()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
