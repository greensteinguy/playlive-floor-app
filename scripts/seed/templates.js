// Seed the local Firestore emulator with a few structure + tournament templates
// so the /td/templates page has something to show.
//
// Usage:
//   Terminal 1:  npm run emulator
//   Terminal 2:  npm run seed:templates
//   Terminal 3:  npm run dev   (with VITE_FIRESTORE_EMULATOR=true)
//
// Written:
//   - 2 structure templates (a turbo and a deepstack).
//   - 3 active tournament templates (standard NLH referencing the deepstack
//     structure, a satellite, a mystery bounty).
//   - 1 archived tournament template → should NOT appear on the page.

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

function level(blindNumber, smallBlind, bigBlind, durationMinutes, ante = 0) {
  return { type: 'level', blindNumber, smallBlind, bigBlind, ante, bringIn: 0, durationMinutes }
}
function brk(durationMinutes, label = 'Break', isColorUp = false) {
  return { type: 'break', durationMinutes, label, isColorUp }
}

function auditFields(daysBack) {
  return { createdAt: ts(daysBack), updatedAt: ts(daysBack), createdBy: 'seed-script', archivedAt: null }
}

const STRUCTURE_TEMPLATES = [
  {
    id: 'st-turbo',
    name: 'Turbo (15-min)',
    description: 'Fast structure for evening turbos.',
    levels: [
      level(1, 100, 200, 15),
      level(2, 200, 400, 15),
      level(3, 300, 600, 15),
      brk(10, 'Break', false),
      level(4, 400, 800, 15, 800),
      level(5, 600, 1200, 15, 1200),
    ],
    ...auditFields(30),
  },
  {
    id: 'st-deepstack',
    name: 'Deepstack (30-min)',
    description: 'Slow blinds for marquee events.',
    levels: [
      level(1, 100, 200, 30),
      level(2, 200, 400, 30),
      brk(15, 'Break', false),
      level(3, 300, 600, 30),
      level(4, 500, 1000, 30, 1000),
      brk(15, 'Color-up break', true),
      level(5, 800, 1600, 30, 1600),
    ],
    ...auditFields(45),
  },
]

function reentry(
  type,
  { maxReentries = null, maxRebuys = null, hasAddOn = false, addOnCost = null, addOnChips = null } = {},
) {
  return { type, maxReentries, maxRebuys, hasAddOn, addOnCost, addOnChips }
}

const TOURNAMENT_TEMPLATES = [
  {
    id: 'tt-friday-nlh',
    name: 'Friday $100 NLH',
    description: 'Weekly Friday night standard.',
    config: {
      name: '$100 NLH',
      shortDescription: 'Weekly Friday deepstack.',
      isMultiDay: false,
      isMultiFlight: false,
      gameType: 'nlh',
      buyIn: 100_00,
      hospitalityCost: 15_00,
      guarantee: 5_000_00,
      houseConsumption: 10_00,
      structureTemplateId: 'st-deepstack',
      startingStack: 30_000,
      reentryConfig: reentry('reentry', { maxReentries: 2 }),
      hasUpperDeckMainDeck: false,
      satelliteConfig: null,
      bountyPoolConfig: null,
    },
    ...auditFields(20),
  },
  {
    id: 'tt-sat-main',
    name: 'Main Event Satellite',
    description: 'Feeds seats into the Main Event.',
    config: {
      name: 'ME Satellite',
      shortDescription: 'Win your seat.',
      isMultiDay: false,
      isMultiFlight: false,
      gameType: 'satellite',
      buyIn: 50_00,
      hospitalityCost: 5_00,
      guarantee: 0,
      houseConsumption: 5_00,
      structureTemplateId: 'st-turbo',
      startingStack: 15_000,
      reentryConfig: reentry('reentry', { maxReentries: null }),
      hasUpperDeckMainDeck: false,
      satelliteConfig: { ticketReward: 500_00 },
      bountyPoolConfig: null,
    },
    ...auditFields(12),
  },
  {
    id: 'tt-mystery',
    name: 'Sunday Mystery Bounty',
    description: 'Monthly mystery bounty.',
    config: {
      name: 'Mystery Bounty',
      shortDescription: 'Draw a bounty when you knock someone out.',
      isMultiDay: true,
      isMultiFlight: true,
      gameType: 'mysteryBounty',
      buyIn: 200_00,
      hospitalityCost: 20_00,
      guarantee: 20_000_00,
      houseConsumption: 15_00,
      structureTemplateId: 'st-deepstack',
      startingStack: 40_000,
      reentryConfig: reentry('freezeout'),
      hasUpperDeckMainDeck: true,
      satelliteConfig: null,
      bountyPoolConfig: { totalPool: 20_000_00, bountyValues: [100_00, 250_00, 500_00, 1_000_00, 5_000_00] },
    },
    ...auditFields(8),
  },
  {
    // Archived — should NOT appear on the page (filtered client-side).
    id: 'tt-retired',
    name: 'Retired Bounty Hunter',
    description: 'Old format, kept for history.',
    config: {
      name: 'Bounty Hunter',
      shortDescription: '',
      isMultiDay: false,
      isMultiFlight: false,
      gameType: 'nlh',
      buyIn: 80_00,
      hospitalityCost: 10_00,
      guarantee: 0,
      houseConsumption: 5_00,
      structureTemplateId: null,
      startingStack: 20_000,
      reentryConfig: reentry('rebuy', { maxRebuys: 1, hasAddOn: true, addOnCost: 50_00, addOnChips: 20_000 }),
      hasUpperDeckMainDeck: false,
      satelliteConfig: null,
      bountyPoolConfig: null,
    },
    ...auditFields(90),
    archivedAt: ts(60),
  },
]

async function main() {
  console.log(
    `Seeding ${STRUCTURE_TEMPLATES.length} structure + ${TOURNAMENT_TEMPLATES.length} tournament templates ` +
    `into emulator (project=${PROJECT_ID})…`
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
      for (const t of STRUCTURE_TEMPLATES) {
        await setDoc(doc(db, 'structureTemplates', t.id), t)
      }
      for (const t of TOURNAMENT_TEMPLATES) {
        await setDoc(doc(db, 'tournamentTemplates', t.id), t)
      }
    })
    console.log('Seed complete. Open /td/templates to inspect.')
  } finally {
    await testEnv.cleanup()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
