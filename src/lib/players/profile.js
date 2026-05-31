// Player profile create + update — Phase 3 tasks 3.1 (profile) + 3.3 (quick-create).
//
// createPlayer assembles a full Player document from the quick-create form's
// inputs, filling the fields the form doesn't own — zeroed wallet/ticket/deposit
// balances, cleared merge flags, audit/standard fields — and persists it
// whole-document validated (validatedSet re-parses the WHOLE doc through the
// Player schema incl. superRefine, so a written player is a proven-valid player),
// then writes a best-effort `player.created` audit row. updatePlayer edits an
// existing profile via a read-modify-write transaction so the merged document
// re-validates in full (a partial validatedUpdate would skip superRefine — see
// firestore/_client.js's WARNING; this mirrors tournaments.js updateTournament
// and templates.js reviseTemplate).
//
// Balances (walletBalance, ticketBalance, totalDeposited) and merge/identity
// fields are NEVER written through this module: wallet balances move only via the
// wallet module's atomic ledger transactions, and merge state only via the dedupe
// tool (./merge). updatePlayer rejects a patch that names any protected field
// before it touches Firestore, so a profile edit can't drift the cached balances
// or rewrite identity. Role enforcement (players write = manager + cashier) lives
// at the UI and Firestore-rules layers; this module assembles, validates, writes,
// and audits — matching tournaments.js and the wallet / merge domain ops.

import { validatedSet, runValidatedTransaction, auditLog, paths, generateId } from '../firestore'
import { Player } from '../schema'
import { now } from '../wallet/_shared'
import { PlayerError } from './errors'

// Cached balance fields owned by the wallet ledger — never editable via a profile
// patch (they would drift from the walletTransactions subcollection).
const BALANCE_FIELDS = ['walletBalance', 'ticketBalance', 'totalDeposited']

// Identity / lifecycle fields a profile edit must not touch — owned by create,
// the merge tool, or the write machinery.
const PROTECTED_FIELDS = [
  'id',
  'legacyId',
  'isMerged',
  'mergedIntoId',
  'mergedAt',
  'createdAt',
  'createdBy',
  'updatedAt',
  ...BALANCE_FIELDS,
]

// Nullable free-text fields: '' (or whitespace) collapses to null so a cleared
// form input doesn't fail the schema's .email() / CountryCode checks on an empty
// string.
const NULLABLE_STRING_FIELDS = ['displayName', 'email', 'streetAddress', 'countryCode']

function requireActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new PlayerError('actorId is required (non-empty string)')
  }
}

function requireNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PlayerError(`${field} is required (non-empty string)`)
  }
  return value.trim()
}

// undefined / null / '' → null; otherwise a trimmed string.
function optionalString(value) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Create a new player from the quick-create form.
 *
 * first/last/phone are mandatory (non-empty); displayName / email / streetAddress
 * / countryCode are optional and collapse '' → null. Balances start at 0 and the
 * merge flags start cleared. Returns the validated, persisted Player document.
 *
 * @param {object} args
 * @param {string} args.firstName
 * @param {string} args.lastName
 * @param {string|null} [args.displayName]
 * @param {string} args.phone
 * @param {string|null} [args.email]
 * @param {string|null} [args.streetAddress]
 * @param {string|null} [args.countryCode]
 * @param {string} args.actorId
 * @param {'manager'|'cashier'} args.actorRole
 */
export async function createPlayer({
  firstName,
  lastName,
  displayName = null,
  phone,
  email = null,
  streetAddress = null,
  countryCode = null,
  actorId,
  actorRole,
}) {
  requireActor(actorId)
  const timestamp = now()
  const id = generateId()

  const playerDoc = {
    id,
    legacyId: null,

    firstName: requireNonEmpty(firstName, 'firstName'),
    lastName: requireNonEmpty(lastName, 'lastName'),
    displayName: optionalString(displayName),

    phone: requireNonEmpty(phone, 'phone'),
    email: optionalString(email),
    streetAddress: optionalString(streetAddress),
    countryCode: optionalString(countryCode),

    walletBalance: 0,
    ticketBalance: 0,
    totalDeposited: 0,

    isMerged: false,
    mergedIntoId: null,
    mergedAt: null,

    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId,
    archivedAt: null,
  }

  // validatedSet re-parses the whole doc through the Player schema (incl.
  // superRefine) before writing — a malformed email / country code surfaces as a
  // ValidationError here rather than a bad row landing in Firestore.
  const created = await validatedSet(paths.playerPath(id), Player, playerDoc)

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'player.created',
    targetType: 'player',
    targetId: id,
    timestamp,
    metadata: { firstName: playerDoc.firstName, lastName: playerDoc.lastName, phone: playerDoc.phone },
  })

  return created
}

// Collapse '' → null on the nullable free-text fields a patch may carry, leaving
// every other key untouched (only keys actually present are normalized).
function normalizePlayerPatch(patch) {
  const next = { ...patch }
  for (const field of NULLABLE_STRING_FIELDS) {
    if (field in next) next[field] = optionalString(next[field])
  }
  return next
}

/**
 * Update an existing player's profile from the detail page.
 *
 * Read-modify-write inside a validated transaction so the merged document
 * re-validates against the full Player schema (including superRefine) — a partial
 * validatedUpdate would skip that. The patch may only carry editable profile
 * fields; naming a protected field (any balance, merge, identity, or audit field)
 * throws before any write, so a profile edit can never drift the cached balances
 * (those move only through the wallet module).
 *
 * @param {object} args
 * @param {string} args.id
 * @param {object} args.patch  — editable profile fields to overwrite
 * @param {string} args.actorId
 * @param {'manager'|'cashier'} args.actorRole
 */
export async function updatePlayer({ id, patch, actorId, actorRole }) {
  requireActor(actorId)
  if (typeof id !== 'string' || id.trim() === '') {
    throw new PlayerError('player id is required (non-empty string)')
  }
  const rawPatch = patch ?? {}

  const blocked = Object.keys(rawPatch).filter((k) => PROTECTED_FIELDS.includes(k))
  if (blocked.length > 0) {
    throw new PlayerError(
      `updatePlayer patch may not include protected field(s): ${blocked.join(', ')}. ` +
        `Wallet/ticket balances move only through the wallet module; merge state via the dedupe tool.`,
    )
  }

  const safePatch = normalizePlayerPatch(rawPatch)
  const timestamp = now()

  const updated = await runValidatedTransaction(async (tx) => {
    const current = await tx.get(paths.playerPath(id), Player)
    const next = { ...current, ...safePatch, updatedAt: timestamp }
    tx.set(paths.playerPath(id), Player, next)
    return next
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'player.updated',
    targetType: 'player',
    targetId: id,
    timestamp,
    metadata: { changedFields: Object.keys(rawPatch) },
  })

  return updated
}
