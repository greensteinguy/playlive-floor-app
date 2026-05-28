// Typed access for the `auditLog` top-level collection.
//
// Convention: writes here are best-effort. They should never block or fail an
// underlying operation — use writeAuditLogSafe (which catches and console.warn's)
// in the path of user-facing actions. writeAuditLog (which throws) is fine for
// scripted / scheduled use where you actually want to know if the log failed.

import { Timestamp } from 'firebase/firestore'
import { AuditLogEntry } from '../schema'
import { validatedGetMany, validatedSet } from './_client'
import { auditLogPath, auditLogCollectionPath } from './_paths'
import { generateId } from './_ids'

/**
 * Write an audit log entry. Throws on validation or write failure.
 *
 * @param {object} params
 * @param {string} params.actorId  - auth uid, or 'system' for automated jobs
 * @param {'manager'|'td'|'cashier'|'readonly'|'system'} params.actorRole
 * @param {string} params.actionType  - dot-separated, e.g. 'wallet.deposit'
 * @param {string|null} [params.targetType]
 * @param {string|null} [params.targetId]
 * @param {object} [params.metadata]  - free-form context for this action type
 * @param {Timestamp} [params.timestamp]  - defaults to now
 */
export async function writeAuditLog({
  actorId,
  actorRole,
  actionType,
  targetType = null,
  targetId = null,
  metadata = {},
  timestamp = Timestamp.now(),
}) {
  const id = generateId()
  return validatedSet(auditLogPath(id), AuditLogEntry, {
    id,
    timestamp,
    actorId,
    actorRole,
    actionType,
    targetType,
    targetId,
    metadata,
  })
}

/**
 * Same as writeAuditLog but swallows errors (logged to console). Use this in
 * the path of user-facing operations where a failed audit write shouldn't
 * break the user's flow.
 */
export async function writeAuditLogSafe(params) {
  try {
    await writeAuditLog(params)
  } catch (e) {
    // Intentional non-throw: audit log writes are best-effort during normal app flow.

    console.warn('[auditLog] write failed (continuing):', e)
  }
}

export function listAuditLog(queryFn) {
  return validatedGetMany(auditLogCollectionPath(), AuditLogEntry, queryFn)
}
