// Tournament create + update operations. createTournament assembles a full
// Tournament document from the create form's inputs, filling the fields the form
// doesn't own — live state, derived counters, audit — then persists it with
// whole-document validation (validatedSet re-runs the schema's superRefine
// invariants before the write). updateTournament edits an existing tournament
// from the detail page via a read-modify-write transaction so the merged document
// is re-validated in full (a partial validatedUpdate would skip superRefine — see
// its WARNING; this mirrors templates.js reviseTemplate).
//
// Money arrives as integer cents and times as JS Date objects (the form's
// boundary); this module converts Date → Firestore Timestamp so the firebase
// dependency stays in the data layer. Role enforcement lives at the UI and
// Firestore-rules layers (manager + TD); this module assembles, validates, and
// writes a best-effort audit row — matching templates.js and the wallet/players
// domain modules.

import { Timestamp } from 'firebase/firestore'
import { validatedSet, runValidatedTransaction, auditLog, paths, generateId } from '../firestore'
import { Tournament } from '../schema'
import { now } from '../wallet/_shared'
import { TournamentError } from './errors'

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
 * Money fields are integer cents; scheduledStartTime / lateRegCutoffTime are JS
 * Date objects (lateReg may be null). The op fills the fields the form doesn't
 * own — counters, live state, audit — and validates the whole document before
 * the write. Pass payoutStructure=null to seed the winner-takes-all default.
 *
 * @param {object} args
 * @param {string} args.name
 * @param {string} [args.shortDescription]
 * @param {boolean} [args.isMultiDay]
 * @param {boolean} [args.isMultiFlight]
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
 * @param {Date|null} [args.lateRegCutoffTime]
 * @param {object} args.reentryConfig
 * @param {boolean} [args.hasUpperDeckMainDeck]
 * @param {object|null} [args.satelliteConfig]
 * @param {object|null} [args.bountyPoolConfig]
 * @param {string|null} [args.fromTemplateId]
 * @param {'draft'|'scheduled'} [args.status]
 * @param {string} args.actorId
 * @param {'manager'} args.actorRole
 */
export async function createTournament({
  name,
  shortDescription = '',
  isMultiDay = false,
  isMultiFlight = false,
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
  lateRegCutoffTime = null,
  reentryConfig,
  hasUpperDeckMainDeck = false,
  satelliteConfig = null,
  bountyPoolConfig = null,
  fromTemplateId = null,
  status = 'scheduled',
  actorId,
  actorRole,
}) {
  requireActor(actorId)
  const timestamp = now()
  const id = generateId()

  const created = await validatedSet(paths.tournamentPath(id), Tournament, {
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

    scheduledStartTime: toTimestamp(scheduledStartTime, 'scheduledStartTime'),
    lateRegCutoffTime: toNullableTimestamp(lateRegCutoffTime, 'lateRegCutoffTime'),

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
  if ('lateRegCutoffTime' in next) {
    next.lateRegCutoffTime = toNullableTimestamp(next.lateRegCutoffTime, 'lateRegCutoffTime')
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
 * Money fields are integer cents; scheduledStartTime / lateRegCutoffTime are JS
 * Date objects (lateReg may be null) and are converted to Timestamps here.
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
