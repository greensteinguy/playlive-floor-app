# `src/lib/firestore/` — typed, validated data layer

Wraps every Firestore read and write through the Zod validators in `src/lib/schema/`. Per ADR-001 the app is online-only: no offline persistence, no IndexedDB cache. Mock mode (`VITE_USE_MOCK_DATA=true`) throws `MockModeError` from every helper — app code that runs in mock mode needs its own branch.

## Quick start

```js
// Per-collection wrappers (the usual style)
import { tournaments, players, runValidatedTransaction, generateId } from '../lib/firestore'

const t = await tournaments.getTournament(tournamentId)
const list = await tournaments.listTournaments((c) => query(c, where('status', '==', 'lateRegOpen')))

// Transactions (for atomic multi-doc operations)
await runValidatedTransaction(async (tx) => {
  const player = await tx.get(paths.playerPath(pid), Player)
  if (player.walletBalance < amount) throw new Error('insufficient')
  // ... write a walletTransaction, update the player balance, etc.
})
```

## File layout

```
src/lib/firestore/
├── README.md                    ← you are here
├── index.js                     ← re-exports
├── _paths.js                    ← centralized collection/doc path builders
├── _errors.js                   ← DataLayerError, NotFoundError, ValidationError, MockModeError
├── _ids.js                      ← UUID v4 generator (crypto.randomUUID)
├── _client.js                   ← generic validated helpers + transaction/batch wrappers
│
│   ── Top-level collection wrappers ──
├── tournaments.js
├── players.js
├── withdrawalRequests.js
├── structureTemplates.js
├── tournamentTemplates.js
├── auditLog.js                  ← writeAuditLog + writeAuditLogSafe
│
│   ── Subcollection wrappers ──
├── sessions.js                  ← under tournaments/{tid}
├── entries.js                   ← under tournaments/{tid}; also collection-group helper for cross-tournament queries
├── tables.js                    ← under tournaments/{tid}
├── bountyDraws.js               ← under tournaments/{tid}
├── walletTransactions.js        ← under players/{pid}; also collection-group helper for reconciliation
└── tickets.js                   ← under players/{pid}; also collection-group helper for ticket liability
```

## Conventions

- **Every read validates the data via Zod.** Dirty Firestore data throws `ValidationError` rather than slipping through silently.
- **Every write validates before persisting.** Malformed data throws `ValidationError` and the write never happens.
- **Partial updates (`validatedUpdate`) are NOT validated** — Zod can't sensibly validate a partial doc with cross-field invariants. Caller is responsible for keeping the doc valid after the update. For operations that touch invariant-bearing fields, prefer `runValidatedTransaction` so you can read-modify-write the full doc and re-validate.
- **IDs are UUID v4** via `generateId()`. Per-collection `createX(data)` helpers generate one for you if `data.id` is unset. For atomic batches that need pre-known IDs (e.g., creating sessions with cross-references), call `generateId()` first and pass it in.
- **`id` is in the schemas** but stripped before write (Firestore stores the id implicitly via the path). The data layer handles the round-trip.
- **No offline persistence** (ADR-001). All helpers fail fast if the network is down — surface errors clearly in the UI.

## When to use what

| Need | Use |
|---|---|
| Read a single doc | `tournaments.getTournament(id)` (or the equivalent for other collections) |
| Read a filtered collection | `tournaments.listTournaments(c => query(c, where(...)))` |
| Live-update UI on changes | `tournaments.subscribeToTournament(id, onUpdate)` — remember to call the returned unsubscribe function on cleanup |
| Atomic multi-doc operation | `runValidatedTransaction(async tx => { ... })` — see wallet module (Phase 1 task 1.7) for the prime example |
| Bulk atomic create (no reads first) | `runValidatedBatch(async b => { ... })` — e.g., creating all sessions of a multi-day tournament upfront |
| Cross-tournament "all entries by player X" | `entries.listEntriesByPlayer(pid)` — collection group query |
| End-of-day reconciliation | `walletTransactions.listAllWalletTransactions({since, until, type})` — collection group query |
| Audit log write | `auditLog.writeAuditLogSafe({actorId, actorRole, actionType, ...})` — non-throwing variant for user-facing flows |

## When NOT to bypass the wallet module

The wallet module (Phase 1 task 1.7) is the **only safe writer** for:

- `walletTransactions/*` — every write must also update the player's cached balance atomically.
- `players.walletBalance` / `players.ticketBalance` / `players.totalDeposited` — must stay in sync with the ledger.
- `tickets/*.state` — state changes must also write a corresponding walletTransaction.
- `withdrawalRequests/*.state` (completed/cancelled transitions) — must write the corresponding wallet debit atomically.

Reading these directly is fine. Writing directly is a recipe for ledger drift. The wrappers in this directory deliberately don't expose write helpers for `walletTransactions` and `tickets` — go through the wallet module.

## Errors

```js
import { NotFoundError, ValidationError, MockModeError } from '../lib/firestore'

try {
  const t = await tournaments.getTournament(id)
} catch (e) {
  if (e instanceof NotFoundError) { /* "not found" UI */ }
  else if (e instanceof ValidationError) {
    // e.zodError has the underlying Zod issues
    // e.direction is 'read' or 'write'
  }
  else if (e instanceof MockModeError) { /* shouldn't happen in real runtime */ }
  else { /* network / Firestore / unknown */ }
}
```
