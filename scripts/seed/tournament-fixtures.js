// Pure seed-data builders for tournaments, structure templates, and the
// multi-day / multi-flight session graphs that hang off them.
//
// This module is deliberately IO-free and imports nothing from `src/` (the app
// schemas use Vite-style extensionless imports that plain `node` can't resolve —
// which is why the existing seed scripts are self-contained). It depends only on
// `firebase/firestore` for Timestamp, so BOTH consumers can import it:
//
//   - scripts/seed/tournaments.js  (the runner) — `node`, writes to the emulator.
//   - src/lib/tournaments/seedTournaments.test.js  (the gate) — Vitest, parses
//     every doc this module builds against the REAL Zod schemas, so the seed can
//     never silently drift out of conformance.
//
// What buildSeedData() produces (see the requirements at the bottom of the test):
//   - 5 structure templates, each > 10 blind levels.
//   - 9 tournaments, most referencing a structure template (one PLO uses a
//     bespoke structure), with a spread of game types / statuses / re-entry rules.
//   - A `sessions` subcollection for EVERY tournament (single-day → one
//     play-to-a-winner session, matching createTournament), including three that
//     showcase the multi-day / multi-flight engine:
//       * Championship Main Event — pure multi-day (Day 1 → Day 2 → Day 3).
//       * Monthly Mystery Bounty  — multi-flight fan-in (Day 1A–1D → Day 2).
//       * $50K Mega Stack         — the general N→N→1 funnel (Day 1A–1D →
//         Day 2A–2B → Day 3), the routing-partition capability this branch adds.

import { Timestamp } from 'firebase/firestore'

// All scheduling is relative to import time so the seeded tournaments are always
// "upcoming" in the dev UI. Matches the existing seed scripts' `const NOW` idiom.
const NOW = Timestamp.now()

/** A Timestamp `dayOffset` days from now at local `hour`:`minute`. */
function at(dayOffset, hour = 19, minute = 0) {
  const d = new Date(NOW.toMillis())
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return Timestamp.fromDate(d)
}

/** A Timestamp `n` days in the past — for createdAt/updatedAt audit stamps. */
function daysAgo(n) {
  const d = new Date(NOW.toMillis())
  d.setDate(d.getDate() - n)
  return Timestamp.fromDate(d)
}

// ── Blind structures ─────────────────────────────────────────────────────────
// A single canonical blind ladder; each template takes a prefix of it. Keeps the
// progressions realistic and DRY rather than spelling out 80+ levels by hand.
const LADDER = [
  [100, 200], [200, 400], [300, 600], [400, 800], [500, 1000],
  [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000],
  [2500, 5000], [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000],
  [8000, 16000], [10000, 20000], [15000, 30000], [20000, 40000], [25000, 50000],
]

/**
 * Build a blind structure (a flat array of `level` / `break` entries) from a
 * prefix of LADDER. `blindNumber` runs 1..count across the level entries only;
 * breaks carry no number (matches the Structure schema's sequential invariant).
 * Big-blind antes kick in from `anteFromLevel`. A break is inserted after every
 * `breakEvery` levels (never trailing), alternating ordinary / color-up.
 */
function buildLevels(count, { durationMinutes, anteFromLevel = 5, breakEvery = 4, breakMinutes = 15 }) {
  const entries = []
  for (let i = 0; i < count; i++) {
    const [smallBlind, bigBlind] = LADDER[i]
    const blindNumber = i + 1
    const ante = blindNumber >= anteFromLevel ? bigBlind : 0 // big-blind ante
    entries.push({ type: 'level', blindNumber, smallBlind, bigBlind, ante, bringIn: 0, durationMinutes })
    if (blindNumber % breakEvery === 0 && i < count - 1) {
      const isColorUp = blindNumber % (breakEvery * 2) === 0
      entries.push({
        type: 'break',
        durationMinutes: breakMinutes,
        label: isColorUp ? 'Color-up break' : 'Break',
        isColorUp,
      })
    }
  }
  return entries
}

// 5 reusable structure templates, every one > 10 levels (12, 14, 15, 18, 20).
const STRUCTURE_TEMPLATES = [
  {
    id: 'st-me-showcase',
    name: 'Main Event (45-min, 20 levels)',
    description: 'Slow, deep structure for the multi-day Championship and Mega Stack.',
    levels: buildLevels(20, { durationMinutes: 45, anteFromLevel: 5, breakEvery: 4, breakMinutes: 20 }),
    createdAt: daysAgo(60), updatedAt: daysAgo(60), createdBy: 'seed-script', archivedAt: null,
  },
  {
    id: 'st-deepstack-18',
    name: 'Deepstack (40-min, 18 levels)',
    description: 'Marquee weekend deepstack; also feeds the multi-flight Mystery Bounty.',
    levels: buildLevels(18, { durationMinutes: 40, anteFromLevel: 5, breakEvery: 4, breakMinutes: 20 }),
    createdAt: daysAgo(55), updatedAt: daysAgo(55), createdBy: 'seed-script', archivedAt: null,
  },
  {
    id: 'st-standard',
    name: 'Standard (30-min, 15 levels)',
    description: 'The bread-and-butter weeknight structure.',
    levels: buildLevels(15, { durationMinutes: 30, anteFromLevel: 4, breakEvery: 4, breakMinutes: 15 }),
    createdAt: daysAgo(50), updatedAt: daysAgo(50), createdBy: 'seed-script', archivedAt: null,
  },
  {
    id: 'st-turbo-14',
    name: 'Turbo (15-min, 14 levels)',
    description: 'Fast evening turbo; also the satellite structure.',
    levels: buildLevels(14, { durationMinutes: 15, anteFromLevel: 4, breakEvery: 5, breakMinutes: 10 }),
    createdAt: daysAgo(45), updatedAt: daysAgo(45), createdBy: 'seed-script', archivedAt: null,
  },
  {
    id: 'st-hyper',
    name: 'Hyper-Turbo (8-min, 12 levels)',
    description: 'Late-night hyper for a quick last game.',
    levels: buildLevels(12, { durationMinutes: 8, anteFromLevel: 3, breakEvery: 6, breakMinutes: 5 }),
    createdAt: daysAgo(40), updatedAt: daysAgo(40), createdBy: 'seed-script', archivedAt: null,
  },
]

const STRUCTURE_BY_ID = Object.fromEntries(STRUCTURE_TEMPLATES.map((t) => [t.id, t]))

// A bespoke PLO structure (no big-blind antes) so one tournament demonstrates an
// embedded structure NOT sourced from a template (structureTemplateId === null).
const PLO_STRUCTURE = buildLevels(13, { durationMinutes: 30, anteFromLevel: 99, breakEvery: 4, breakMinutes: 15 })

// ── Config helpers ───────────────────────────────────────────────────────────

function reentry(type, { maxReentries = null, maxRebuys = null, hasAddOn = false, addOnCost = null, addOnChips = null } = {}) {
  return { type, maxReentries, maxRebuys, hasAddOn, addOnCost, addOnChips }
}

/** Build a byPercent payout structure from descending fractions (each in [0,1]). */
function byPercent(fractions, rounding = 'nearest5') {
  return {
    type: 'byPercent',
    rounding,
    positions: fractions.map((percent, i) => ({ place: i + 1, payout: 0, percent })),
  }
}

const PAYOUT_WTA = byPercent([1.0])
const PAYOUT_TOP3 = byPercent([0.5, 0.3, 0.2])
const PAYOUT_TOP5 = byPercent([0.4, 0.24, 0.16, 0.12, 0.08])
const PAYOUT_TOP9 = byPercent([0.32, 0.2, 0.135, 0.095, 0.07, 0.055, 0.045, 0.04, 0.04])

// ── Session graph ────────────────────────────────────────────────────────────
// Faithful port of src/lib/tournaments/sessions.js → buildSessionDocs, with two
// seed-only adaptations: (1) deterministic, human-readable session ids (so a
// re-run overwrites instead of duplicating, and the emulator UI is legible)
// rather than generateId() UUIDs; (2) a thrown plain Error instead of
// TournamentError. The slice tiling and convergence-from-partition wiring are
// identical — and every doc it returns is parsed by the real Session schema in
// the test, so a divergence fails CI. Keep in sync if canonical-schema §5.1 moves.

const flightLetter = (n) => String.fromCharCode(65 + n) // 0 → 'A', 1 → 'B', …

/** isMultiDay = more than one stage; isMultiFlight = any stage with >1 flight. */
export function deriveFormatFlags(stages) {
  return {
    isMultiDay: stages.length > 1,
    isMultiFlight: stages.some((stage) => (stage.flights?.length ?? 0) > 1),
  }
}

function buildSessionDocs({ stages, tournamentId, defaultScheduledStartTime, actorId, timestamp }) {
  // Pre-compute every flight's id so a flight can point at its (already-known)
  // downstream flight (convergesIntoSessionId is a forward reference).
  const idsByStage = stages.map((stage, i) =>
    stage.flights.map((_, f) => {
      const suffix = stage.flights.length > 1 ? flightLetter(f).toLowerCase() : ''
      return `sess-${tournamentId}-d${i + 1}${suffix}`
    }),
  )

  const docs = []
  let start = 0
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    const isFinal = i === stages.length - 1
    const maximumStartIndex = start
    const maximumEndIndex = isFinal ? (stage.endStructureIndex ?? null) : stage.endStructureIndex
    const playToPercentRemaining = stage.playToPercentRemaining ?? null
    const multiFlight = stage.flights.length > 1

    for (let f = 0; f < stage.flights.length; f++) {
      const flight = stage.flights[f]
      // The downstream flight is the next-stage flight whose survivorsFrom claims
      // this one. The routing partition guarantees exactly one (final → null).
      let convergesIntoSessionId = null
      if (!isFinal) {
        const g = stages[i + 1].flights.findIndex((nf) => (nf.survivorsFrom ?? []).includes(f))
        if (g < 0) {
          throw new Error(
            `Session plan for ${tournamentId}: Day ${i + 1} flight ${flightLetter(f)} converges nowhere ` +
              `(no Day ${i + 2} flight lists it in survivorsFrom).`,
          )
        }
        convergesIntoSessionId = idsByStage[i + 1][g]
      }
      const flightLabel = multiFlight ? flightLetter(f) : null
      const sessionLabel = multiFlight ? `Day ${i + 1}${flightLabel}` : `Day ${i + 1}`
      const scheduledStartTime = flight.scheduledStartTime ?? defaultScheduledStartTime

      docs.push({
        id: idsByStage[i][f],
        tournamentId,
        convergesIntoSessionId,
        dayNumber: i + 1,
        flightLabel,
        sessionLabel,
        maximumStartIndex,
        maximumEndIndex,
        playToPercentRemaining,
        actualStartIndex: null,
        actualEndIndex: null,
        scheduledStartTime,
        actualStartTime: null,
        actualEndTime: null,
        status: 'scheduled',
        currentStructureIndex: null,
        remainingPlayerCount: null,
        clockStartIndex: null,
        clockStartedAt: null,
        clockPausedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actorId,
      })
    }
    if (!isFinal) start = stage.endStructureIndex + 1
  }
  return docs
}

/**
 * Cross-session integrity checks the per-doc Session schema can't see (it
 * validates each session in isolation). Throws on the first problem so a broken
 * graph never reaches the emulator. The Vitest gate covers per-doc conformance.
 */
function assertSessionGraph(sessions, tournamentId, structureLength) {
  const ids = new Set(sessions.map((s) => s.id))
  const finals = sessions.filter((s) => s.convergesIntoSessionId === null)
  if (finals.length !== 1) {
    throw new Error(`${tournamentId}: expected exactly one final session, found ${finals.length}.`)
  }
  for (const s of sessions) {
    if (s.convergesIntoSessionId !== null && !ids.has(s.convergesIntoSessionId)) {
      throw new Error(`${tournamentId}: session ${s.id} converges into unknown session ${s.convergesIntoSessionId}.`)
    }
    if (s.maximumStartIndex < 0 || s.maximumStartIndex >= structureLength) {
      throw new Error(`${tournamentId}: ${s.id} maximumStartIndex ${s.maximumStartIndex} out of [0, ${structureLength}).`)
    }
    if (s.maximumEndIndex !== null && (s.maximumEndIndex < s.maximumStartIndex || s.maximumEndIndex >= structureLength)) {
      throw new Error(`${tournamentId}: ${s.id} maximumEndIndex ${s.maximumEndIndex} out of range.`)
    }
  }
  // Stages (grouped by dayNumber) must tile the structure contiguously from 0.
  const days = [...new Set(sessions.map((s) => s.dayNumber))].sort((a, b) => a - b)
  let expectedStart = 0
  for (const day of days) {
    const slice = sessions.find((s) => s.dayNumber === day)
    if (slice.maximumStartIndex !== expectedStart) {
      throw new Error(`${tournamentId}: Day ${day} starts at ${slice.maximumStartIndex}, expected ${expectedStart}.`)
    }
    if (day !== days[days.length - 1]) {
      if (slice.maximumEndIndex === null) throw new Error(`${tournamentId}: non-final Day ${day} must be capped.`)
      expectedStart = slice.maximumEndIndex + 1
    }
  }
}

// ── Tournament specs ─────────────────────────────────────────────────────────
// Each spec is the editorial intent; buildSeedData() fills the fields the form
// doesn't own (counters, live state, audit) the same way createTournament does.
// `start` / flight `start` are [dayOffset, hour] tuples converted to Timestamps
// at build time. A `sessionPlan` (omit for single-day) is `stages` of
// { endStructureIndex, flights:[{ start?, survivorsFrom?, playToPercentRemaining? }] }.

const TOURNAMENT_SPECS = [
  {
    id: 'tour-friday-nlh',
    name: 'Friday $150 NLH',
    shortDescription: 'Weekly Friday deepstack-lite.',
    gameType: 'nlh',
    buyIn: 150_00, hospitalityCost: 15_00, guarantee: 5_000_00, houseConsumption: 10_00,
    structureTemplateId: 'st-standard', startingStack: 30_000,
    payoutStructure: PAYOUT_TOP9, lateRegCutoffLevel: 8,
    reentryConfig: reentry('reentry', { maxReentries: 2 }),
    status: 'scheduled', start: [2, 19],
  },
  {
    id: 'tour-saturday-deepstack',
    name: 'Saturday $300 Deepstack',
    shortDescription: 'The big weekend single-day deepstack.',
    gameType: 'nlh',
    buyIn: 300_00, hospitalityCost: 25_00, guarantee: 15_000_00, houseConsumption: 20_00,
    structureTemplateId: 'st-deepstack-18', startingStack: 50_000,
    payoutStructure: PAYOUT_TOP9, lateRegCutoffLevel: 10,
    reentryConfig: reentry('reentry', { maxReentries: 1 }),
    status: 'scheduled', start: [3, 14],
  },
  {
    id: 'tour-thursday-turbo',
    name: 'Thursday $80 Turbo',
    shortDescription: 'Fast Thursday turbo, unlimited re-entry.',
    gameType: 'nlh',
    buyIn: 80_00, hospitalityCost: 10_00, guarantee: 2_000_00, houseConsumption: 8_00,
    structureTemplateId: 'st-turbo-14', startingStack: 20_000,
    payoutStructure: PAYOUT_TOP5, lateRegCutoffLevel: 6,
    reentryConfig: reentry('reentry', { maxReentries: null }), // null = unlimited
    status: 'lateRegOpen', start: [0, 19],
  },
  {
    id: 'tour-latenight-hyper',
    name: 'Late Night $50 Hyper',
    shortDescription: 'Hyper-turbo with a single add-on.',
    gameType: 'nlh',
    buyIn: 50_00, hospitalityCost: 5_00, guarantee: 1_000_00, houseConsumption: 5_00,
    structureTemplateId: 'st-hyper', startingStack: 15_000,
    payoutStructure: PAYOUT_TOP3, lateRegCutoffLevel: 5,
    reentryConfig: reentry('rebuy', { maxRebuys: 2, hasAddOn: true, addOnCost: 50_00, addOnChips: 20_000 }),
    status: 'scheduled', start: [1, 22],
  },
  {
    id: 'tour-me-satellite',
    name: 'Main Event Satellite $60',
    shortDescription: 'Win a seat into the Championship Main Event.',
    gameType: 'satellite',
    buyIn: 60_00, hospitalityCost: 5_00, guarantee: 0, houseConsumption: 5_00,
    structureTemplateId: 'st-turbo-14', startingStack: 15_000,
    payoutStructure: PAYOUT_WTA, lateRegCutoffLevel: null,
    reentryConfig: reentry('reentry', { maxReentries: null }),
    satelliteConfig: { ticketReward: 1_100_00 }, // a Championship seat
    status: 'lateRegOpen', start: [4, 18],
  },
  {
    id: 'tour-wednesday-plo',
    name: 'Wednesday $200 PLO',
    shortDescription: 'Pot-limit Omaha — bespoke structure, no antes.',
    gameType: 'plo',
    buyIn: 200_00, hospitalityCost: 15_00, guarantee: 3_000_00, houseConsumption: 15_00,
    structureTemplateId: null, structure: PLO_STRUCTURE, startingStack: 25_000,
    payoutStructure: PAYOUT_TOP5, lateRegCutoffLevel: 6,
    reentryConfig: reentry('freezeout'),
    status: 'draft', start: [7, 19],
  },

  // ── Multi-day / multi-flight showcases ──────────────────────────────────────

  {
    // Pure MULTI-DAY: one flight per day, Day 1 → Day 2 → Day 3 final.
    id: 'tour-championship',
    name: '★ Championship Main Event $1,100',
    shortDescription: '3-day Main Event. Day 1 → Day 2 → Day 3 final table.',
    gameType: 'mainEvent',
    buyIn: 1_100_00, hospitalityCost: 100_00, guarantee: 100_000_00, houseConsumption: 100_00,
    structureTemplateId: 'st-me-showcase', startingStack: 50_000,
    payoutStructure: PAYOUT_TOP9, lateRegCutoffLevel: 8,
    reentryConfig: reentry('reentry', { maxReentries: 1 }), // single Day-1 re-entry
    status: 'scheduled', start: [10, 12],
    sessionPlan: {
      stages: [
        { endStructureIndex: 9, flights: [{ start: [10, 12] }] }, // Day 1 → bag at the break after L8
        { endStructureIndex: 19, flights: [{ start: [11, 14], survivorsFrom: [0] }] }, // Day 2
        { endStructureIndex: null, flights: [{ start: [12, 14], survivorsFrom: [0] }] }, // Day 3 → winner
      ],
    },
  },
  {
    // MULTI-FLIGHT fan-in: four Day-1 flights all converge into one Day 2.
    id: 'tour-mystery-bounty',
    name: '★ Monthly Mystery Bounty $250',
    shortDescription: '4 Day-1 flights (A–D) funnel into a single Day 2.',
    gameType: 'mysteryBounty',
    buyIn: 250_00, hospitalityCost: 20_00, guarantee: 25_000_00, houseConsumption: 20_00,
    structureTemplateId: 'st-deepstack-18', startingStack: 40_000,
    payoutStructure: PAYOUT_TOP9, lateRegCutoffLevel: 8,
    reentryConfig: reentry('freezeout'),
    bountyPoolConfig: { totalPool: 25_000_00, bountyValues: [100_00, 250_00, 500_00, 1_000_00, 23_150_00] },
    status: 'scheduled', start: [5, 12],
    sessionPlan: {
      stages: [
        {
          endStructureIndex: 9, // each flight plays L1–L8, then bags
          flights: [
            { start: [5, 12], playToPercentRemaining: 15 }, // Day 1A
            { start: [5, 18], playToPercentRemaining: 15 }, // Day 1B
            { start: [6, 12], playToPercentRemaining: 15 }, // Day 1C
            { start: [6, 18], playToPercentRemaining: 15 }, // Day 1D
          ],
        },
        { endStructureIndex: null, flights: [{ start: [7, 13], survivorsFrom: [0, 1, 2, 3] }] }, // Day 2 → winner
      ],
    },
  },
  {
    // The general N→N→1 FUNNEL this branch enables: 4 → 2 → 1.
    id: 'tour-megastack',
    name: '★ $50K Mega Stack (4→2→1)',
    shortDescription: 'Day 1A–D → Day 2A–B → Day 3 final. WSOP-style funnel.',
    gameType: 'nlh',
    buyIn: 400_00, hospitalityCost: 30_00, guarantee: 50_000_00, houseConsumption: 25_00,
    structureTemplateId: 'st-me-showcase', startingStack: 50_000,
    payoutStructure: PAYOUT_TOP9, lateRegCutoffLevel: 8,
    reentryConfig: reentry('reentry', { maxReentries: 1 }),
    status: 'scheduled', start: [12, 12],
    sessionPlan: {
      stages: [
        {
          endStructureIndex: 9, // Day 1 flights → bag after L8
          flights: [
            { start: [12, 12] }, // Day 1A
            { start: [13, 12] }, // Day 1B
            { start: [14, 12] }, // Day 1C
            { start: [14, 18] }, // Day 1D
          ],
        },
        {
          endStructureIndex: 19, // Day 2 flights → bag after L16; the funnel narrows 4 → 2
          flights: [
            { start: [15, 14], survivorsFrom: [0, 1] }, // Day 2A ← Day 1A + 1B
            { start: [15, 18], survivorsFrom: [2, 3] }, // Day 2B ← Day 1C + 1D
          ],
        },
        { endStructureIndex: null, flights: [{ start: [16, 14], survivorsFrom: [0, 1] }] }, // Day 3 ← Day 2A + 2B
      ],
    },
  },
]

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Convert a [dayOffset, hour] tuple (or null/undefined) to a Timestamp/null. */
function startToTs(tuple) {
  if (!tuple) return null
  return at(tuple[0], tuple[1] ?? 12)
}

function buildTournamentDoc(spec, structure, flags, createdAt) {
  return {
    id: spec.id,
    legacyId: null,
    name: spec.name,
    shortDescription: spec.shortDescription ?? '',
    isMultiDay: flags.isMultiDay,
    isMultiFlight: flags.isMultiFlight,
    gameType: spec.gameType,
    buyIn: spec.buyIn,
    hospitalityCost: spec.hospitalityCost ?? 0,
    guarantee: spec.guarantee ?? 0,
    houseConsumption: spec.houseConsumption ?? 0,
    structureTemplateId: spec.structureTemplateId ?? null,
    startingStack: spec.startingStack,
    structure,
    payoutStructure: spec.payoutStructure ?? PAYOUT_WTA,
    scheduledStartTime: startToTs(spec.start),
    lateRegCutoffLevel: spec.lateRegCutoffLevel ?? null,
    status: spec.status ?? 'scheduled',
    isOnBreak: false,
    pausedAt: null,
    reentryConfig: spec.reentryConfig ?? reentry('freezeout'),
    hasUpperDeckMainDeck: spec.hasUpperDeckMainDeck ?? false,
    satelliteConfig: spec.satelliteConfig ?? null,
    bountyPoolConfig: spec.bountyPoolConfig ?? null,
    fromTemplateId: null,
    currentStructureIndex: null,
    entryCount: 0,
    uniquePlayerCount: 0,
    remainingPlayerCount: 0,
    totalPrizePool: 0,
    finishedAt: null,
    createdAt,
    updatedAt: createdAt,
    createdBy: 'seed-script',
    archivedAt: null,
  }
}

/**
 * Build every seed document. Pure — depends only on import-time `NOW`.
 *
 * @returns {{ structureTemplates: object[], tournaments: object[], sessions: Array<{tournamentId: string, doc: object}> }}
 */
export function buildSeedData() {
  const structureTemplates = STRUCTURE_TEMPLATES
  const tournaments = []
  const sessions = []

  TOURNAMENT_SPECS.forEach((spec, idx) => {
    // Structure: copied from the referenced template (as createTournament does),
    // or a bespoke embedded structure for the no-template case.
    const structure = spec.structure ?? STRUCTURE_BY_ID[spec.structureTemplateId]?.levels
    if (!structure) throw new Error(`${spec.id}: no structure (templateId=${spec.structureTemplateId}).`)

    // Normalize the session plan (single-day default) and convert flight starts.
    const rawStages = spec.sessionPlan?.stages ?? [
      { endStructureIndex: null, playToPercentRemaining: null, flights: [{ survivorsFrom: [] }] },
    ]
    const stages = rawStages.map((stage) => ({
      endStructureIndex: stage.endStructureIndex ?? null,
      playToPercentRemaining: stage.playToPercentRemaining ?? null,
      flights: stage.flights.map((flight) => ({
        scheduledStartTime: startToTs(flight.start),
        survivorsFrom: flight.survivorsFrom ?? [],
        playToPercentRemaining: flight.playToPercentRemaining ?? null,
      })),
    }))
    // Per-flight playToPercentRemaining (e.g. mystery-bounty Day 1s) overrides the
    // stage default; buildSessionDocs reads it off the stage, so push it down when
    // every flight in a stage shares one value.
    stages.forEach((stage) => {
      const perFlight = stage.flights.map((f) => f.playToPercentRemaining).filter((v) => v !== null)
      if (perFlight.length && stage.playToPercentRemaining === null) {
        stage.playToPercentRemaining = perFlight[0]
      }
    })

    const flags = deriveFormatFlags(stages)
    const createdAt = daysAgo(30 - idx) // stagger so the list has a stable order

    const sessionDocs = buildSessionDocs({
      stages,
      tournamentId: spec.id,
      defaultScheduledStartTime: startToTs(spec.start),
      actorId: 'seed-script',
      timestamp: createdAt,
    })
    assertSessionGraph(sessionDocs, spec.id, structure.length)

    tournaments.push(buildTournamentDoc(spec, structure, flags, createdAt))
    for (const doc of sessionDocs) sessions.push({ tournamentId: spec.id, doc })
  })

  return { structureTemplates, tournaments, sessions }
}
