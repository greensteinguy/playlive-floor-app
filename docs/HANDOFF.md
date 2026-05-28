# Handoff — current state

> This is the living "where we left off" doc. **Update it at the end of every Claude Code session and every Cowork planning session.** Commit alongside whatever else changed. It is how context survives between sessions and across tool switches.

Last updated: **28 May 2026** by Claude — testing + shell + audit-log + dedupe + iPad pass session. Phase 1 implementation tasks complete (1.1–1.9 ✅; 1.10 code-review done, on-device smoke test pending Guy). Tier 1 (vitest, 200 → 223 tests with CSV utility added), tier 2 (Firestore emulator + 174 rules tests), `firestore.rules` deployed to `playlive-25a17`, task 1.5 (app shell), task 1.9 (audit log viewer + reusable CSV utility + composite indexes file). See the "This session" block below for detail and "Next session" at the bottom.

---

## Project phase

**Phase 1 — Foundations: in progress, week 2 of 12.**

## This session (28 May 2026)

- **Task 1.10 (iPad layout pass) — code-review pass DONE; on-device smoke test pending.** Reviewed every authenticated screen with iPad usability in mind.
  - `index.html` already has the right viewport meta (`width=device-width, initial-scale=1.0, viewport-fit=cover`) + `apple-mobile-web-app-capable=yes` + `apple-mobile-web-app-status-bar-style=black-translucent`. User-scaling intentionally NOT disabled (accessibility).
  - Login page already iPad-friendly (`py-3` on inputs + submit button ≈ 44px, correct `inputMode`/`autoComplete`).
  - **Fixes made:**
    - `AppShell.jsx`: body scroll lock when the drawer is open (iOS Safari pages would otherwise drag behind the overlay). Hamburger button: `w-10 h-10` → `w-11 h-11` (44×44 per iOS HIG).
    - `Sidebar.jsx`: nav item + sign-out tap targets bumped from `py-2.5` to `py-3` (≈ 44px). Added `active:` states so touch shows visual feedback.
    - `AuditLog.jsx`: date-preset chips, Clear filters, Export CSV all bumped from `py-1.5` to `py-2`. Table rows bumped from `py-2.5` to `py-3` and given `active:bg-white/[0.06]` for tap feedback.
    - `Dedupe.jsx`: Inspect button bumped from `py-1` to `py-2`. Export CSV button matched to the same `py-2` standard. Candidate-list table rows bumped `py-2.5` → `py-3`.
  - Breakpoint sanity: Tailwind's `md:` (≥768px) means iPad portrait (820px+) and any landscape orientation show the sidebar by default; only iPhone-class screens and iPad mini portrait (≤767px width) collapse to the drawer.

  **Still needs an actual iPad** — code review can't verify these. Smoke-test runbook for Guy:
  - Drawer open/close feel; tap-outside-to-dismiss; no underlying scroll while open.
  - iOS Safari date-picker behaviour on the AuditLog "Custom" date range.
  - **CSV download behaviour** — Safari on iPad handles `<a download>` blobs differently than desktop Chrome. May open inline, may prompt Save to Files, may go to Downloads. Verify on `/admin/audit` Export CSV and `/admin/dedupe` Export CSV.
  - Keyboard behaviour when typing into the MERGE confirmation input on `/admin/dedupe` — input should stay visible above the keyboard.
  - Home-indicator overlap — toasts and the mock-role-switcher sit `bottom-4` from the edge; on iPads with the home bar, this *might* feel cramped. If so, we'll add `env(safe-area-inset-bottom)` padding.
  - Pinch-zoom works (it should — not disabled).
  - Tap responsiveness — no 300ms delay expected (viewport meta is correct) but worth confirming.

- **Task 1.8 (Duplicate-player merge tool) DONE.** New module `src/lib/players/` with:
  - `merge.js` — atomic `mergePlayer({sourceId, targetId, actorId, actorRole})`. Reads source + target + source's unused tickets, then in one transaction: transfers walletBalance + ticketBalance + totalDeposited onto target, re-keys unused tickets to target's subcollection (leaving used tickets attached to source for audit), marks source `isMerged=true / mergedIntoId / mergedAt`, writes a `player.merged` audit row.
  - `duplicates.js` — pure `normalizePhone` + `findDuplicateCandidates`. Normalizes Australian phone variants ("+61 4 ...", "0412...", "412...") to the same key.
  - `errors.js` — typed errors: `AlreadyMergedError`, `SameSourceAndTargetError`, `ActiveEntriesError`, `PendingWithdrawalsError`.
  - **Refuses** when source is already merged, source === target, source has active (non-busted, non-voided) entries, or source has pending withdrawals. Pre-transaction collection-group checks + transaction-time re-reads for race safety.
  - 21 unit tests covering happy path + every rejection + the race window (ticket used between pre-check and commit is gracefully skipped, not errored).
  - Page at `src/pages/admin/Dedupe.jsx` — candidate list → side-by-side compare → "type MERGE to confirm" → commit. Reusable CSV export on the candidate list.
  - Seed script `npm run seed:dedupe` writes 8 players (clean / pair / trio / already-merged) with a wallet balance + unused ticket on one record so the merge transfers something visible.

- **Emulator-mode fixes to collection-group queries.** `entries.listEntriesByPlayer`, `tickets.listAllUnusedTickets`, and `walletTransactions.listAllWalletTransactions` were doing their own `USE_MOCK_DATA` checks that bypassed the `_client.js` `ensureLive()` guard. Updated each to respect `USE_EMULATOR` so the merge module (which calls `listEntriesByPlayer`) and adjacent emulator-backed flows work end-to-end.

- **Local emulator dev workflow added** ("verify a feature with real data" runbook). New env flag `VITE_FIRESTORE_EMULATOR=true` makes `src/firebase/config.js` initialize a real Firestore client pointed at `127.0.0.1:8080` instead of throwing `MockModeError`. Auth stays mocked so we don't need to run the Auth emulator too. New npm scripts:
  - `npm run emulator` — boots the Firestore emulator with `firebase.dev.json` (which points at the permissive `firestore.dev.rules` rather than the production `firestore.rules`). Keeps the production rules and `npm run test:rules` untouched.
  - `npm run seed:audit` — pushes permissive rules to the running emulator via its REST `/emulator/v1/.../securityRules` endpoint (defence-in-depth in case the boot-time rules load is flaky on Windows), then writes 30 varied auditLog entries spanning the last 30 days via `@firebase/rules-unit-testing`'s `withSecurityRulesDisabled` path.
  - To use: terminal 1 `npm run emulator`, terminal 2 `npm run seed:audit`, terminal 3 `npm run dev` with `VITE_FIRESTORE_EMULATOR=true` in `.env.local`. Browse to `/admin/audit` to see real data.
  - Project ID `demo-playlive` (intentionally different from `playlive-25a17`) so an accidental misconfiguration can't write to production.
  - `firebase.dev.json` + `firestore.dev.rules` are committed; they document intent and back the emulator boot. The seed-time runtime push is the actually-load-bearing mechanism — empirically the CLI's `--config` flag didn't always cause the boot-time rules to take effect on Windows.

- **Task 1.9 (Audit log viewer) DONE.** `src/pages/admin/AuditLog.jsx` — manager-only table. Filter bar (date preset chips + custom range, action-type drop-down, actor / target text fields), expandable metadata JSON per row, cursor pagination (50 per page, timestamp-based), and CSV export. Backed by:
  - `src/hooks/useAuditLog.js` — reducer-driven state, query construction, mock-mode handling, export-all path with a 10k-row safety cap.
  - `src/lib/csv.js` — generic CSV utility (`toCsvString` + `downloadCsv` + `csvFilename`). Handles Timestamp / Date / object serialization, RFC 4180 escaping, UTF-8 BOM for Excel. **Reusable across the app** — every future list page (tournaments, players, walletTransactions, reconciliation) drops in a one-line export by passing rows + a column spec. 23 unit tests covering escaping edge cases, type formatting, and the column-spec contract.
  - `firestore.indexes.json` — composite indexes for `(actionType, timestamp)`, `(actorId, timestamp)`, `(targetType, targetId, timestamp)`. Added `"indexes": "firestore.indexes.json"` to `firebase.json`. Deploy with `npx firebase deploy --only firestore:indexes --project playlive-25a17` (not yet run — same hard-gate pattern as the rules deploy). Other filter combos will surface a "click here to create the index" error from Firestore on first use; extend the file and redeploy.

- **`.env.local` added.** Was missing — caused the blank screen on `npm run dev`. Mock mode now defaults on for local dev. Documented in HANDOFF + suggested README update for new dev setup.



- **Task 1.5 (App shell) DONE.** Permission-aware persona-tailored shell:
  - `src/shell/AppShell.jsx` — sidebar on desktop, slide-in drawer on iPad/mobile.
  - `src/shell/Sidebar.jsx` — reads `src/shell/nav.js`, filters items by role.
  - `src/shell/nav.js` — single source of truth for the access matrix; `roleCanSee()` + `landingPathFor()` + the section/items config. Manager always passes; empty `allowedRoles` ⇒ manager-only.
  - `src/shell/RoleHome.jsx` — `/` redirects per role: manager + cashier → `/desk`, td + readonly → `/td`.
  - `src/shell/Toast.jsx` + `ToastContext.js` + `useToast.js` — DIY toast system (no library dep). Three variants (success / error / info), auto-dismiss, manual ×.
  - `src/shell/ErrorBoundary.jsx` — one app-level catch-all + per-route boundaries so a bug in `/td` doesn't kill `/desk`.
  - `src/shell/MockRoleSwitcher.jsx` — dev-only floating chips to flip mock role on the fly; hidden in production. `AuthProvider` exposes `setMockRole` only when `VITE_USE_MOCK_DATA=true`.
  - `src/shell/LandingTile.jsx` — large-touch-target card used by both persona landings.
  - Persona landings at `src/pages/desk/DeskLanding.jsx` and `src/pages/td/TdLanding.jsx`. Tile visibility mirrors the sidebar via the same `roleCanSee()` helper.
  - Placeholder pages for every Phase 2/3/4 destination: `src/pages/desk/{Players,Register,Deposit,Withdrawals,Tickets}.jsx`, `src/pages/td/{Tournaments,TournamentNew,Clock,Tables,Bounty,Payouts}.jsx`, `src/pages/admin/{AuditLog,Dedupe,Reconciliation}.jsx`. Each uses `Placeholder.jsx` and notes which phase/task lands the real implementation.
  - Per Guy: Manager lands on `/desk` (registration page is the manager landing). Tournament creation is manager-only at the UI layer. Read-only sees the TD floor in observer mode.
  - Lint + build + tests all clean (still 200 tier-1 + 174 tier-2).



- **Tier 1 unit testing landed.** Vitest installed; `npm test` runs the suite in ~1.5s. 200 tests across 19 files covering: `balanceDelta` / `ticketBalanceDelta` math, every `superRefine` invariant across the 9 collection schemas (one `.test.js` file per schema + a shared `_fixtures.js`), and every wallet operation's happy path + every typed-error rejection path (`_test-helpers.js` factory builds a fresh mock store + tx per test). Both HARD invariants pinned with no-override coverage. `payViaTicket` manager-override path verified to emit the `manager.override` audit entry. Reconciliation aggregation + drift detection covered.

- **Real bug found and fixed mid-session.** Reconciliation was inferring adjustment direction from the free-text `notes` field via `notes.includes('credit')`, which mis-classified a debit whose reason naturally mentioned "credit" (e.g., "over-credited yesterday"). The spinoff task added an explicit `direction: 'credit'|'debit'` field to walletTransactions (required when type=adjustment, null otherwise), updated `writeAdjustment` to set it, and rewrote both `getReconciliationTotals` and `verifyBalanceMatchesLedger` to read it directly. Schema layer enforces presence on adjustment rows. Regression tests added with adversarial note text.

- **Task 1.2 (Firestore rules) DONE and deployed.** `firestore.rules` at project root, deployed to `playlive-25a17` via `firebase deploy --only firestore:rules` at end of session. Scope per the "rules are role-gate only" decision: per-collection allow expressions check `request.auth.token.role` against one of the four valid roles. Access matrix (see DECISIONS entry from this session for justification):

  | Collection | Read | Write |
  |---|---|---|
  | tournaments, sessions, tables, structureTemplates, tournamentTemplates | any role | manager, td |
  | entries, bountyDraws, walletTransactions, tickets | any role | manager, td, cashier |
  | players, withdrawalRequests | any role | manager, cashier |
  | auditLog | manager only | manager, td, cashier |

  Unauthenticated, unknown-role, and unknown-collection-path requests all hit the default-deny. Business invariants (wallet ≥ 0, ticket face-value, status transitions, etc.) are NOT enforced here — that's the wallet/UI layer's job, per the decision.

- **Tier 2 testing infrastructure landed.** `@firebase/rules-unit-testing` added as devDep. `firebase.json` configured for the Firestore emulator on port 8080. `tests/firestore-rules/firestore-rules.test.js` runs the full role × collection × read/write matrix plus unauthenticated, no-claim, and unknown-role bands plus default-deny. **174 tests pass.** Run with `npm run test:rules` — that wraps the suite in `firebase emulators:exec` so the emulator boots, tests run, emulator shuts down.

- **JDK 21 installed.** Firestore emulator requires Java. Installed Eclipse Temurin 21 via winget. New shells will pick it up from system PATH automatically; in-session shells need `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot/bin:$PATH"` if `java` isn't visible yet.

- **Wallet README and schema README** updated to reflect tests landing (was: "tests deferred"; now: tier 1 alongside the code, tier 2 in `tests/firestore-rules/`).

## Previous session (27 May 2026)

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

1. **iPad on-device smoke test (1.10 finishing step).** Code-review pass + fixes are in. Guy: open the dev URL on an iPad, run through the runbook in the "Task 1.10" block above, log issues. Most likely findings: CSV download UX (Safari Files-app prompt vs. inline), any home-indicator overlap on toasts / mock-role-switcher.
2. **Deploy `firestore.indexes.json` to `playlive-25a17`.** Run `npx firebase deploy --only firestore:indexes --project playlive-25a17` once Guy approves (touches production; pairs with the rules deploy from earlier this session). The audit log viewer's filtered queries will error in production until this lands.
3. **Phase 2 — Tournament Setup & Clock.** Once 1.10 sign-off lands, Phase 1 is closed and the build moves to Phase 2 (tournament list/create wizards, structure templates, the live clock).
5. **Drop the legacy `tournaments` collection** (1,695 docs in `playlive-25a17`). Required before the canonical schema can reuse the collection name. Claude has the script ready to write; waits for explicit go from Guy (destructive).
6. **Narrow SA role back down.** The audit SA currently has `Editor`. Audit is done; downgrade to `Cloud Datastore Viewer` or disable. Not urgent.
7. **(For Guy's awareness) Provision a real Manager user** in Firebase Auth. Steps in `docs/operator/initial-admin-setup.md`. Not blocking — mock mode covers UI iteration.

## What's blocked

Nothing right now. Phase 1 is fully unblocked.

**Coordination risk to watch** (not a blocker today): if the analytics dashboard or Player App needs to come back online mid-build, the in-progress rules / schema state of `playlive-25a17` must not break them. Likely fine — Phase 6 was always going to handle the schema migration for the other two apps — but worth being explicit about.

## Open questions for Guy

None outstanding for design.

## Next session

Top of the queue is **deploying the rules to `playlive-25a17`** (`npx firebase deploy --only firestore:rules --project playlive-25a17`) — this is the SOW's "rules deployed before any production write" hard gate. Waits on Guy's go since it touches production. After that: task 1.5 (app shell).

## Test infrastructure (reference)

For future sessions and future devs.

```
npm test               # tier 1: validators + wallet (200 tests, ~1.5s)
npm run test:watch     # vitest watch mode
npm run test:rules     # tier 2: emulator + firestore.rules (174 tests, ~7s)
                       #         requires Java on PATH — see "Dev prereqs" below
npm run lint
npm run build
```

**Tier 1** (`src/**/*.test.js`): pure unit tests, no Firestore. Each wallet test `vi.mock`s `../firestore` and replaces `runValidatedTransaction` with a callback that hands the wallet code a fake `tx`. A small in-memory store in `src/lib/wallet/_test-helpers.js` lets tests seed docs and assert on `set`/`update` calls. Each schema's tests use `src/lib/schema/_fixtures.js` to build validator-passing base docs and override one field per case.

**Tier 2** (`tests/firestore-rules/*.test.js`): boots the Firestore emulator via `firebase emulators:exec`, uses `@firebase/rules-unit-testing` to assert the per-role × per-collection access matrix. The rules file is `firestore.rules` at the project root.

### Dev prereqs

- **Node**: as in `package.json` engines.
- **Java**: required only for `npm run test:rules`. Install Eclipse Temurin (JDK 21 used on Guy's machine; older versions probably work but untested). Windows: `winget install EclipseAdoptium.Temurin.21.JDK`. After install, restart the shell so `java` is on PATH. If `npm run test:rules` errors with "Could not spawn `java -version`" in an existing shell, that shell hasn't picked up the new PATH yet — open a new terminal or, in bash, `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot/bin:$PATH"`.

## Deferred follow-ups (not blocking, not this-session)

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
