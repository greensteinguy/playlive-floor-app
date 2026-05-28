// Shared Zod primitives reused across every collection schema.
//
// Conventions enforced here:
//   - Money is always integer cents (positive or non-negative).
//   - Firestore Timestamps are validated via instanceof Timestamp.
//   - All UUIDs are non-empty strings (we don't enforce format because legacy
//     imports use Casinoware numeric strings, and new docs use UUID v4 — both
//     are valid "id" values from the schema's perspective).
//   - Audit fields (createdAt / updatedAt / createdBy) are required on most
//     collections; the helper `withAuditFields()` adds them in one place.

import { z } from 'zod'
import { Timestamp } from 'firebase/firestore'

// ── Primitive helpers ──────────────────────────────────────────────────────

/** A non-empty string. Used for ids, references, free-text fields where empty makes no sense. */
export const NonEmptyString = z.string().min(1)

/** A document id. Doesn't enforce UUID format — legacy imports keep their Casinoware ids. */
export const DocumentId = NonEmptyString

/** A reference to another document (just the id string). */
export const DocumentRef = NonEmptyString

/** Firestore Timestamp. Validates via instanceof. */
export const FirestoreTimestamp = z.instanceof(Timestamp, {
  message: 'expected a Firestore Timestamp',
})

/** Optional Firestore Timestamp. */
export const NullableTimestamp = FirestoreTimestamp.nullable()

// ── Money ──────────────────────────────────────────────────────────────────
// Stored as integer cents. Two flavours:
//   - Money: >= 0 (balances, prize pools, hospitality, fees, etc.)
//   - PositiveMoney: > 0 (transaction amounts where the sign convention applies)

/** Money as integer cents, >= 0. */
export const Money = z.number().int().nonnegative()

/** Money as integer cents, strictly > 0. For transaction amounts. */
export const PositiveMoney = z.number().int().positive()

// ── Chip counts ────────────────────────────────────────────────────────────
// Chips are positive integers (counts, not money).

/** A chip count (or chip-related number like a stack or blind level). >= 0. */
export const ChipCount = z.number().int().nonnegative()

// ── Auth / role enums ──────────────────────────────────────────────────────

export const Role = z.enum(['manager', 'td', 'cashier', 'readonly'])

/** Role + a 'system' option, for fields where automated jobs (e.g., migration import) can be the actor. */
export const ActorRole = z.enum(['manager', 'td', 'cashier', 'readonly', 'system'])

// ── Audit / lifecycle helpers ──────────────────────────────────────────────

/** Standard audit fields present on most top-level docs. */
export const AuditFields = {
  createdAt: FirestoreTimestamp,
  updatedAt: FirestoreTimestamp,
  createdBy: NonEmptyString,
}

/** Standard archive field (soft-delete pattern). */
export const ArchiveField = {
  archivedAt: NullableTimestamp,
}

// ── Country code (for player.countryCode, legacy 'ensign' field) ───────────
// Two-letter ISO 3166-1 alpha-2 codes. We don't validate against the full ISO
// list — just shape (length === 2, uppercase letters). Surface as a string so
// the UI can render flags without coupling to a country library.

export const CountryCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, 'country code must be 2 uppercase letters (ISO 3166-1 alpha-2)')
