// Tournament create + update operations. createTournament assembles a full
// Tournament document from the create form's inputs, filling the fields the form
// doesn't own — live state, derived counters, audit — AND builds the tournament's
// session graph (the tournaments/{tid}/sessions subcollection — see §5.1), then
// persists the tournament doc and every session in ONE atomic batched write so a
// half-created tournament with dangling convergence pointers is impossible. Each
// write is whole-document validated (the batch re-runs the schema's superRefine
// invariants before commit). updateTournament edits an existing tournament from
// the detail page via a read-modify-write transaction so the merged document is
// re-validated in full (a partial validatedUpdate would skip superRefine — see
// its WARNING; this mirrors templates.js reviseTemplate).
//
// Money arrives as integer cents and times as JS Date objects (the form's
// boundary); this module converts Date → Firestore Timestamp so the firebase
// dependency stays in the data layer. The session graph itself (UUID
// pre-generation, convergesIntoSessionId wiring, slice tiling, cross-session
// invariants) lives in ./sessions; this module just converts times and drives
// the atomic write. Role enforcement lives at the UI and Firestore-rules layers
// (manager + TD); this module assembles, validates, and writes a best-effort
// audit row — matching templates.js and the wallet/players domain modules.

import { Timestamp } from 'firebase/firestore'
import { runValidatedTransaction, runValidatedBatch, auditLog, paths, generateId } from '../firestore'
import { Tournament, Session } from '../schema'
import { now } from '../wallet/_shared'
import { TournamentError } from './errors'
import { buildSessionDocs, deriveFormatFlags, SINGLE_DAY_PLAN } from './sessions'
import { ALL_STATUSES, isDefaultTransition } from '../tournamentStatus'

// Winner-takes-all placeholder. The create form doesn't edit payouts yet (that's
// the payout editor, task 2.3); the schema requires a non-null PayoutStructure
// with at least one position, so seed a valid default the TD refines later.
const DEFAULT_PAYOUT = {
  type: 'byPercent',
  rounding: 'nearest5',
  positions: [{ place: 1, payout: 0, percent: 1 }],
}

function requireActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new TournamentError('actorId is required (non-empty string)')
  }
}

function requireId(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TournamentError('tournament id is required (non-empty string)')
  }
}

// Form boundary → Firestore Timestamp. Accepts a Date (what the form builds from
// its datetime-local input) or an existing Timestamp; rejects anything else so a
// bad value surfaces as a TournamentError rather than a downstream schema error.
function toTimestamp(value, field) {
  if (value instanceof Timestamp) return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) return Timestamp.fromDate(value)
  throw new TournamentError(`${field} must be a valid Date`)
}

function toNullableTimestamp(value, field) {
  if (value === null || value === undefined) return null
  return toTimestamp(value, field)
}

/**
 * Create a new tournament from the create-form inputs.
 *
 * Money fields are integer cents; scheduledStartTime is a JS Date (lateRegCutoffLevel
 * is a plain blindNumber, or null). The op fills the fields the form doesn't
 * own — counters, live state, audit — builds the session graph from sessionPlan,
 * and writes the tournament doc + every session in one atomic batch (each
 * whole-document validated). isMultiDay / isMultiFlight are DERIVED from the plan
 * so the denormalized booleans can never drift from the subcollection. Pass
 * payoutStructure=null to seed the winner-takes-all default, and omit sessionPlan
 * for a plain single-day (single play-to-a-winner session) tournament.
 *
 * @param {object} args
 * @param {string} args.name
 * @param {string} [args.shortDescription]
 * @param {string} args.gameType
 * @param {number} args.buyIn               — cents
 * @param {number} [args.hospitalityCost]   — cents
 * @param {number} [args.guarantee]         — cents
 * @param {number} [args.houseConsumption]  — cents
 * @param {string|null} [args.structureTemplateId]
 * @param {number} args.startingStack       — chips
 * @param {import('../schema').Structure} args.structure
 * @param {object|null} [args.payoutStructure]  — null → winner-takes-all default
 * @param {Date} args.scheduledStartTime
 * @param {number|null} [args.lateRegCutoffLevel]  — blindNumber late reg runs through (null = none)
 * @param {object} args.reentryConfig
 * @param {boolean} [args.hasUpperDeckMainDeck]
 * @param {object|null} [args.satelliteConfig]
 * @param {object|null} [args.bountyPoolConfig]
 * @param {string|null} [args.fromTemplateId]
 * @param {'draft'|'scheduled'} [args.status]
 * @param {{stages: Array<{endStructureIndex:number|null, playToPercentRemaining:number|null, flights:Array<{scheduledStartTime:(Date|null), survivorsFrom:number[]}>}>}|null} [args.sessionPlan]
 *        — null → single play-to-a-winner session (see ./sessions SINGLE_DAY_PLAN)
 * @param {string} args.actorId
 * @param {'manager'} args.actorRole
 */
export async function createTournament({
  name,
  shortDescription = '',
  gameType,
  buyIn,
  hospitalityCost = 0,
  guarantee = 0,
  houseConsumption = 0,
  structureTemplateId = null,
  startingStack,
  structure,
  payoutStructure = null,
  scheduledStartTime,
  lateRegCutoffLevel = null,
  reentryConfig,
  hasUpperDeckMainDeck = false,
  satelliteConfig = null,
  bountyPoolConfig = null,
  fromTemplateId = null,
  status = 'scheduled',
  sessionPlan = null,
  actorId,
  actorRole,
}) {
  requireActor(actorId)
  const timestamp = now()
  const id = generateId()

  // Convert the schedule once (throws TournamentError on a bad value before any
  // write); Day 1's session reuses the tournament start.
  const scheduledStartTs = toTimestamp(scheduledStartTime, 'scheduledStartTime')

  // Normalize the session plan (defaulting to single-day) and convert each
  // flight's optional start time to a Timestamp. isMultiDay / isMultiFlight follow.
  const planStages = (sessionPlan?.stages ?? SINGLE_DAY_PLAN.stages).map((stage) => ({
    endStructureIndex: stage.endStructureIndex ?? null,
    playToPercentRemaining: stage.playToPercentRemaining ?? null,
    flights: (stage.flights ?? []).map((flight) => ({
      scheduledStartTime: toNullableTimestamp(flight.scheduledStartTime ?? null, 'session.scheduledStartTime'),
      survivorsFrom: flight.survivorsFrom ?? [],
    })),
  }))
  const { isMultiDay, isMultiFlight } = deriveFormatFlags(planStages)

  // Throws TournamentError on an unsound plan (non-tiling slices, bad routing
  // partition, flighted final day, out-of-bounds level) before any write.
  const sessionDocs = buildSessionDocs({
    stages: planStages,
    tournamentId: id,
    structureLength: Array.isArray(structure) ? structure.length : 0,
    defaultScheduledStartTime: scheduledStartTs,
    actorId,
    timestamp,
  })

  const tournamentDoc = {
    id,
    legacyId: null,

    name,
    shortDescription,

    isMultiDay,
    isMultiFlight,

    gameType,

    buyIn,
    hospitalityCost,
    guarantee,
    houseConsumption,

    structureTemplateId,
    startingStack,
    structure,

    payoutStructure: payoutStructure ?? DEFAULT_PAYOUT,

    scheduledStartTime: scheduledStartTs,
    lateRegCutoffLevel,

    status,
    isOnBreak: false,
    pausedAt: null,

    reentryConfig,

    hasUpperDeckMainDeck,

    satelliteConfig,
    bountyPoolConfig,

    fromTemplateId,

    currentStructureIndex: null,

    entryCount: 0,
    uniquePlayerCount: 0,
    remainingPlayerCount: 0,
    totalPrizePool: 0,

    finishedAt: null,

    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId,
    archivedAt: null,
  }

  // Tournament + every session land together, or nothing does — no dangling
  // convergence pointers (§5.1). Each write is whole-document validated.
  let created
  await runValidatedBatch(async (b) => {
    created = b.set(paths.tournamentPath(id), Tournament, tournamentDoc)
    for (const session of sessionDocs) {
      b.set(paths.sessionPath(id, session.id), Session, session)
    }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'tournament.created',
    targetType: 'tournament',
    targetId: id,
    timestamp,
    metadata: { name, gameType, status },
  })

  return created
}

// Convert the date-typed fields a patch may carry (Date from the detail form's
// datetime-local input) into Firestore Timestamps, leaving every other key
// untouched. Only keys actually present are converted, so a patch that doesn't
// touch the schedule passes through unchanged.
function normalizeTournamentPatch(patch) {
  const next = { ...patch }
  if ('scheduledStartTime' in next) {
    next.scheduledStartTime = toTimestamp(next.scheduledStartTime, 'scheduledStartTime')
  }
  return next
}

/**
 * Update an existing tournament from the detail page.
 *
 * Read-modify-write inside a validated transaction so the merged document is
 * re-validated against the full schema (including superRefine invariants) — a
 * partial validatedUpdate would skip that. The caller is responsible for the
 * patch only containing editable fields; live state (status, isOnBreak,
 * pausedAt, currentStructureIndex), derived counters, and audit fields are
 * owned elsewhere (the clock and status-transition ops) and shouldn't appear
 * in a detail-form patch.
 *
 * Money fields are integer cents; scheduledStartTime is a JS Date converted to a
 * Timestamp here; lateRegCutoffLevel is a plain blindNumber that passes through.
 * updatedAt is always stamped server-side at write time.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {object} args.patch  — editable fields to overwrite
 * @param {string} args.actorId
 * @param {'manager'|'td'} args.actorRole
 * @param {string} [args.actionType]  — e.g. 'tournament.structureEdited' for the structure tab
 */
export async function updateTournament({
  id,
  patch,
  actorId,
  actorRole,
  actionType = 'tournament.updated',
}) {
  requireActor(actorId)
  requireId(id)
  const timestamp = now()
  const safePatch = normalizeTournamentPatch(patch ?? {})

  const updated = await runValidatedTransaction(async (tx) => {
    const current = await tx.get(paths.tournamentPath(id), Tournament)
    const next = { ...current, ...safePatch, updatedAt: timestamp }
    tx.set(paths.tournamentPath(id), Tournament, next)
    return next
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType,
    targetType: 'tournament',
    targetId: id,
    timestamp,
    metadata: { changedFields: Object.keys(patch ?? {}) },
  })

  return updated
}

/**
 * Change a tournament's lifecycle status (the floor-controls flow, task 2.7).
 *
 * The standard sequence (draft → scheduled → lateRegOpen → lateRegClosed →
 * finished, plus cancel from any non-terminal status) is open to manager + TD.
 * A NON-STANDARD transition (reopening late reg, un-finishing, un-publishing,
 * skipping the field) requires actorRole 'manager' AND a managerOverride
 * `{reason}`; it emits an extra `manager.override` audit row alongside the
 * `tournament.statusChanged` one. `finishedAt` is stamped on entering 'finished'
 * and cleared if an override leaves it. Read-modify-write so the whole document
 * re-validates (a partial update would skip superRefine). The session clock
 * (task 2.6) owns session status separately; this is the tournament-level axis.
 *
 * @param {object} args
 * @param {string} args.id
 * @param {'draft'|'scheduled'|'lateRegOpen'|'lateRegClosed'|'finished'|'cancelled'} args.toStatus
 * @param {string} args.actorId
 * @param {'manager'|'td'} args.actorRole
 * @param {{reason: string}|null} [args.managerOverride]  — required for non-standard transitions
 */
export async function setTournamentStatus({ id, toStatus, actorId, actorRole, managerOverride = null }) {
  requireActor(actorId)
  requireId(id)
  if (!ALL_STATUSES.includes(toStatus)) {
    throw new TournamentError(`unknown status "${toStatus}"`)
  }
  const timestamp = now()
  let fromStatus
  let usedOverride = false

  const updated = await runValidatedTransaction(async (tx) => {
    const current = await tx.get(paths.tournamentPath(id), Tournament)
    fromStatus = current.status
    if (fromStatus === toStatus) {
      throw new TournamentError(`tournament is already ${toStatus}`)
    }
    if (!isDefaultTransition(fromStatus, toStatus)) {
      // Non-standard transition: manager-only, with a reason.
      if (actorRole !== 'manager') {
        throw new TournamentError(
          `${fromStatus} → ${toStatus} is not a standard step; a manager override is required`,
        )
      }
      if (!managerOverride || typeof managerOverride.reason !== 'string' || managerOverride.reason.trim() === '') {
        throw new TournamentError('a manager override reason is required for this transition')
      }
      usedOverride = true
    }
    const next = { ...current, status: toStatus, updatedAt: timestamp }
    if (toStatus === 'finished') next.finishedAt = timestamp
    else if (fromStatus === 'finished') next.finishedAt = null
    tx.set(paths.tournamentPath(id), Tournament, next)
    return next
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'tournament.statusChanged',
    targetType: 'tournament',
    targetId: id,
    timestamp,
    metadata: { from: fromStatus, to: toStatus, override: usedOverride },
  })
  if (usedOverride) {
    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole: 'manager',
      actionType: 'manager.override',
      targetType: 'tournament',
      targetId: id,
      timestamp,
      metadata: {
        overrideType: 'tournamentStatusTransition',
        reason: managerOverride.reason,
        from: fromStatus,
        to: toStatus,
      },
    })
  }

  return updated
}
