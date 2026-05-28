// Generic validated Firestore helpers. Every read and write in the app goes
// through one of these, and every read/write is shape-checked by a Zod schema.
//
// Functions exported here are intentionally low-level — they take a `pathParts`
// array, a schema, and a payload. Per-collection wrappers (./tournaments.js,
// ./players.js, etc.) provide ergonomic call sites over the top.
//
// Per ADR-001 the Floor App is online-only — no offline persistence is enabled.
// In mock mode (VITE_USE_MOCK_DATA=true) these helpers throw MockModeError;
// app code that wants to work in mock mode should branch on USE_MOCK_DATA
// from src/firebase/config.

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  runTransaction,
  writeBatch,
} from 'firebase/firestore'
import { db, USE_MOCK_DATA } from '../../firebase/config'
import { NotFoundError, ValidationError, MockModeError } from './_errors'

function ensureLive() {
  if (USE_MOCK_DATA) throw new MockModeError()
}

/**
 * Attach the doc's id to its data (Firestore stores the id implicitly via the
 * path; our schemas include it as a field). Used by every read helper.
 */
function attachId(snap) {
  return { id: snap.id, ...snap.data() }
}

/**
 * Strip the id from data before persisting (id lives in the path, not the doc body).
 * Used by every write helper.
 */
function stripId(data) {
  // eslint-disable-next-line no-unused-vars
  const { id, ...rest } = data
  return rest
}

/**
 * Validate data against a schema; throw ValidationError on failure.
 */
function validateOrThrow(pathParts, schema, data, direction) {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ValidationError(pathParts, result.error, direction)
  }
  return result.data
}

// ── Reads ──────────────────────────────────────────────────────────────────

/**
 * Read a single document, validate it, and return the parsed shape.
 * Throws NotFoundError if missing; ValidationError if shape is wrong.
 */
export async function validatedGet(pathParts, schema) {
  ensureLive()
  const ref = doc(db, ...pathParts)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new NotFoundError(pathParts)
  return validateOrThrow(pathParts, schema, attachId(snap), 'read')
}

/**
 * Read multiple documents from a collection (or filtered query), validate each,
 * return an array of parsed shapes.
 *
 * @param {string[]} pathParts  - the collection path
 * @param {import('zod').ZodSchema} schema  - the schema each doc must conform to
 * @param {(collRef: import('firebase/firestore').CollectionReference) => import('firebase/firestore').Query} [queryFn]
 *   - optional function to apply where/orderBy/limit clauses
 */
export async function validatedGetMany(pathParts, schema, queryFn) {
  ensureLive()
  const collRef = collection(db, ...pathParts)
  const q = queryFn ? queryFn(collRef) : collRef
  const snap = await getDocs(q)
  return snap.docs.map((docSnap) => {
    const data = attachId(docSnap)
    return validateOrThrow([...pathParts, docSnap.id], schema, data, 'read')
  })
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Write (overwrite) a full document. The data must include the full shape per
 * the schema (this is a `set`, not an `update` — use validatedUpdate for partials).
 *
 * The id from pathParts is automatically merged into the data for validation;
 * it's then stripped before persisting (Firestore stores the id via the path).
 */
export async function validatedSet(pathParts, schema, data) {
  ensureLive()
  const id = pathParts[pathParts.length - 1]
  const validated = validateOrThrow(pathParts, schema, { ...data, id }, 'write')
  await setDoc(doc(db, ...pathParts), stripId(validated))
  return validated
}

/**
 * Partial update. The data is a Firestore-shaped update object (fields can use
 * dot notation for nested updates, FieldValue helpers, etc.).
 *
 * WARNING: partial updates are NOT validated against the full schema — Zod can't
 * sensibly validate a partial document with cross-field invariants. Caller is
 * responsible for ensuring the update keeps the resulting document valid.
 * For changes that touch invariant-bearing fields, prefer read-modify-write via
 * runValidatedTransaction (which can re-validate the full shape after merge).
 */
export async function validatedUpdate(pathParts, partialData) {
  ensureLive()
  await updateDoc(doc(db, ...pathParts), partialData)
}

/**
 * Hard delete. Soft delete via archivedAt is preferred per canonical-schema.md §1
 * for collections that have it — use validatedUpdate to set archivedAt instead.
 * This helper exists for genuine deletes (e.g., abandoned drafts).
 */
export async function validatedDelete(pathParts) {
  ensureLive()
  await deleteDoc(doc(db, ...pathParts))
}

// ── Subscriptions (real-time listeners) ────────────────────────────────────

/**
 * Subscribe to changes on a single document. Returns an unsubscribe function.
 * Calls onUpdate with the validated data on each change; onError on validation
 * or network failure.
 */
export function subscribeToDoc(pathParts, schema, onUpdate, onError = () => {}) {
  ensureLive()
  const ref = doc(db, ...pathParts)
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onError(new NotFoundError(pathParts))
        return
      }
      try {
        const data = validateOrThrow(pathParts, schema, attachId(snap), 'read')
        onUpdate(data)
      } catch (err) {
        onError(err)
      }
    },
    onError
  )
}

/**
 * Subscribe to changes on a collection (or filtered query). Returns an
 * unsubscribe function. Calls onUpdate with the validated array on each change.
 */
export function subscribeToCollection(pathParts, schema, onUpdate, queryFn, onError = () => {}) {
  ensureLive()
  const collRef = collection(db, ...pathParts)
  const q = queryFn ? queryFn(collRef) : collRef
  return onSnapshot(
    q,
    (snap) => {
      try {
        const data = snap.docs.map((docSnap) =>
          validateOrThrow(
            [...pathParts, docSnap.id],
            schema,
            attachId(docSnap),
            'read'
          )
        )
        onUpdate(data)
      } catch (err) {
        onError(err)
      }
    },
    onError
  )
}

// ── Transactions ───────────────────────────────────────────────────────────

/**
 * Run a function inside a Firestore transaction. The function receives a `tx`
 * object exposing validated get/set/update/delete that work within the transaction.
 *
 * Transaction reads happen at a consistent snapshot; writes are deferred until
 * the function returns. Firestore retries up to ~5 times on contention.
 *
 * Use this for any operation that needs atomicity across multiple documents
 * (wallet spend + entry write, withdrawal complete, ticket use, etc.).
 *
 * Example:
 *   await runValidatedTransaction(async (tx) => {
 *     const player = await tx.get(playerPath(pid), Player)
 *     if (player.walletBalance < amount) throw new Error('insufficient')
 *     tx.set(walletTransactionPath(pid, generateId()), WalletTransaction, { ... })
 *     tx.update(playerPath(pid), { walletBalance: player.walletBalance - amount })
 *   })
 */
export async function runValidatedTransaction(fn) {
  ensureLive()
  return runTransaction(db, async (firestoreTx) => {
    const tx = {
      get: async (pathParts, schema) => {
        const ref = doc(db, ...pathParts)
        const snap = await firestoreTx.get(ref)
        if (!snap.exists()) throw new NotFoundError(pathParts)
        return validateOrThrow(pathParts, schema, attachId(snap), 'read')
      },
      set: (pathParts, schema, data) => {
        const id = pathParts[pathParts.length - 1]
        const validated = validateOrThrow(pathParts, schema, { ...data, id }, 'write')
        firestoreTx.set(doc(db, ...pathParts), stripId(validated))
        return validated
      },
      // Partial update inside a transaction — same caveat as validatedUpdate:
      // not validated against the full schema. Caller's responsibility.
      update: (pathParts, partialData) => {
        firestoreTx.update(doc(db, ...pathParts), partialData)
      },
      delete: (pathParts) => {
        firestoreTx.delete(doc(db, ...pathParts))
      },
    }
    return fn(tx)
  })
}

/**
 * Run a function with a write batch (multiple writes, no reads, all-or-nothing
 * commit). Lighter-weight than a transaction — no contention/retry. Use for
 * known-good batched creates (e.g., creating all sessions for a multi-day
 * tournament in one atomic write).
 */
export async function runValidatedBatch(fn) {
  ensureLive()
  const batch = writeBatch(db)
  const batchHelpers = {
    set: (pathParts, schema, data) => {
      const id = pathParts[pathParts.length - 1]
      const validated = validateOrThrow(pathParts, schema, { ...data, id }, 'write')
      batch.set(doc(db, ...pathParts), stripId(validated))
      return validated
    },
    update: (pathParts, partialData) => {
      batch.update(doc(db, ...pathParts), partialData)
    },
    delete: (pathParts) => {
      batch.delete(doc(db, ...pathParts))
    },
  }
  await fn(batchHelpers)
  await batch.commit()
}
