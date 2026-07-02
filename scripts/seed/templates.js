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

// --- PlayLive canonical blind ladder -----------------------------------------
// The venue runs ONE blind ladder across every event (weekly Sixhundy Sunday,
// the Winter Championship Opening + Main Events, etc.). Templates differ only by
// LEVEL DURATION, not by the blind numbers. BB-ante = big blind at every level.
// Source: managers' Sixhundy Sunday sheet + Winter Championship structure cards
// (1 July 2026). Breaks land after levels 6/12/17/22/28 (the Sixhundy cadence).
const LADDER = [
  [100, 200], [200, 400], [300, 600], [400, 800], [500, 1_000], [600, 1_200],
  [800, 1_600], [1_000, 2_000], [1_200, 2_400], [1_500, 3_000], [2_000, 4_000], [2_500, 5_000],
  [3_000, 6_000], [4_000, 8_000], [5_000, 10_000], [6_000, 12_000], [8_000, 16_000],
  [10_000, 20_000], [12_000, 24_000], [15_000, 30_000], [20_000, 40_000], [25_000, 50_000],
  [30_000, 60_000], [40_000, 80_000], [50_000, 100_000], [60_000, 120_000], [75_000, 150_000], [100_000, 200_000],
  [125_000, 250_000], [150_000, 300_000], [200_000, 400_000], [250_000, 500_000],
]

const BREAK_AFTER = [6, 12, 17, 22, 28] // blindNumbers a 15-minute break follows

// Build the canonical ladder at a given per-level duration. `durationFor` is
// either a number (uniform) or a fn(blindNumber) -> minutes (escalating).
function buildLadder(durationFor, { breakAfter = BREAK_AFTER, breakMinutes = 15 } = {}) {
  const durOf = typeof durationFor === 'function' ? durationFor : () => durationFor
  const entries = []
  LADDER.forEach(([sb, bb], i) => {
    const blindNumber = i + 1
    entries.push(level(blindNumber, sb, bb, durOf(blindNumber), bb)) // ante = big blind
    if (breakAfter.includes(blindNumber)) entries.push(brk(breakMinutes, 'Break', false))
  })
  return entries
}

const STRUCTURE_TEMPLATES = [
  {
    id: 'st-turbo',
    name: 'Turbo (15-min)',
    description: 'Canonical PlayLive ladder at 15-minute levels. Evening turbos.',
    levels: buildLadder(15),
    ...auditFields(30),
  },
  {
    id: 'st-20min',
    name: '20-minute levels',
    description: 'Canonical PlayLive ladder at 20-minute levels.',
    levels: buildLadder(20),
    ...auditFields(30),
  },
  {
    id: 'st-30min',
    name: '30-minute levels',
    description: 'Canonical PlayLive ladder at 30-minute levels (Sixhundy Sunday back-half cadence).',
    levels: buildLadder(30),
    ...auditFields(30),
  },
  {
    id: 'st-40min',
    name: '40-minute levels',
    description: 'Canonical PlayLive ladder at 40-minute levels.',
    levels: buildLadder(40),
    ...auditFields(30),
  },
  {
    id: 'st-mainevent',
    name: 'Main Event (40 → 60-min)',
    description: 'Winter Championship Main Event: 40-minute levels through L12, then 60-minute from L13.',
    levels: buildLadder((bn) => (bn <= 12 ? 40 : 60)),
    ...auditFields(30),
  },
  {
    id: 'st-sixhundy',
    name: 'Sixhundy Sunday (24 → 30-min)',
    description: 'Weekly $600 Sixhundy Sunday — exact venue structure: 24-minute levels through L12, then 30-minute from L13.',
    levels: buildLadder((bn) => (bn <= 12 ? 24 : 30)),
    ...auditFields(30),
  },
  {
    id: 'st-opening',
    name: 'Championship Opening (30 → 40-min)',
    description: 'Winter Championship Opening Event: 30-minute levels through L12, then 40-minute from L13.',
    levels: buildLadder((bn) => (bn <= 12 ? 30 : 40)),
    ...auditFields(30),
  },
]

function reentry(
  type,
  { maxReentries = null, maxRebuys = null, hasAddOn = false, addOnCost = null, addOnChips = null } = {},
) {
  return { type, maxReentries, maxRebuys, hasAddOn, addOnCost, addOnChips }
}

const TOURNAMENT_TEMPLATES = [
  // ── Real venue events (from the Winter Championship cards + Sixhundy sheet,
  //    1 July 2026). Money fields marked ⚑ are estimates — not on the source. ──
  {
    id: 'tt-wc-opening',
    name: 'Winter Championship — Opening Event',
    description: 'Multi-day Opening Event. $325 entry, $75 hospo, 30k stack (from the structure card).',
    config: {
      name: 'Winter Championship Opening Event',
      shortDescription: 'Opening Event — Day 1 into Day 2.',
      isMultiDay: true,
      isMultiFlight: false,
      gameType: 'nlh',
      buyIn: 325_00,
      hospitalityCost: 75_00,
      guarantee: 0, // ⚑ not on the card — set per instance at create time
      houseConsumption: 0,
      structureTemplateId: 'st-opening',
      startingStack: 30_000,
      // "Players who bag more than once…" → multi-entry (re-entry, unlimited).
      reentryConfig: reentry('reentry', { maxReentries: null }),
      hasUpperDeckMainDeck: false,
      satelliteConfig: null,
      bountyPoolConfig: null,
    },
    ...auditFields(15),
  },
  {
    id: 'tt-wc-mainevent',
    name: 'Winter Championship — Main Event',
    description: 'Multi-day Main Event. $1,300 entry, $200 hospo, 100k stack (from the structure card).',
    config: {
      name: 'Winter Championship Main Event',
      shortDescription: 'Main Event — Day 1 through the final table.',
      isMultiDay: true,
      isMultiFlight: false,
      gameType: 'mainEvent',
      buyIn: 1_300_00,
      hospitalityCost: 200_00,
      guarantee: 0, // ⚑ not on the card
      houseConsumption: 0,
      structureTemplateId: 'st-mainevent',
      startingStack: 100_000,
      reentryConfig: reentry('reentry', { maxReentries: null }),
      hasUpperDeckMainDeck: false,
      satelliteConfig: null,
      bountyPoolConfig: null,
    },
    ...auditFields(15),
  },
  {
    id: 'tt-sixhundy',
    name: 'Sixhundy Sunday',
    description: 'Weekly $600 Sunday. Buy-in + structure are real; stack/hospo/guarantee are ⚑ estimates — confirm with managers.',
    config: {
      name: 'Sixhundy Sunday',
      shortDescription: 'Weekly $600 Sunday deepstack.',
      isMultiDay: false,
      isMultiFlight: false,
      gameType: 'nlh',
      buyIn: 600_00,
      hospitalityCost: 0, // ⚑ estimate — not provided
      guarantee: 0, // ⚑ estimate
      houseConsumption: 0,
      structureTemplateId: 'st-sixhundy',
      startingStack: 30_000, // ⚑ estimate — not provided
      reentryConfig: reentry('reentry', { maxReentries: null }),
      hasUpperDeckMainDeck: false,
      satelliteConfig: null,
      bountyPoolConfig: null,
    },
    ...auditFields(10),
  },
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
      structureTemplateId: 'st-30min',
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
      structureTemplateId: 'st-40min',
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
