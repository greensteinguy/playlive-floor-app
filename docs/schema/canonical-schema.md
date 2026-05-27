# Canonical Firestore schema

This is the canonical schema for all three PlayLive apps. The Floor App writes it; the analytics dashboard and player app read it. Phase 1 task 1.3 fleshes this out fully. This file is the placeholder skeleton.

> **Status:** SKELETON — to be expanded during Phase 1.

## Conventions

- Collection names: plural, camelCase (`tournaments`, `players`, `walletTransactions`).
- Document IDs: opaque UUIDs (`v4`) unless there's a strong external reason otherwise.
- Timestamps: Firestore `Timestamp` type. Always store UTC; render in the venue's local timezone.
- Money: stored as integers in cents (AUD), never floats. Display formatting happens in the UI.
- Soft delete: prefer `archivedAt: Timestamp | null` over hard delete; preserves audit history.
- Every collection has a `createdAt`, `updatedAt`, and `createdBy` (Firebase Auth UID).

## Collections (skeleton)

### `tournaments`
The configuration and live state of a single tournament instance. Fields covered in Phase 2 task 2.1.

### `entries`
A player's entry in a tournament. One document per buy-in / re-entry. References `tournaments` and `players`.

### `players`
Player profiles. Mandatory: name, phone. Sensitive (Cashier+ only, audit-logged): BSB, accountNumber. Derived (computed/cached): walletBalance, ticketBalance, totalDeposited.

### `wallets`
One document per player. Summary view of the wallet (balance, last activity). The authoritative source of truth is the `walletTransactions` ledger; this is a denormalised cache for fast reads. Shape detailed in `docs/wallet-design.md` §3.

### `walletTransactions`
Per-player immutable ledger. Append-only. Every deposit, spend, ticket usage, win credit, withdrawal request and completion is one row. Shape and sign convention detailed in `docs/wallet-design.md` §3–§4.

### `tickets`
Per-player ticket holdings. Each ticket has a face value and may only be used on tournaments where total cost ≥ ticket value (equal-or-greater rule). Shape detailed in `docs/wallet-design.md` §3.

### `withdrawalRequests`
The cashier queue. States: `pending` → `completed | cancelled`. Two-step pattern: any Cashier can create; only a Manager can mark completed (which writes the corresponding `walletTransactions` row). Shape detailed in `docs/wallet-design.md` §3.

### `auditLog`
Every staff action that mutates anything sensitive. Also every read of a sensitive field (BSB, account number).

## Validation

Every collection has a corresponding Zod schema in `src/lib/schema/`. All Firestore writes go through these schemas. Reads also validate on the way in; bad shapes are surfaced rather than silently corrupted.

## Migration notes

The existing Firestore data from imperfect Casinoware exports is preserved. The new app reads/writes the cleaner schema above; a backwards-compat read shim in the analytics dashboard and player app handles pre-existing legacy records during the transition.
