// Seed the local Firestore emulator with ~30 varied audit log entries.
//
// Usage:
//   Terminal 1:  npm run emulator     (must be running first — port 8080)
//   Terminal 2:  npm run seed:audit
//
// The script writes via @firebase/rules-unit-testing's withSecurityRulesDisabled
// path so we don't need to mint a manager token just to seed dev data.
//
// Idempotent-ish: each run writes a fresh batch. If you want a clean slate,
// stop the emulator (which loses state by default) and restart.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, doc, setDoc } from 'firebase/firestore'
import { randomUUID } from 'crypto'

// Must match firebase/config.js EMULATOR_PROJECT_ID so the data lands in the
// same emulator partition the app reads from.
const PROJECT_ID = 'demo-playlive'
const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 8080

// Permissive rules — pushed to the emulator at runtime before seeding, and
// kept in place while the dev session continues. The production rules in
// firestore.rules are NOT modified; they're what `npm run test:rules` and the
// production deploy use. See firestore.dev.rules for the same content as a
// reference file.
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

/**
 * Push the dev rules to the running emulator. The Firestore emulator's
 * /emulator/v1/.../securityRules endpoint is a hot-reload entry point that
 * overrides whatever rules were loaded at boot — handier than fighting with
 * the CLI's --config flag.
 */
async function pushDevRules() {
  const url = `http://${EMULATOR_HOST}:${EMULATOR_PORT}/emulator/v1/projects/${PROJECT_ID}:securityRules`
  const body = JSON.stringify({
    rules: { files: [{ name: 'firestore.rules', content: DEV_RULES }] },
  })
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

// Fixed "now" for reproducibility. The earliest entry will be ~28 days back.
const NOW = new Date()

const ACTORS = [
  { id: 'user-manager-1',  role: 'manager' },
  { id: 'user-manager-2',  role: 'manager' },
  { id: 'user-td-1',       role: 'td' },
  { id: 'user-td-2',       role: 'td' },
  { id: 'user-cashier-1',  role: 'cashier' },
  { id: 'user-cashier-2',  role: 'cashier' },
  { id: 'system',          role: 'system' },
]

const TOURNAMENT_IDS = ['tournament-friday-night', 'tournament-mystery-bounty', 'tournament-satellite-7']
const PLAYER_IDS = ['player-alice', 'player-bob', 'player-charlie', 'player-dana', 'player-eve']

// Each entry: { dayOffset, hours, actorIndex, action, target, metadata }
const ENTRY_SPECS = [
  // Older — last 30-ish days
  { d: 28, h:  9, a: 0, action: 'tournament.created',       targetType: 'tournament', targetId: TOURNAMENT_IDS[0], metadata: { buyIn: 5000, guarantee: 50000 } },
  { d: 28, h: 10, a: 2, action: 'tournament.statusChanged', targetType: 'tournament', targetId: TOURNAMENT_IDS[0], metadata: { from: 'scheduled', to: 'lateRegOpen' } },
  { d: 28, h: 11, a: 4, action: 'entry.created',            targetType: 'entry',      targetId: 'entry-aa-001',     metadata: { tournamentId: TOURNAMENT_IDS[0], paymentMethod: 'cash',   paymentAmount: 5000 } },
  { d: 28, h: 11, a: 4, action: 'entry.created',            targetType: 'entry',      targetId: 'entry-aa-002',     metadata: { tournamentId: TOURNAMENT_IDS[0], paymentMethod: 'eftpos', paymentAmount: 5000 } },
  { d: 28, h: 12, a: 5, action: 'wallet.deposit',           targetType: 'player',     targetId: PLAYER_IDS[0],      metadata: { amount: 20000, method: 'cash',  reference: 'till-1' } },
  { d: 28, h: 13, a: 5, action: 'wallet.deposit',           targetType: 'player',     targetId: PLAYER_IDS[1],      metadata: { amount: 10000, method: 'payid', reference: 'XYZ-1234' } },

  { d: 21, h:  8, a: 6, action: 'auth.signIn',              targetType: null,         targetId: null,               metadata: { actorRoleSnapshot: 'system', context: 'overnight reconciliation job' } },
  { d: 21, h: 19, a: 1, action: 'tournament.created',       targetType: 'tournament', targetId: TOURNAMENT_IDS[1], metadata: { buyIn: 15000, hasMysteryBounty: true } },
  { d: 21, h: 20, a: 3, action: 'tournament.statusChanged', targetType: 'tournament', targetId: TOURNAMENT_IDS[1], metadata: { from: 'lateRegOpen', to: 'lateRegClosed' } },

  // Mid-range — last week
  { d:  6, h: 19, a: 2, action: 'tournament.statusChanged', targetType: 'tournament', targetId: TOURNAMENT_IDS[2], metadata: { from: 'scheduled', to: 'lateRegOpen' } },
  { d:  6, h: 19, a: 4, action: 'entry.created',            targetType: 'entry',      targetId: 'entry-cc-101',     metadata: { tournamentId: TOURNAMENT_IDS[2], paymentMethod: 'wallet', paymentAmount: 11000 } },
  { d:  6, h: 19, a: 4, action: 'wallet.spend',             targetType: 'player',     targetId: PLAYER_IDS[2],      metadata: { amount: 11000, method: 'wallet', relatedDocId: 'entry-cc-101' } },
  { d:  6, h: 20, a: 4, action: 'entry.created',            targetType: 'entry',      targetId: 'entry-cc-102',     metadata: { tournamentId: TOURNAMENT_IDS[2], paymentMethod: 'ticket', paymentAmount: 11000, ticketId: 'tk-sat-3' } },
  { d:  6, h: 20, a: 4, action: 'wallet.ticketUse',         targetType: 'player',     targetId: PLAYER_IDS[3],      metadata: { amount: 11000, ticketId: 'tk-sat-3', relatedDocId: 'entry-cc-102' } },

  { d:  5, h: 22, a: 2, action: 'tournament.dealEntered',   targetType: 'tournament', targetId: TOURNAMENT_IDS[2], metadata: { dealType: '3-way ICM', notes: 'players agreed at 3 left' } },
  { d:  5, h: 22, a: 5, action: 'wallet.winCredit',         targetType: 'player',     targetId: PLAYER_IDS[2],      metadata: { amount: 35000, relatedDocId: 'entry-cc-101' } },
  { d:  5, h: 22, a: 5, action: 'wallet.winCredit',         targetType: 'player',     targetId: PLAYER_IDS[3],      metadata: { amount: 30000, relatedDocId: 'entry-cc-102' } },
  { d:  5, h: 22, a: 5, action: 'wallet.winCredit',         targetType: 'player',     targetId: PLAYER_IDS[4],      metadata: { amount: 25000, relatedDocId: 'entry-cc-103' } },

  // Recent — last 48h
  { d:  1, h: 14, a: 4, action: 'wallet.deposit',           targetType: 'player',     targetId: PLAYER_IDS[0],      metadata: { amount: 50000, method: 'payid', reference: 'pay-id-99' } },
  { d:  1, h: 18, a: 5, action: 'withdrawal.requested',     targetType: 'withdrawalRequest', targetId: 'wr-abc-1',  metadata: { playerId: PLAYER_IDS[1], amount: 8000, payoutMethod: 'bankTransfer' } },
  { d:  1, h: 18, a: 0, action: 'withdrawal.completed',     targetType: 'withdrawalRequest', targetId: 'wr-abc-1',  metadata: { walletTransactionId: 'tx-' + randomUUID(), externalReference: 'BSB-PAYOUT-001' } },

  { d:  0, h:  9, a: 4, action: 'player.created',           targetType: 'player',     targetId: 'player-new-001',   metadata: { firstName: 'Sam',  lastName: 'Newcomer' } },
  { d:  0, h:  9, a: 4, action: 'wallet.deposit',           targetType: 'player',     targetId: 'player-new-001',   metadata: { amount: 10000, method: 'cash', reference: 'till-2' } },
  { d:  0, h: 10, a: 4, action: 'entry.created',            targetType: 'entry',      targetId: 'entry-now-001',    metadata: { tournamentId: TOURNAMENT_IDS[2], paymentMethod: 'cash', paymentAmount: 5000 } },

  { d:  0, h: 11, a: 0, action: 'manager.override',         targetType: 'ticket',     targetId: 'tk-sat-2',         metadata: { overrideType: 'ticketBelowFaceValue', reason: 'goodwill — late satellite winner', entryId: 'entry-now-002' } },
  { d:  0, h: 11, a: 0, action: 'wallet.managerCredit',     targetType: 'player',     targetId: PLAYER_IDS[1],      metadata: { amount: 5000, reason: 'comp for chip miscount on table 4' } },
  { d:  0, h: 12, a: 0, action: 'wallet.managerDebit',      targetType: 'player',     targetId: PLAYER_IDS[2],      metadata: { amount: 2500, reason: 'recouping double-credit from yesterday' } },
  { d:  0, h: 12, a: 1, action: 'wallet.adjustment',        targetType: 'player',     targetId: PLAYER_IDS[4],      metadata: { amount: 1500, direction: 'credit', reason: 'over-debited at registration' } },

  { d:  0, h: 13, a: 2, action: 'tournament.paused',        targetType: 'tournament', targetId: TOURNAMENT_IDS[0], metadata: { context: 'dinner break' } },
  { d:  0, h: 14, a: 2, action: 'tournament.resumed',       targetType: 'tournament', targetId: TOURNAMENT_IDS[0], metadata: { afterPauseMinutes: 60 } },
]

function tsForOffset(daysBack, hour) {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysBack)
  d.setHours(hour, 0, 0, 0)
  return Timestamp.fromDate(d)
}

async function main() {
  console.log(`Seeding auditLog into emulator (project=${PROJECT_ID}, ${ENTRY_SPECS.length} entries)…`)

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
      for (const spec of ENTRY_SPECS) {
        const actor = ACTORS[spec.a]
        const id = `seed-${randomUUID()}`
        const entry = {
          id,
          timestamp:  tsForOffset(spec.d, spec.h),
          actorId:    actor.id,
          actorRole:  actor.role,
          actionType: spec.action,
          targetType: spec.targetType ?? null,
          targetId:   spec.targetId   ?? null,
          metadata:   spec.metadata   ?? {},
        }
        await setDoc(doc(db, 'auditLog', id), entry)
      }
    })
    console.log(`Seeded ${ENTRY_SPECS.length} auditLog entries.`)
  } finally {
    await testEnv.cleanup()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
