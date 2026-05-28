# Handoff — current state

> This is the living "where we left off" doc. **Update it at the end of every Claude Code session and every Cowork planning session.** Commit alongside whatever else changed. It is how context survives between sessions and across tool switches.

Last updated: **27 May 2026** by Claude — end of long Phase 1 foundations session. Auth (1.1), schema (1.3), validators (1.4), data layer (1.6), and wallet module (1.7) all implemented. Tests deferred to next session per scope-vs-context call. See "Next session: tier-1 testing setup" at the bottom.

---

## Project phase

**Phase 1 — Foundations: in progress, week 2 of 12.**

Five tasks completed in the kick-off session:

- **Task 1.1 (Firebase Auth + roles):** done. Four roles (`manager`, `td`, `cashier`, `readonly`) as Firebase custom claims. AuthProvider + useAuth + ProtectedRoute + Login + Forbidden pages. Admin role-setting script (`scripts/admin/set-role.js`) for provisioning. Mock-mode dev support (`VITE_USE_MOCK_DATA=true` + `VITE_MOCK_ROLE`). Lint clean, build passes, dev server boots. Operator setup doc at `docs/operator/initial-admin-setup.md`.

- **Task 1.4 (Zod runtime validators):** done. `src/lib/schema/` has one validator file per collection (12 total: 6 top-level + 6 subcollections) plus embedded sub-schemas (`structure`, `payoutStructure`). Cross-field invariants encoded via Zod `superRefine` (isMultiFlight ⇒ isMultiDay; satelliteConfig set iff gameType='satellite'; session needs termination criterion unless final; ticket state consistency; entry seat/bust consistency; etc.). Hard invariants (walletBalance ≥ 0, transaction amount > 0) encoded structurally. Lint + build pass. See `src/lib/schema/README.md` for usage and conventions.

- **Task 1.6 (Firestore data layer):** done. `src/lib/firestore/` wraps every read/write through the Zod validators. Generic helpers for one-off calls (`validatedGet`/`Set`/`Update`/`subscribe*`/`runValidatedTransaction`/`runValidatedBatch`) plus per-collection wrappers for all 12 collections, plus collection-group helpers for cross-parent queries (entries by player, transactions / tickets across players). Typed errors (`NotFoundError`, `ValidationError`, `MockModeError`). UUID v4 id generation via `crypto.randomUUID`. Online-only per ADR-001 — throws `MockModeError` when `VITE_USE_MOCK_DATA=true`. Lint + build pass. See `src/lib/firestore/README.md`.

- **Task 1.7 (Wallet ledger module):** done (code; tests are the next session). `src/lib/wallet/` exposes 13 operations covering every money flow: `recordDeposit`, four tournament-payment methods (`payViaExternalMethod`, `payViaWallet`, `payViaTicket`), withdrawal (`createWithdrawalRequest`/`completeWithdrawal`/`cancelWithdrawal` — two-step pattern), winnings credit (`confirmWinCredit` + `confirmBountyWinCredit`), `issueTicket`, `recordOpeningBalance` (migration), `writeAdjustment` (error corrections), `recordManagerCredit` / `recordManagerDebit` (manager-authorized comps / recoupings), and reconciliation helpers (`getReconciliationTotals` + `verifyBalanceMatchesLedger`). Every operation wraps writes in `runValidatedTransaction` for atomicity across entries / walletTransactions / player balance / ticket state. Two HARD invariants (walletBalance ≥ 0, amount > 0) enforced with no override path anywhere — including on manager debits. Default invariants (ticket face-value rule, withdrawal state transitions) take an optional `managerOverride={reason:"..."}` parameter that emits a `manager.override` audit entry. Six typed errors for caller handling (`InsufficientWalletBalanceError`, `TicketBelowFaceValueError`, `TicketAlreadyUsedError`, `WithdrawalStateError`, `RoleNotAuthorizedError`, `InvalidOverrideError`). Lint + build pass. See `src/lib/wallet/README.md`.

  Mid-session addition: distinguished **`writeAdjustment` (corrections)** from **`recordManagerCredit`/`recordManagerDebit` (intentional manager comps / recoupings)**. Two new walletTransaction types (`managerCredit`, `managerDebit`) were added to the schema with schema-layer enforcement (`actorRole === 'manager'`, non-empty notes). Reconciliation totals break out the two intents as separate line items so managers can track goodwill credit issued vs bookkeeping corrections.
- **Task 1.3 (canonical schema doc):** v1 draft written, then iterated through several substantive review passes with Guy on 27 May 2026. Cumulative revisions:
  - Dropped `fee` (no rake at this venue — only optional `hospitalityCost`)
  - `format` enum split into `isMultiDay` + `isMultiFlight` booleans (denormalized from sessions)
  - Embedded `structure` restructured to a discriminated union (`level` | `break` entries)
  - BSB / account-number fields removed from players (out of scope for v1, reduces compliance surface)
  - Recurring schedule moved off tournament templates onto a per-tournament creation choice (bulk-creates N instances upfront)
  - `currentLevel` renamed `currentStructureIndex` (the pointer can land on a level OR a break)
  - **Sessions model rebuilt for N-day, M-flight-per-day support:** added `dayNumber` + `flightLabel` + `convergesIntoSessionId` (explicit foreign-key routing graph, set atomically at setup via client-side UUIDs). `dayNumber` and `flightLabel` are display-only — NEVER used for routing decisions.
  - **Slice model added with planned-vs-actual distinction:** sessions have `maximumStartIndex` + `maximumEndIndex` (the cap; `maximumEndIndex` nullable for "play to a winner" final sessions) AND `actualStartIndex` + `actualEndIndex` (set at runtime). `playToPercentRemaining` per-session early-termination criterion. Automatic rollback: for converged-into sessions, `actualStartIndex = min(upstream actualEndIndex) + 1` so no players skip levels when flights end at different points.
  - Hard invariants mostly relaxed to "default behaviour with manager override" per the new philosophy below, with two named exceptions kept as hard: `players.walletBalance >= 0` (wallet going negative is venue liability, not a favour) and `walletTransactions.amount > 0` (sign convention is structural).
- **New philosophy logged (DECISIONS.md): enforce business invariants in the app/UI, not in Firestore rules.** Rules are role-based access only. Managers have UI override paths for every default invariant; every override audits via a new `manager.override` action type. Cascading impact on SOW (v0.7), Action Plan (v0.6, task 1.2 narrowed), wallet-design.md (Q6 reversed), canonical-schema.md (§6.2 rewritten).

Phase 0 remains complete. SOW now at v0.7, Action Plan at v0.6, DECISIONS.md has 1 new entry.

Also in this session:
- Initialized git repo (project was unversioned). Initial commit captures all Phase 0 work.
- Tried a parallel-agent approach for auth via a worktree; subagent sandbox blocked it. Fell back to serial implementation in the main session. Worktree cleaned up.

The audit was the biggest source of new information in this session. Headline findings:
- Existing database has **only one top-level collection (`tournaments`)** with **1,695 documents**.
- Players, entries, payouts, and blind structures all live as **nested arrays inside tournament docs**.
- **The Firestore data is a live-stream snapshot, not the source of truth.** Per Guy: clean player records with stable IDs, balances, and any other reference data come from **Casinoware CSV exports** done manually as needed. Migration is a CSV ETL job, not a Firestore-to-Firestore transformation.
- Money is stored as plain dollar numbers, not integer cents; migration converts.
- A few legacy quirks (sparse-array-as-map pattern, `-1` sentinel for missing fields, UI styling baked into data) — all detailed and triaged in the audit doc.

## What's done

- SOW updated to **v0.5**. Changelog at the top of `docs/01_Scope_of_Work.md` lists every delta from v0.4.
- Action Plan updated to **v0.4**. Changelog at the top of `docs/02_Action_Plan.md` lists every task touched.
- Both walkthrough docs are **fully resolved** with Guy's answers:
  - `docs/casinoware-feature-inventory.md` — all 9 questions answered.
  - `docs/wallet-design.md` — all 7 questions answered.
- `docs/DECISIONS.md` — 11 new decision entries logged from this session.
- `docs/v1.5-plus-backlog.md` — ID scanning, packages, stats screen, ICM helper, cash games, Player App wallet, TS migration.
- `docs/adr/ADR-001-online-only.md` — accepted.
- Repo scaffolded; `npm install && npm run dev` verified by Guy. Placeholder UI contrast bug fixed.
- **Firestore audit (task 0.2) RUN.** Findings in `docs/schema/firestore-audit.md`. Audit script in `scripts/firestore-audit/`. Raw outputs in `scripts/firestore-audit/output/` (gitignored — contains PII).

## Key decisions from this session (full detail in DECISIONS.md)

- PayID is deposit-only; tournament-pay has four methods, not five.
- Wallet ledger uses always-positive `amount`; `type` determines direction.
- Wallet balance can never go negative; no manager override.
- Win credits require cashier confirmation (no auto-credit).
- Multi-day and multi-flight are distinct tournament structures.
- Templates are two-level (structure templates + tournament templates).
- Upper Deck / Main Deck split is the last-longer side bet — one concept, one toggle.
- Stats screen on venue display moved from v1 to v1.5+.
- Satellite milestone payout = auto-removal at a chip multiple (ticket-reward/buy-in ratio × starting stack).
- Existing player records and wallet balances are imported as part of migration; opening balances become `walletTransactions` rows.

## What's next (in priority order)

1. **Tier 1 tests** (next session — see the **"Next session: tier-1 testing setup"** section at the bottom of this doc for the full plan). Sets up vitest + writes unit tests for validators + wallet module against mocked data layer. ~3-4 hours. Should land before more Phase 1 code is built on top of the wallet module.
2. **Task 1.2 (Firestore rules)** — narrowed scope per the new app-not-rules philosophy: role-based access only. Pairs naturally with tier 2 testing (Firebase Emulator) — set up emulator and rules tests together. Probably 1-2 hours of rules + 1-2 hours of emulator setup.
3. **Task 1.5 (App shell with persona-tailored landings)** — needs Guy's UI direction on TD and Registration Desk landings. Can wait until after rules.
4. **Task 1.8 (Duplicate-player merge tool)** — admin UI for merging duplicate player records.
5. **Task 1.9 (Audit log scaffold UI)** — log writers are done; needs a simple admin viewer UI.
6. **Task 1.10 (iPad layout pass)** — once 1.5 lands.
7. **Drop the legacy `tournaments` collection** (1,695 docs in `playlive-25a17`). Required before the canonical schema can reuse the collection name. Claude has the script ready to write; waits for explicit go from Guy (destructive).
8. **Narrow SA role back down.** The audit SA currently has `Editor`. Audit is done; downgrade to `Cloud Datastore Viewer` or disable. Not urgent.
9. **(For Guy's awareness) Provision a real Manager user** in Firebase Auth. Steps in `docs/operator/initial-admin-setup.md`. Not blocking — mock mode covers UI iteration.

## What's blocked

Nothing right now. Phase 1 is fully unblocked.

**Coordination risk to watch** (not a blocker today): if the analytics dashboard or Player App needs to come back online mid-build, the in-progress rules / schema state of `playlive-25a17` must not break them. Likely fine — Phase 6 was always going to handle the schema migration for the other two apps — but worth being explicit about.

## Open questions for Guy

None outstanding for design.

## Next session: tier-1 testing setup

Decided this session: set up vitest + unit tests for the validators and wallet module before tackling any more Phase 1 work. The wallet module is the highest-stakes code in v1 (money handling) and is freshly built — testing it now is much cheaper than testing it later. Tier 2 (Firestore Emulator for rules + integration tests) lands later, with task 1.2.

### Scope (tier 1 only — defer tier 2)

- **Install vitest** as a devDep. No other test runner. No jsdom needed for tier 1 (no UI tests yet).
- **Mock the data layer** — every wallet test stubs `runValidatedTransaction` so no Firestore is hit. Tests run in milliseconds.
- **Cover:** validator cross-field invariants + `balanceDelta` pure math + every wallet operation's happy path + every wallet operation's HARD invariant rejection.
- **STOP** before doing tier 2. Tier 2 needs the Firebase Emulator Suite (requires Java on the dev machine), and lands naturally with task 1.2 (Firestore rules). Don't do it in this testing session.

### Setup checklist

```bash
cd "/c/Users/green/Documents/PlayLive Tournament Tool/Application"
npm install -D vitest
# Add to package.json scripts: "test": "vitest run", "test:watch": "vitest"
# Add vitest.config.js with minimal config (Node environment, ESM, no jsdom)
```

### Mock pattern (the load-bearing piece)

The wallet module imports from `../firestore`. Tests `vi.mock('../firestore')` and provide a stubbed `runValidatedTransaction` that immediately invokes the callback with a mock `tx` object whose `get`/`set`/`update` are `vi.fn()`s. Tests configure the mock to return controlled values (e.g. a Player with a known balance) and assert on what `set`/`update` were called with.

Rough sketch — adapt as needed:

```js
// src/lib/wallet/deposit.test.js
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'

// Mock the data layer module
vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  generateId: vi.fn(() => 'mock-uuid'),
  auditLog: { writeAuditLogSafe: vi.fn() },
  paths: {
    playerPath: (id) => ['players', id],
    walletTransactionPath: (pid, tid) => ['players', pid, 'walletTransactions', tid],
  },
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import { recordDeposit } from './deposit'
import { Player, WalletTransaction } from '../schema'

describe('recordDeposit', () => {
  let mockTx
  beforeEach(() => {
    mockTx = { get: vi.fn(), set: vi.fn(), update: vi.fn() }
    runValidatedTransaction.mockImplementation(async (fn) => fn(mockTx))
    auditLog.writeAuditLogSafe.mockResolvedValue(undefined)
  })

  it('credits walletBalance and totalDeposited by the deposit amount', async () => {
    mockTx.get.mockResolvedValue({
      id: 'player-1', firstName: 'Test', lastName: 'User', phone: '555',
      walletBalance: 5000, ticketBalance: 0, totalDeposited: 5000,
      // ... fill in required Player fields
    })
    const result = await recordDeposit({
      playerId: 'player-1', amount: 1000, method: 'cash', reference: 'cash',
      actorId: 'cashier-1', actorRole: 'cashier',
    })
    expect(result.newBalance).toBe(6000)
    expect(mockTx.update).toHaveBeenCalledWith(
      ['players', 'player-1'],
      expect.objectContaining({ walletBalance: 6000, totalDeposited: 6000 })
    )
  })

  it('rejects amount <= 0', async () => {
    await expect(recordDeposit({ playerId: 'x', amount: 0, method: 'cash', reference: '', actorId: 'a', actorRole: 'cashier' }))
      .rejects.toThrow(/amount must be > 0/)
  })
})
```

Things to figure out on the way (probably trip-ups):

- **Firestore Timestamp.** `z.instanceof(Timestamp)` in validators expects real Timestamp instances. Tests can use `Timestamp.now()` from `firebase/firestore` directly — that's a real instance.
- **`paths` is exported as a namespace** (`export * as paths from './_paths'`). The mock structure above handles it.
- **Validator pulls in `firebase-admin` indirectly?** No — validators are pure Zod + Firestore client SDK (browser-friendly). Should mock fine.
- **`crypto.randomUUID`.** Mock `generateId()` instead of relying on the actual crypto API in test environment.

### Priority order

Do in this exact order. Each is a discrete chunk; stop and verify (lint + test pass) after each before moving on.

1. **vitest setup** (~30 min) — install, config, package.json scripts, smoke test (one trivial passing test in a `setup.test.js` file).

2. **`_shared.js` — `balanceDelta`** (~15 min) — pure function. Test every type. Sanity-check the +/- math:
   - `deposit` / `winCredit` / `openingBalance` / `managerCredit` → `+amount`
   - `spend` (method='wallet') → `-amount`; (other methods) → `0`
   - `withdrawalComplete` / `managerDebit` → `-amount`
   - `ticketUse` / `withdrawalRequest` / `withdrawalCancel` → `0`
   - `adjustment` → throws (caller must use explicit sign)
   - unknown type → throws

3. **Validators** (~1.5 hr) — `src/lib/schema/*.test.js` files. Cover:
   - **`Tournament`:** isMultiFlight⇒isMultiDay refinement; satelliteConfig iff gameType=satellite; bountyPoolConfig iff gameType=mysteryBounty; currentStructureIndex in bounds of structure; structure discriminated union with sequential blindNumber.
   - **`Player`:** walletBalance < 0 rejected (schema layer); merge state consistency (isMerged ↔ mergedIntoId + mergedAt).
   - **`WithdrawalRequest`:** state-dependent field presence (pending must have nulls; completed must have completedBy/At/walletTransactionId).
   - **`WalletTransaction`:** TYPES_REQUIRING_NULL_METHOD enforcement; openingBalance requires actorRole='system' + reference='opening_balance'; managerCredit/Debit requires actorRole='manager' + non-empty notes; ticketUse requires relatedDocId.
   - **`Session`:** maximumEndIndex nullable; non-final session needs termination criterion; actualEndIndex ≤ maximumEndIndex when both set; same-day flights share maximumStart/EndIndex.
   - **`Entry`:** seat consistency (currentTableId & currentSeatNumber both set or both null); bust consistency (bustedAt & bustedInSessionId together; currentTableId null when busted); voided fields together.
   - **`Table`:** seats.length === seatCount; seat numbers 1..N unique; closedAt requires openedAt; status=broken requires closedAt.
   - **`Ticket`:** used-state fields together (all three set when state=used; all null when state=unused).
   - **`BountyDraw`:** knocker ≠ knocked-out.

4. **Wallet operations** (~2 hr) — `src/lib/wallet/*.test.js` files. For each operation: at least one happy-path test, plus rejection tests for every typed error it can throw. Cover at minimum:
   - **`recordDeposit`:** happy path; rejects amount ≤ 0; rejects invalid method.
   - **`payViaExternalMethod`:** happy path with cash; happy path with EFTPOS; rejects invalid method (e.g. 'wallet').
   - **`payViaWallet`:** happy path; **HARD: rejects when balance < totalCost** (InsufficientWalletBalanceError) — no override accepted.
   - **`payViaTicket`:** happy path with faceValue == totalCost; faceValue > totalCost (venue keeps the difference); faceValue < totalCost with top-up; faceValue < totalCost with managerOverride; **rejects when faceValue < totalCost AND no top-up AND no override** (TicketBelowFaceValueError); rejects already-used ticket; verifies `manager.override` audit emitted when override used.
   - **`createWithdrawalRequest`:** happy path; rejects non-cashier/manager.
   - **`completeWithdrawal`:** happy path; **rejects non-manager** (RoleNotAuthorizedError); rejects non-pending state (WithdrawalStateError); **HARD: rejects when balance insufficient**.
   - **`cancelWithdrawal`:** happy path; rejects non-pending state; rejects empty cancelReason.
   - **`confirmWinCredit`:** happy path; rejects amount ≤ 0.
   - **`confirmBountyWinCredit`:** happy path; **rejects double-confirm** (when bountyDraw.walletTransactionId already set).
   - **`issueTicket`:** happy path; rejects faceValue ≤ 0.
   - **`recordOpeningBalance`:** happy path; rejects amount ≤ 0.
   - **`writeAdjustment`:** credit happy path; debit happy path; **HARD: rejects debit when balance insufficient**; rejects invalid direction; rejects empty reason.
   - **`recordManagerCredit`:** happy path; **rejects non-manager**; rejects amount ≤ 0; rejects empty reason; verifies `wallet.managerCredit` audit emitted.
   - **`recordManagerDebit`:** happy path; **rejects non-manager**; **HARD: rejects when balance insufficient** (no override); rejects empty reason.

5. **Reconciliation** (~30 min) — `getReconciliationTotals` aggregates correctly across all types; `verifyBalanceMatchesLedger` correctly sums and reports drift.

### Stop points

- After step 1 (vitest setup): run `npm test` and confirm the smoke test passes. Commit if Guy approves.
- After step 3 (validators): re-run lint + test, confirm green.
- After step 4 (wallet operations): re-run lint + test. **STOP HERE** — do NOT proceed to tier 2 (Firebase Emulator) in this session. Surface results to Guy and discuss what to commit.

### What to read first in the new session

1. `CLAUDE.md`
2. `docs/HANDOFF.md` — focus on this section
3. `src/lib/wallet/README.md` and `src/lib/schema/README.md` — what's actually being tested
4. `src/lib/firestore/README.md` — explains the `runValidatedTransaction` pattern that needs mocking
5. `docs/schema/canonical-schema.md` §6.2 — the invariant table that drives the rejection tests

Don't re-read the chat history of this session — everything load-bearing is in the docs.

## Deferred follow-ups (not blocking, not this-session)

- **Tier 2 testing (Firebase Emulator).** Lands with task 1.2 (rules). Will require Java on the dev machine.
- **Drop the legacy `tournaments` collection** (1,695 docs). Destructive — waits on explicit go from Guy.

**Recently resolved (27 May 2026):**

- Opening-balance source = Casinoware export. Exact field mapping deferred to Phase 1 task 1.8a.
- Satellite milestone chips = removed from play entirely on auto-removal.
- Staging Firebase project (task 0.4) **skipped** — building directly on shared `playlive-25a17`. Rationale: analytics dashboard and Player App not in active use due to current tournament-system blockers. Logged in DECISIONS.md.
- Read-only service account delivered at `C:\Users\green\.config\playlive\audit-sa.json`. Currently has `Editor` role (needed to read populated collections — narrower roles produced an inexplicable PERMISSION_DENIED pattern). Can be narrowed back down now that the audit is done.
- **Firestore audit complete.** Findings curated in `docs/schema/firestore-audit.md`.
- **(O1)** Drop the legacy Firestore `tournaments` collection; reclaim the name for the canonical schema. Casinoware CSVs + local audit dump are the backup paths. See DECISIONS.md.
- **(O2)** `dealerMinutes` is dealer-time / table-utilisation tracking for analytics. Preserved on canonical schema. How it's populated is a Phase 2 / Phase 4 UI concern. See DECISIONS.md.
- **(O3)** Claude proposes enum mapping in Phase 1 task 1.3; Guy reviews. Permission to split single legacy enum fields into multiple canonical fields if cleaner. See DECISIONS.md.
- **(O4)** CSV import sequencing — schema first (uninfluenced by legacy), tournament creation second, then field mapping (Guy + Claude collaboration in R1.0a), then import script (R1.0b). Phase 1 task 1.8a removed. See DECISIONS.md and Action Plan v0.5 changelog.

## Sync notes / housekeeping

- **SOW .docx and Action Plan .docx are now behind the markdown.** SOW markdown is v0.5; .docx is v0.4. Action Plan markdown is v0.4; .docx is v0.3. When Guy next refreshes the team-facing versions, both .docx files need updating from the markdown changelogs.

## Cross-app coordination notes

- **Analytics dashboard** (`C:\Users\green\Documents\playlive-analytics`) reads from `playlive-25a17` today. Phase 6 will update it for the new canonical schema.
- **Player App** (`C:\Users\green\Documents\PlayLiveApp\playlive_tournament_app`, Flutter) reads tournaments from `playlive-25a17`. Phase 6 will add read-only wallet views.
- All three apps share `playlive-25a17` — this is why task 0.4 (separate staging project) matters before Phase 1.

## Convention reminders

- Update this file (HANDOFF.md) at the end of every session.
- Architectural calls go in `docs/DECISIONS.md` and get their own ADR if they're significant.
- New scope ideas go in `docs/v1.5-plus-backlog.md`, **not** the v1 SOW. Promoting a v1.5+ item back into v1 requires a Cowork conversation with Guy and a DECISIONS.md entry.
