// Template domain operations — reusable blind structures (`structureTemplates`)
// and reusable tournament configs (`tournamentTemplates`).
//
// Both are manager-only authoring tools that feed the tournament-create wizard:
// a tournament COPIES a structure template's levels at create time (editing the
// template later doesn't touch already-created tournaments — see
// canonical-schema.md §3.4), and a tournament template seeds the create form's
// defaults. Role enforcement lives at the UI and Firestore-rules layers; this
// module assembles the document, persists it, and writes a best-effort audit row
// (matching the players/wallet domain modules).
//
// Updates go through a read-modify-write transaction rather than a partial
// write so the full shape — including the `levels`/`config` superRefine
// invariants — is re-validated after the merge (see validatedUpdate's WARNING).

import {
  validatedSet,
  runValidatedTransaction,
  auditLog,
  paths,
  generateId,
} from '../firestore'
import { StructureTemplate, TournamentTemplate } from '../schema'
import { now } from '../wallet/_shared'
import { TournamentError } from './errors'

const TEMPLATE_KINDS = {
  structure: {
    path: paths.structureTemplatePath,
    schema: StructureTemplate,
    targetType: 'structureTemplate',
  },
  tournament: {
    path: paths.tournamentTemplatePath,
    schema: TournamentTemplate,
    targetType: 'tournamentTemplate',
  },
}

function requireActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new TournamentError('actorId is required (non-empty string)')
  }
}

function requireId(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TournamentError('template id is required (non-empty string)')
  }
}

// Assemble a full template document (audit fields + archivedAt) and persist it.
// `body` carries the kind-specific fields: structure → { name, description,
// levels }; tournament → { name, description, config }. validatedSet shape-checks
// the whole document before the write, so the post-commit audit row only runs on
// a genuinely-created template.
async function createTemplate({ kind, body, actorId, actorRole, actionType, metadata }) {
  requireActor(actorId)
  const { path, schema, targetType } = TEMPLATE_KINDS[kind]
  const timestamp = now()
  const id = generateId()

  const created = await validatedSet(path(id), schema, {
    id,
    ...body,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId,
    archivedAt: null,
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType,
    targetType,
    targetId: id,
    timestamp,
    metadata,
  })

  return created
}

// Read-modify-write a template, re-validating the full shape so a partial write
// can't leave an invariant-bearing field (`levels`, `config`) invalid.
async function reviseTemplate({ kind, id, patch, actorId, actorRole, actionType, metadata }) {
  requireActor(actorId)
  requireId(id)
  const { path, schema, targetType } = TEMPLATE_KINDS[kind]
  const timestamp = now()

  const updated = await runValidatedTransaction(async (tx) => {
    const current = await tx.get(path(id), schema)
    const next = { ...current, ...patch, updatedAt: timestamp }
    tx.set(path(id), schema, next)
    return next
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType,
    targetType,
    targetId: id,
    timestamp,
    metadata: metadata ?? {},
  })

  return updated
}

// ── Structure templates ─────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.name
 * @param {string|null} [args.description]
 * @param {import('../schema').Structure} args.levels  — level | break entries
 * @param {string} args.actorId
 * @param {'manager'} args.actorRole
 */
export function createStructureTemplate({ name, description = null, levels, actorId, actorRole }) {
  return createTemplate({
    kind: 'structure',
    body: { name, description, levels },
    actorId,
    actorRole,
    actionType: 'structureTemplate.created',
    metadata: { name, levelCount: Array.isArray(levels) ? levels.length : 0 },
  })
}

/**
 * @param {object} args
 * @param {string} args.id
 * @param {object} args.patch  — fields to overwrite (e.g. { name }, { levels })
 * @param {string} args.actorId
 * @param {'manager'} args.actorRole
 */
export function updateStructureTemplate({ id, patch, actorId, actorRole }) {
  return reviseTemplate({
    kind: 'structure',
    id,
    patch,
    actorId,
    actorRole,
    actionType: 'structureTemplate.updated',
    metadata: { changedFields: Object.keys(patch ?? {}) },
  })
}

/**
 * Soft-delete via archivedAt. The template stays readable for tournaments that
 * already copied it; it just stops appearing in the active picker.
 */
export function archiveStructureTemplate({ id, actorId, actorRole }) {
  return reviseTemplate({
    kind: 'structure',
    id,
    patch: { archivedAt: now() },
    actorId,
    actorRole,
    actionType: 'structureTemplate.archived',
    metadata: {},
  })
}

// ── Tournament templates ─────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.name
 * @param {string|null} [args.description]
 * @param {object} args.config  — TemplateConfig (see schema/tournamentTemplate.js)
 * @param {string} args.actorId
 * @param {'manager'} args.actorRole
 */
export function createTournamentTemplate({ name, description = null, config, actorId, actorRole }) {
  return createTemplate({
    kind: 'tournament',
    body: { name, description, config },
    actorId,
    actorRole,
    actionType: 'tournamentTemplate.created',
    metadata: { name, gameType: config?.gameType ?? null },
  })
}

/**
 * @param {object} args
 * @param {string} args.id
 * @param {object} args.patch  — fields to overwrite (e.g. { name }, { config })
 * @param {string} args.actorId
 * @param {'manager'} args.actorRole
 */
export function updateTournamentTemplate({ id, patch, actorId, actorRole }) {
  return reviseTemplate({
    kind: 'tournament',
    id,
    patch,
    actorId,
    actorRole,
    actionType: 'tournamentTemplate.updated',
    metadata: { changedFields: Object.keys(patch ?? {}) },
  })
}

/** Soft-delete via archivedAt — see archiveStructureTemplate. */
export function archiveTournamentTemplate({ id, actorId, actorRole }) {
  return reviseTemplate({
    kind: 'tournament',
    id,
    patch: { archivedAt: now() },
    actorId,
    actorRole,
    actionType: 'tournamentTemplate.archived',
    metadata: {},
  })
}
