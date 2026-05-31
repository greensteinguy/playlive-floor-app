// Seed the local Firestore emulator with a rich set of structure templates and
// tournaments — including multi-day and multi-flight events — so the /td pages
// have realistic data to drive against.
//
// Usage:
//   Terminal 1:  npm run emulator
//   Terminal 2:  npm run seed:tournaments
//   Terminal 3:  npm run dev   (with VITE_FIRESTORE_EMULATOR=true)
//
//   Dry run (build + integrity-check everything, print a summary, write nothing —
//   no emulator or Java required):
//                npm run seed:tournaments -- --dry-run
//
// The data itself lives in ./tournament-fixtures.js (pure, IO-free) so the same
// builders are validated against the real Zod schemas by
// src/lib/tournaments/seedTournaments.test.js. This file is just the writer.
//
// Idempotent: tournaments / templates use fixed ids and sessions use
// deterministic ids, so re-running overwrites in place rather than duplicating.

import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { buildSeedData } from './tournament-fixtures.js'

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

/** Human-readable summary of what was built — printed in both modes. */
function printSummary({ structureTemplates, tournaments, sessions }) {
  const sessionsByTournament = sessions.reduce((acc, s) => {
    ;(acc[s.tournamentId] ||= []).push(s.doc)
    return acc
  }, {})

  console.log(`\nStructure templates (${structureTemplates.length}):`)
  for (const t of structureTemplates) {
    const levels = t.levels.filter((e) => e.type === 'level').length
    const breaks = t.levels.filter((e) => e.type === 'break').length
    console.log(`  • ${t.id.padEnd(14)} ${t.name}  — ${levels} levels, ${breaks} breaks`)
  }

  console.log(`\nTournaments (${tournaments.length}):`)
  for (const t of tournaments) {
    const fmt = t.isMultiFlight ? 'multi-flight' : t.isMultiDay ? 'multi-day' : 'single-day'
    const sess = sessionsByTournament[t.id] ?? []
    const labels = sess.map((s) => s.sessionLabel).join(', ')
    console.log(`  • ${t.id.padEnd(24)} ${t.status.padEnd(12)} ${fmt.padEnd(12)} [${sess.length} session(s): ${labels}]`)
  }

  const multi = tournaments.filter((t) => t.isMultiDay).length
  console.log(`\nTotals: ${structureTemplates.length} templates, ${tournaments.length} tournaments ` +
    `(${multi} multi-day/flight), ${sessions.length} sessions.`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  // Build + integrity-check everything up front (buildSeedData throws on a broken
  // session graph), so a bad fixture fails before we touch the emulator.
  const data = buildSeedData()
  const { structureTemplates, tournaments, sessions } = data

  printSummary(data)

  if (dryRun) {
    console.log('\n--dry-run: built and integrity-checked, wrote nothing.')
    return
  }

  console.log(`\nSeeding into emulator (project=${PROJECT_ID}) at ${EMULATOR_HOST}:${EMULATOR_PORT}…`)
  await pushDevRules()

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: DEV_RULES, host: EMULATOR_HOST, port: EMULATOR_PORT },
  })

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      for (const t of structureTemplates) {
        await setDoc(doc(db, 'structureTemplates', t.id), t)
      }
      for (const t of tournaments) {
        await setDoc(doc(db, 'tournaments', t.id), t)
      }
      for (const { tournamentId, doc: session } of sessions) {
        await setDoc(doc(db, 'tournaments', tournamentId, 'sessions', session.id), session)
      }
    })
    console.log('\nSeed complete. Open /td/tournaments (and /td/templates) to inspect.')
  } finally {
    await testEnv.cleanup()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
