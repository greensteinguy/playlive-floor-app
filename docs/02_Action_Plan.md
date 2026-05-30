# Action Plan — PlayLive Floor App

**Version:** v0.7 — Companion to SOW v0.7

> Markdown mirror of `02_Action_Plan.docx` for Claude Code consumption. **v0.5 / v0.6 / v0.7 have not been mirrored back to the .docx yet** — when Guy next refreshes the team-facing version, the .docx needs to pick up the deltas below.

## Structure

v0.3 splits the work into two phases of activity:

- **Build phase** — 12 weeks of development (Phases 0–6), ending with a feature-complete Floor App on staging.
- **Rollout phase** — runs after the build is feature-complete. Covers handbook, training, parallel run with Casinoware, and cutover. Calendar time depends on PlayLive's tournament schedule.

Owner column: `Guy` = decision-maker / reviewer. `Claude` = AI dev collaborator producing the code / designs / docs.

## Changelog (v0.6 → v0.7)

Phase 1 implementation tasks landed. Detail per task lives in the task rows below; this changelog is the executive summary.

**Phase 1 completion status: 9 of 10 tasks ✅ done, 1 pending (1.10 on-device smoke test).**

- **Task 1.2 (Firestore rules)** implemented + deployed to `playlive-25a17`. Role-based access matrix; default-deny on unknown paths. 174 rules-unit-tests against the emulator pass.
- **Task 1.5 (App shell)** implemented. Persona-tailored landings (Manager + Cashier land at `/desk`, TD + Read-only land at `/td`), permission-filtered sidebar (single source of truth in `src/shell/nav.js`), DIY toast system, error boundaries (app-level + per-route), dev-only mock role switcher.
- **Task 1.5 follow-up — registration flow direction confirmed.** Tournament list is the entry point for cashier-led registration (cashier + TD + manager see it); the standalone "register player" affordance was removed in favour of "pick tournament → register player into it" navigation. Tournament creation is manager-only at the UI layer (rules permit TD+manager writes generally, the UI gates the create action specifically).
- **Task 1.8 (Duplicate-player merge tool)** implemented. New `src/lib/players/` module with atomic `mergePlayer` operation (transactional balance + ticket transfer; source marked `isMerged`; `player.merged` audit row). Heuristic: normalized-phone matching (collapses AU country code + leading-zero variants). Refuses on already-merged, source===target, active tournament entries, or pending withdrawals.
- **Task 1.9 (Audit log viewer)** implemented. Manager-only filterable/paginated viewer at `/admin/audit`. Indexes declared in `firestore.indexes.json` (NOT yet deployed to `playlive-25a17` — that's the remaining production action).
- **Task 1.10 (iPad layout pass)** code-review pass done; on-device smoke test pending Guy. Body scroll lock when drawer open, all tap targets bumped to ≥44px, `active:` states added for touch feedback. Runbook for the on-device pass lives in `docs/HANDOFF.md`.
- **Reusable CSV export utility** (`src/lib/csv.js`, 23 unit tests) added per Guy's "across the board" direction. Wired into the audit log viewer and the dedupe candidate list. Future list pages (tournaments, players, walletTransactions, reconciliation) wire export in one line.
- **Tier 1 testing landed** (vitest, 244 unit tests covering validators, wallet operations, CSV utility, player merge, dedupe heuristic). **Tier 2 testing landed** (emulator + `@firebase/rules-unit-testing`, 174 rules-matrix tests). `npm test` for tier 1, `npm run test:rules` for tier 2.
- **Wallet schema fix** surfaced during testing: `walletTransactions.direction: 'credit' | 'debit' | null` is now an explicit field (required when `type='adjustment'`, null otherwise). Replaces a brittle `notes.includes('credit')` heuristic that mis-classified debits whose reason text mentioned "credit". Reconciliation totals + `verifyBalanceMatchesLedger` updated.
- **Local emulator dev workflow** added for "verify a feature with real data" loops. `VITE_FIRESTORE_EMULATOR=true` flag, separate `firebase.dev.json` + `firestore.dev.rules`, seed scripts (`npm run seed:audit`, `npm run seed:dedupe`), `npm run emulator`. Project id `demo-playlive` distinct from production. Detailed runbook in `docs/HANDOFF.md`.
- **JDK 21 installed** on Guy's machine (Eclipse Temurin via winget) — required by the Firestore emulator. Documented in HANDOFF.

**Hard gate satisfied:** Firestore rules deployed to `playlive-25a17` (end Phase 1 gate). **Remaining production action:** deploy `firestore.indexes.json` so the audit log viewer's filtered queries work in production.

## Changelog (v0.5 → v0.6)

Came out of Guy's Phase 1 schema-review feedback. Detail in `DECISIONS.md`; this changelog is the summary.

- **Phase 1 task 1.2 (rules) scope narrowed:** role-based access only. Business invariants moved to the app layer with manager-override paths. No sensitive-field gating (BSB/account removed from schema in v0.7).
- **Phase 1 task 1.7 (wallet ledger)** acquires the responsibility for enforcing wallet ≥ 0 (HARD — no override) and amount > 0 (HARD — structural). Other default invariants get manager-override paths. Same enforcement pattern for task 3.5 (ticket rules) and task 2.7 (status transitions).
- Audit log gains four new well-known actionTypes: `manager.override` (for default-invariant bypasses), `wallet.managerCredit`, `wallet.managerDebit` (for intentional manager-authorized ledger moves), `wallet.ticketIssued` (for ticket grants).
- New walletTransaction types: `managerCredit` and `managerDebit` for intentional manager-authorized ledger moves (distinct from `adjustment`, which is for fixing data-entry mistakes). Reconciliation breaks them out as separate line items.

## Changelog (v0.4 → v0.5)

Came out of the Phase 0 audit findings and follow-up decisions. Detail in `DECISIONS.md`; this changelog is the summary.

- **Phase 0 task 0.4 (staging Firebase project):** marked **skipped** — building directly on shared `playlive-25a17`.
- **Phase 1 task 1.8a (existing-record import):** **removed**. Moved out of foundations because schema design shouldn't be bent around legacy data. Re-homed in Rollout as R1.0a (mapping doc) + R1.0b (script + run).
- **Rollout R1.0a (new):** Casinoware → canonical field mapping doc. Guy + Claude collaboration on field-by-field shape conversion, enum mapping, money-units, sparse-array unwrapping.
- **Rollout R1.0b (new):** Migration script that consumes the R1.0a mapping. Imports historical players, opening balances, and historical tournaments. Runs against `playlive-25a17` (since staging skipped) before champion training (R1.2).
- **Implicit cleanup task** (folded into Phase 1 prep, not its own line): drop the legacy 1,695 documents in the Firestore `tournaments` collection to reclaim the name for the canonical schema. Backed up by Casinoware itself + local audit dump.

## Changelog (v0.3 → v0.4)

Came out of the Phase 0 walkthrough + wallet shadowing. Detail in `DECISIONS.md`; this changelog is the summary.

- **Phase 1:** Added task 1.8a (existing-record import including opening balances) — _later removed in v0.5._
- **Phase 2 task 2.1:** Tournament create fields updated — multi-day now distinct from multi-flight; trophy folded into house consumption; Upper Deck / Main Deck split is the last-longer toggle (one concept, one toggle).
- **Phase 2 task 2.4:** Renamed and expanded to cover satellite (with milestone auto-removal), multi-day, and multi-flight setups as three distinct flows.
- **Phase 2 task 2.5:** Two-level template system — structure templates + tournament templates.
- **Phase 3 task 3.4:** Tournament-pay reduced to four methods (cash, EFTPOS, from wallet, ticket). PayID is deposit-only, handled in 3.6.
- **Phase 4 task 4.2:** Satellite milestone auto-removal mechanic added (may move to Phase 2 during build).
- **Phase 4 task 4.7:** Win credits now require cashier confirmation per payout (no auto-credit).
- **Phase 5 task 5.2:** Stats screen removed; cycling display is blind countdown + prize pool only. Stats screen moved to v1.5+ backlog.

## Changelog (v0.2 → v0.3)

- Removed offline persistence + multi-device conflict resolution. Floor App is online-only.
- Added Phase 1 wallet schema + ledger module.
- Added Phase 3 multi-method payment recording (cash, EFTPOS, PayID, wallet, ticket) and enhanced player profile.
- Added Phase 4 withdrawal-request queue + reconciliation view.
- Added Phase 2 small-feature additions (short description, hospitality, trophy, house consumption, last-longer, Upper Deck/Main Deck, auto-payout, weekly recurring). Alternate-ticket printing in Phase 3.
- Moved Phases 7 (UAT) and 8 (cutover) out of the 12-week build window into a separate Rollout phase.

## Critical path

- Build phase critical path: Phase 0 → 1 → 2 → 3 → 4 → 6.
- Phase 5 (display + iPad polish) parallelisable with Phase 4.
- **Hard gate before any production write:** Firestore rules deployed (end Phase 1) — ✅ **satisfied 28 May 2026.**
- **Remaining production action** (not a gate, but enables a built feature): deploy `firestore.indexes.json` to `playlive-25a17`; required for the audit log viewer's filtered queries to work in production. Run `npx firebase deploy --only firestore:indexes --project playlive-25a17`.
- **Hard gate before cutover** (in Rollout phase): floor staff UAT sign-off.

---

## Build Phase (12 weeks)

### Phase 0 — Discovery & Setup  (Week 1)

Lock down Casinoware feature set, audit existing Firestore, set up dev environment.

| # | Task | Output | Owner |
|---|---|---|---|
| 0.1 | Casinoware feature inventory: screen-by-screen walkthrough; Must / Should / Won't; capture Mystery Bounty mechanics; document current wallet/payment handling at the venue. | Feature inventory doc | Guy + floor team |
| 0.2 | Firestore audit: dump current schema, document field-level quirks, identify duplicate players. | Schema audit doc | Claude |
| 0.3 | Repo setup: React 19 + Vite + Tailwind, JavaScript, configured for venue PC + iPad. | Empty repo, CI green | Claude |
| 0.4 | ~~Staging Firebase project~~. **Skipped 27 May 2026** — see DECISIONS.md. Build proceeds directly against shared `playlive-25a17` because the analytics dashboard and Player App are not currently in active use. | (n/a) | Guy |
| 0.5 | ADR-001: confirm online-only architecture. | ADR-001 | Claude |
| 0.6 | Wallet & payments discovery: shadow registration desk for a shift; document current deposit / spend / ticket / withdrawal flow; design v1 wallet ledger shape. | Wallet design note | Guy + Claude |

### Phase 1 — Foundations  (Weeks 2–3) — implementation tasks ✅ complete (1.10 on-device smoke test pending)

Auth, security rules, schema, validators, wallet ledger, app shell. Nothing user-facing ships yet.

| # | Task | Output | Owner |
|---|---|---|---|
| 1.1 | ✅ Firebase Auth: email/password staff accounts, four roles (Manager, TD, Cashier, Read-only). Implemented 27 May 2026. AuthContext + AuthProvider + useAuth + ProtectedRoute + Login + Forbidden pages. Admin role-setting script at `scripts/admin/set-role.js`. Mock mode (`VITE_USE_MOCK_DATA=true` + `VITE_MOCK_ROLE`) supported. Operator setup doc at `docs/operator/initial-admin-setup.md`. | Login + role claims | Claude |
| 1.2 | ✅ Firestore security rules v1 implemented 28 May 2026. **Role-based read/write only**; no business-invariant enforcement (per DECISIONS.md 27 May "enforce at app, not rules"). Rules file at project root: `firestore.rules`. Access matrix: tournaments / sessions / tables / templates write = manager+td; entries / bountyDraws / walletTransactions / tickets write = all staff; players / withdrawalRequests write = manager+cashier; auditLog read = manager only, write = all staff. Unauthenticated, no-claim, unknown-role, and unknown-collection all hit the default-deny. Tested under the Firestore emulator via `@firebase/rules-unit-testing`: 174 tests covering the full role × collection × read/write matrix (`tests/firestore-rules/`). Run with `npm run test:rules`. **Deployed to `playlive-25a17` on 28 May 2026** via `firebase deploy --only firestore:rules` — the SOW "rules deployed before any production write" hard gate is now satisfied. | firestore.rules deployed | Claude |
| 1.3 | ✅ Canonical schema doc v1 written 27 May 2026 (`docs/schema/canonical-schema.md`). Six top-level collections + six subcollections. Wallet design from `docs/wallet-design.md` folded in (with `wallets` collection dropped — balance lives on player doc). All five draft open-questions resolved with Guy. Awaiting final line-by-line review. | Schema doc v1 | Claude |
| 1.4 | ✅ Runtime validators implemented 27 May 2026. Zod schemas at `src/lib/schema/` covering all 12 collections (6 top-level + 6 subcollections) plus embedded sub-schemas (structure discriminated union, payout structure). Includes cross-field invariants (e.g., isMultiFlight ⇒ isMultiDay; satelliteConfig set iff gameType='satellite'; session needs termination criterion unless final; ticket state consistency; entry seat consistency). Hard invariants (walletBalance ≥ 0, amount > 0) encoded structurally. Default invariants with manager override (e.g., ticket face-value rule) deferred to wallet module. Lint + build pass. See `src/lib/schema/README.md` for usage. | lib/schema module | Claude |
| 1.5 | ✅ App shell with persona-tailored landings implemented 28 May 2026. `src/shell/` houses the layout (`AppShell.jsx` — sidebar on desktop, drawer on iPad/mobile), permission-filtered sidebar (`Sidebar.jsx` reads `nav.js`), toast system (`Toast.jsx` + `useToast.js` — DIY, no library dep), error boundaries (`ErrorBoundary.jsx` — one app-level + per-route), role-aware root redirect (`RoleHome.jsx`), and a dev-only mock-mode role switcher (`MockRoleSwitcher.jsx`). Landing tiles render via `LandingTile.jsx`. Persona landings at `src/pages/desk/DeskLanding.jsx` (registration desk — manager + cashier land here) and `src/pages/td/TdLanding.jsx` (tournament floor — td + readonly land here). Per Guy's call: Manager lands on `/desk` (registration page is the manager landing); Read-only lands on `/td` in observer mode. Tournament creation is manager-only (rule: `/td/tournaments/new` has `requiredRoles: ['manager']`). Every Phase 2/3/4 destination has a placeholder page wired up so the navigation tree is complete now. | Navigable empty app | Claude |
| 1.6 | ✅ Firestore data layer implemented 27 May 2026. `src/lib/firestore/` wraps every read/write through the Zod validators from task 1.4. Generic helpers (`validatedGet/GetMany/Set/Update/Delete/subscribe*` + `runValidatedTransaction` + `runValidatedBatch`) plus per-collection wrappers for all 12 collections. Collection-group query helpers for cross-tournament entries and cross-player walletTransactions/tickets. Typed errors (`NotFoundError`, `ValidationError`, `MockModeError`). UUID v4 id generation via `crypto.randomUUID`. Online-only per ADR-001. Lint + build pass. See `src/lib/firestore/README.md`. | lib/firestore module | Claude |
| 1.7 | ✅ Wallet ledger module implemented 27 May 2026. `src/lib/wallet/` exposes 13 operations: recordDeposit, payViaExternalMethod / payViaWallet / payViaTicket, create/complete/cancel withdrawal, confirmWinCredit / confirmBountyWinCredit, issueTicket, recordOpeningBalance (migration), writeAdjustment (corrections), recordManagerCredit / recordManagerDebit (intentional manager comps/recoupings — new walletTransaction types `managerCredit` / `managerDebit`), plus reconciliation helpers. Every operation wraps writes in runValidatedTransaction (data + entries + walletTransactions + player balance update all atomic). Two HARD invariants (walletBalance ≥ 0, amount > 0) with no override anywhere — even on manager debits. Default invariants take `managerOverride={reason:"..."}` parameter (emits `manager.override` audit entry). Lint + build pass. Tier 1 tests landed 28 May 2026 (vitest, 200 tests across validators + every wallet op; HARD invariants pinned; manager-override audit verified). | lib/wallet module + tests | Claude |
| 1.8 | ✅ Duplicate-player merge tool implemented 28 May 2026. Manager-only page at `/admin/dedupe`. Heuristic: normalized-phone matching (strip non-digits, drop AU country code or leading 0). Side-by-side compare picks a "keep" and a "merge in" player; manager types `MERGE` to confirm. Atomic merge operation at `src/lib/players/merge.js`: transfers walletBalance + ticketBalance + totalDeposited, re-keys unused tickets, leaves walletTransactions and used tickets attached to source (audit history), marks source `isMerged=true / mergedIntoId / mergedAt`, writes `player.merged` audit row. Refuses with typed errors when source is already merged, source === target, source has active tournament entries, or source has pending withdrawal requests. 21 unit tests + reusable CSV export on the candidate list. Seed script `npm run seed:dedupe` populates the local emulator with a curated set of pair/trio/already-merged scenarios. | Merge admin UI + module + tests | Claude |
| 1.9 | ✅ Audit log viewer implemented 28 May 2026. `src/pages/admin/AuditLog.jsx` — manager-only table with filter bar (date presets + custom range, action-type drop-down from `WELL_KNOWN_ACTION_TYPES`, actor / target text fields), expandable metadata JSON, cursor pagination (50 per page), and CSV export. Backed by `useAuditLog` hook (`src/hooks/`) which centralizes query construction, pagination, mock-mode handling, and the export-all path. Generic CSV utility lives at `src/lib/csv.js` (with 23 unit tests) so future list pages — tournaments, players, walletTransactions, reconciliation — can wire export with one line. Firestore composite indexes declared in `firestore.indexes.json` (deploy with `firebase deploy --only firestore:indexes --project playlive-25a17`). | auditLog viewer + reusable CSV export | Claude |
| 1.10 | 🟡 iPad layout pass — code-review pass done 28 May 2026; on-device smoke test pending. Reviewed every authenticated screen with iPad usability in mind. `index.html` viewport meta confirmed correct (`viewport-fit=cover` + `apple-mobile-web-app-capable`); Login + landings already meet ≥44px tap targets. Fixes made: body scroll lock when the drawer is open (`AppShell.jsx`), hamburger button bumped to 44×44, sidebar nav items bumped to `py-3`, AuditLog filter chips and table rows bumped to `py-2`/`py-3` with `active:` states for tap feedback, Dedupe Inspect button bumped to `py-2`. Smoke-test runbook for Guy in `docs/HANDOFF.md` covers what code review can't verify: CSV download behaviour in Safari, iOS date picker, keyboard-cover of the MERGE input, home-indicator overlap on toasts / mock-role-switcher, pinch-zoom, tap responsiveness. | iPad smoke test passed | Claude (code) + Guy (device) |

### Phase 2 — Tournament Setup & Clock  (Weeks 3–5)

First user-visible feature: create a tournament in any supported format, configure structure and payouts, run the live clock and venue display.

| # | Task | Output | Owner |
|---|---|---|---|
| 2.1 | ✅ Tournament **create** implemented 29 May 2026 (refactored to a 3-step wizard — General Information / Structure / Re-entry & extras — same day, on shared `src/components/FormWizard.jsx`; reverses the single-page call, see DECISIONS.md). Form at `/td/tournaments/new` (manager-only, UI-layer gate). `createTournament` domain op in `src/lib/tournaments/tournaments.js` (Date→`Timestamp` at the boundary, full-doc `validatedSet`, best-effort `tournament.created` audit), 15 tier-1 tests incl. schema-conformance for nlh/satellite/mysteryBounty/multi-flight. Reuses `StructureEditor`; optionally seeds defaults from a chosen tournament template (`fromTemplateId` provenance). Shared form primitives extracted to `src/components/FormFields.jsx`; option lists to `src/lib/gameTypes.js`. Money/numeric fields held as strings, converted via `src/lib/money.js` at save. `payoutStructure` left as a winner-takes-all placeholder (real editor is 2.3); mysteryBounty `totalPool` derived as sum of bounty values. Emulator round-trip verified end-to-end (template → form → cents/Timestamp conversion → schema validation → write read back with correct shape). **Add-ons are variable (enhancement, 29 May 2026):** the Has-add-on toggle now reveals an add-on **cost** (Money) + add-on **chips** (count) pair; both persist on `reentryConfig.addOnCost` / `addOnChips`, gated non-null iff `hasAddOn` via a `superRefine` on both the `Tournament` and `TournamentTemplate` schemas (form requires positive chips; cost may be 0). Same fields wired into the 2.5 template editor — see DECISIONS.md. **Edit mode delivered 30 May 2026** via the tournament detail page (Details + Structure tabs are editable + saveable for manager + TD; fee/guarantee already on the Details form); **multi-day/multi-flight/satellite setup remain 2.4.** Core fields: name, short description, format (NLH / PLO / mixed / satellite / **multi-day** / **multi-flight** / Mystery Bounty / Main Event), buy-in, fee, guarantee, start time, late-reg cutoff, hospitality, **house consumption (single field, includes trophy when relevant)**, **Upper Deck / Main Deck split toggle (= last-longer side bet — same concept)**, add-on toggle, freezeout vs re-entry with counts. | Create tournament UI | Claude |
| 2.2 | ✅ **Blind structure builder** delivered as the reusable `src/components/StructureEditor.jsx` (built in task 2.5, 29 May 2026; reused by the 2.1 create form) — level/break discriminated-union rows, auto-renumbered `blindNumber`, inline per-row validation. **Also delivered 29 May 2026: the tournament list view** — `/td/tournaments` (was a placeholder), the navigation hub that makes created tournaments visible and owns the "+ New tournament" entry point to `/td/tournaments/new`. `useTournaments` hook (one-shot fetch, server-side `orderBy('scheduledStartTime','desc')`, client-side archived filter, mock-mode flag) + `src/pages/td/Tournaments.jsx` (status filter chips with live counts, CSV export, manager-only create link, "Open →" to the detail route). Read-only for all floor roles. Lint + build + emulator browser smoke-test clean. **Tournament detail page scaffolded 30 May 2026** — `/td/tournaments/:id` (`src/pages/td/TournamentDetail.jsx`), the click-through target of the list: a consistent top bar (key info) over a Details / Structure / Players / Payouts tab system. Details + Structure are editable and saveable (manager + TD; cashier + read-only see a disabled, banner-flagged view), via the new `useTournament(id)` hook and the `updateTournament` read-modify-write domain op (re-reads + full `tx.set` so every `superRefine` re-runs on save — never the partial `validatedUpdate`). Players + Payouts are read-only placeholders for Phase 3 / task 2.3. `tournament.updated` audit type + 18 tier-1 tests added; `StatusBadge`/`STATUS_META` extracted to a shared component + lib module. **This delivers the Details + Structure "edit mode" deferred from 2.1** (status/live-state stay read-only — owned by 2.6 clock + 2.7 transitions). **NB — numbering divergence:** `docs/HANDOFF.md` labels the *list view* "task 2.2" and re-maps the rest of Phase 2 (its order: 2.2 list → 2.4 multi-format → 2.3 clock → 2.6 seating → 2.7 status), which differs from this table (2.2 structure, 2.3 payouts, 2.4 multi-format, 2.6 clock, 2.7 floor controls). Same work, different labels — reconcile when convenient. | Blind structure UI + tournament list | Claude |
| 2.3 | ✅ **Payout structure editor delivered 30 May 2026.** Replaced the read-only Payouts tab on the tournament detail page with a real editor: by **percentage** (shares of the prize pool) or **fixed amount** per place, a **rounding rule** (nearest $5 / nearest $10 / exact cents), an **auto-fill generator** driven by a "percent of field paid" input, and **manual override of every row** (add/remove places, edit each percent or amount). Pure generation lib `src/lib/payouts.js` (`paidPlaceCount` = round(entries × pct) floored at 1; `payoutCurve` = sum-to-1 descending curve; `applyRounding`) with 11 tier-1 tests; the byPercent tab shows a live cash-per-place estimate and a running %-total guard (must hit 100% to save). Saves via the existing `updateTournament` RMW op (`tournament.payoutEdited` audit) — no schema change (the `PayoutStructure` schema already supported both modes). Replaces the winner-takes-all `DEFAULT_PAYOUT` placeholder from 2.1. **Bounty-pool field already exists** (Details tab `mysteryBounty` config, derived `totalPool`). **PENDING — real curve algorithm:** the auto-fill curve is a deliberate triangular-weight **placeholder**; the venue fills payouts from a CSV keyed on (entries, prize pool, percent paid) that Guy will supply later. Swapping it in is a one-function change in `payouts.js` (`payoutCurve`); the editor + rounding + persistence are done. Also flag for Guy: confirm nearest-$5/$10 are the right rounding steps (see DECISIONS 30 May). | Payout structure UI | Claude |
| 2.4 | ✅ **Multi-day + multi-flight setup DONE 30 May 2026** (recovered + finished an interrupted session). New pure `src/lib/tournaments/sessions.js` builds the session graph: pre-generates every session UUID, wires the `convergesIntoSessionId` routing graph, tiles the `maximumStart/EndIndex` slices, and enforces the cross-session invariants the per-doc Zod schema can't (contiguous tiling, single final play-to-a-winner session, flights only on non-final days). `createTournament` now writes the tournament doc + every session in ONE atomic `runValidatedBatch`; `isMultiDay`/`isMultiFlight` are DERIVED from the plan. Guided `src/components/SessionPlanBuilder.jsx` (single-day / multi-day / multi-flight shapes) on a new "Days & flights" wizard step in `TournamentNew.jsx`. +26 tier-1 tests (334 total); full emulator smoke-test of both shapes (REST-confirmed graphs, atomic batch write over the long-polling transport). **Satellite *setup* already shipped with 2.1** (`gameType==='satellite'` → `satelliteConfig.ticketReward`); the **milestone auto-removal** mechanic is runtime and stays Phase 4 / task 4.2. Schema `docs/schema/canonical-schema.md` §5.1 covers the sophisticated cases (arbitrary N days/flights, `playToPercentRemaining` termination, convergence rollback where Day 2's `actualStartIndex` derives from `min(upstream actualEndIndex) + 1` — a **runtime** concern for 2.6, not setup — and nullable `maximumEndIndex` for "play to a winner"). The guided UI flights only Day 1 (schema + builder support arbitrary flights per day; the UI covers the common case). | Satellite + multi-day + multi-flight UI | Claude |
| 2.5 | ✅ Templates implemented 29 May 2026. **Two-level**: structure templates (reusable blind structures) + tournament templates (full config referencing a structure template). Manager-only at `/td/templates`. Domain module `src/lib/tournaments/` (6 CRUD ops + typed `TournamentError`; updates use `runValidatedTransaction` read-modify-write so invariant-bearing `levels`/`config` re-validate). Reusable `src/components/StructureEditor.jsx` (auto-renumbers `blindNumber`) — **task 2.1 reuses it**. `useStructureTemplates`/`useTournamentTemplates` hooks, CSV export, type-to-confirm archive, `seed:templates`. 13 tier-1 tests. **Add-ons made variable 29 May 2026** (enhancement): the template editor's Has-add-on toggle reveals add-on cost + chips inputs, persisted on `config.reentryConfig.addOnCost` / `addOnChips` (shares the `superRefine` gating added to both schemas — see DECISIONS.md and task 2.1). **Weekly recurring generator NOT built here** — per DECISIONS 27 May, recurrence is a per-tournament create-time choice, so it belongs with task 2.1/2.4, not the template editor. | Structure + tournament templates | Claude |
| 2.6 | Live clock engine: client-side tick, transitions, breaks, sound alerts. | Working clock | Claude |
| 2.7 | Floor controls. | Floor controls UI | Claude |
| 2.8 | Internal review: Guy walks through create-and-run flow for each format on staging. | Phase 2 sign-off | Guy |

### Phase 3 — Registration, Seating, Balancing & Wallet  (Weeks 5–8)

Middle act: getting players in (paying via any of the five methods), seated, balanced, with wallet activity recorded. Designed for the Registration Desk persona on a PC or iPad.

| # | Task | Output | Owner |
|---|---|---|---|
| 3.1 | Enhanced player profile: full name + phone (mandatory), email, street address; sensitive-tier BSB / account number behind role check; derived wallet and ticket balance. | Player profile UI | Claude |
| 3.2 | Fast fuzzy-name player search, touch-friendly. | Player search UI | Claude |
| 3.3 | New player registration: quick-create form. | Quick-create UI | Claude |
| 3.4 | Tournament registration with payment method selection: **cash, EFTPOS, from wallet, ticket — four methods (PayID is deposit-only, handled in 3.6)**. Records method + amount + reference; debits wallet/ticket atomically. | Registration + payment UI | Claude |
| 3.5 | Ticket payment logic: enforce equal-or-greater rule; support top-up with another method for the gap. | Ticket payment logic | Claude |
| 3.6 | Wallet deposit screen: record cash / EFTPOS / PayID deposits; PayID wizard guides staff through giving the player venue PayID details and confirming receipt. | Deposit UI + PayID wizard | Claude |
| 3.7 | Seat assignment: random draw, manual override, printable seat list. | Seating UI + print view | Claude |
| 3.8 | Live table balancing: keep 9-handed tables ±1 player. | Balancing UI | Claude |
| 3.9 | Table breaking workflow. | Table-break workflow | Claude |
| 3.10 | Waitlist / alternates: queue late players; print alternate ticket with queue number; auto-assign on next bust. | Alternates UI + print | Claude |
| 3.11 | Per-player transaction ledger view. | Ledger view | Claude |
| 3.12 | Internal review: Guy runs a mock tournament with every payment method on staging. | Phase 3 sign-off | Guy |

### Phase 4 — Payouts, Results & Withdrawals  (Weeks 8–10)

End of the tournament: who gets what, recorded cleanly. Plus the withdrawal queue and end-of-day reconciliation.

| # | Task | Output | Owner |
|---|---|---|---|
| 4.1 | Bust-out recording: position with timestamp and remaining stack. | Bust-out UI | Claude |
| 4.2 | Mystery Bounty draw: on each knockout, draw from the published pool, record against eliminator, update remaining-bounty figure on display. **Satellite milestone auto-removal also lives here** (or in Phase 2 — TBD by Claude during build): when a satellite player's stack hits the milestone threshold, auto-remove and issue a ticket. | Bounty draw UI + display update + satellite milestone | Claude |
| 4.3 | Last-longer settlement. | Last-longer logic | Claude |
| 4.4 | Payout calculator. | Payout calc UI | Claude |
| 4.5 | Deal-making (must-have): free-form manual entry with confirmation step and audit trail. | Deal entry UI | Claude |
| 4.6 | ICM helper (stretch): in-app calculator as reference while negotiating. | ICM helper (if time) | Claude |
| 4.7 | Credit winnings to wallet: final results show each paid player's calculated payout; cashier confirms each one before the `win_credit` ledger row writes (no auto-credit). | Win-credit confirm UI + helper | Claude |
| 4.8 | Withdrawal-request queue: two-step pattern — any Cashier creates the request, only a Manager can mark it completed (which debits the wallet). | Withdrawal queue UI | Claude |
| 4.9 | End-of-day reconciliation view: totals by payment method so staff can match against bank/EFTPOS settlements. | Reconciliation view | Claude |
| 4.10 | Final results page. | Results page | Claude |

### Phase 5 — Venue Display & iPad Polish  (Weeks 10–11)

TV display app and iPad-specific UX polish. Runs partly in parallel with Phase 4.

| # | Task | Output | Owner |
|---|---|---|---|
| 5.1 | Display app at /display: full-screen view for tournament TVs. | Display URL working | Claude |
| 5.2 | Cycling display: blind countdown and prize-pool screen. (Stats screen moved to v1.5+ in SOW v0.5.) | Cycling display working | Claude |
| 5.3 | Display styling: lift colours and typography from the analytics dashboard. Smooth transitions. Multi-tournament rotation. | Polished display | Claude |
| 5.4 | iPad-specific pass: every operator screen usable on iPad with touch input. Performance check on older iPads. | iPad pass report | Claude |

### Phase 6 — Consumer-app Adaptors  (Week 12)

Update analytics dashboard and Player App to consume new canonical schema including wallet collections.

| # | Task | Output | Owner |
|---|---|---|---|
| 6.1 | Analytics dashboard: update queries, hooks, calculations.js. Add wallet/liability views if useful. | Updated dashboard build | Claude |
| 6.2 | Player App: update Tournament/Series models in lib/models/; update data_provider.dart queries; surface read-only wallet balance and transaction history for the logged-in player. | Updated Flutter build | Claude |
| 6.3 | Backwards-compat read layer for pre-existing records. | Compat shim | Claude |
| 6.4 | End-of-build review: Guy walks through the entire Floor App on staging with the wallet active end-to-end. | **Build phase complete — feature-complete on staging** | Guy |

---

## Rollout Phase (separate from the 12-week build)

Begins once the build is feature-complete on staging. Calendar time shared with PlayLive's normal tournament schedule.

### Phase R1 — UAT & Parallel Run

| # | Task | Output | Owner |
|---|---|---|---|
| R1.0a | **Casinoware → canonical field mapping.** Guy provides Casinoware CSV exports (players, balances, tournaments, anything else relevant). Guy + Claude collaborate on a field-by-field mapping doc covering shape conversion (e.g. dollars → cents), enum value mapping, sparse-array-as-map unwrapping, and which fields drop. | Mapping doc in `docs/migration/` | Guy + Claude |
| R1.0b | **Migration script + run.** Implement based on R1.0a's mapping. Imports historical players, opening balances, and historical tournaments into the canonical schema collections. Each imported balance → one `walletTransactions` row with `reference = "opening_balance"`. Every import decision logged into `auditLog`. Runs against `playlive-25a17` (live, since staging skipped). | Imported data + import log | Claude |
| R1.1 | Operator handbook v1: printable PDF split by persona (TD, Registration Desk, Wallet & Reconciliation). | Handbook PDF | Claude |
| R1.2 | Champion training: deep dive with the TD champion and the Registration Desk champion. | Both champions trained | Guy + Claude |
| R1.3 | Group training for the wider floor team. | Group training delivered | Guy |
| R1.4 | Tournaments 1–2: small daily events, parallel run, log every issue. | Issue list | Floor team |
| R1.5 | Bug-fix sprint. | Issues closed | Claude |
| R1.6 | Tournaments 3–5: larger / more complex events, ideally including a Mystery Bounty and a deal-making situation. | Sign-off list | Floor team |
| R1.7 | Wallet reconciliation confirmed against external bank/EFTPOS records for at least two cycles. | Reconciliation passed | Guy |
| R1.8 | Daily Firestore backups during the parallel-run window. | Backup script + cron | Claude |

### Phase R2 — Cutover

| # | Task | Output | Owner |
|---|---|---|---|
| R2.1 | Pre-cutover checklist signed off. | Checklist signed | Guy |
| R2.2 | Production deploy. | Live URLs | Claude |
| R2.3 | First production tournament on Floor App alone (Casinoware open as fallback). | Tournament report | Floor team |
| R2.4 | Cancel Casinoware subscription. | Cancellation confirmation | Guy |
| R2.5 | Post-mortem. | Post-mortem doc | Guy + Claude |

## Out-of-band workstreams

- Player record cleanup via the Phase 1 merge tool, ongoing through the build phase.
- Documentation as we go: schema doc, ADRs, operator handbook updated in the phase that introduces the change.
- v1.5+ backlog grooming: capture every "that's a later feature" thought (ID scanning, packages, cash games, TS migration, ICM helper if not shipped) in a backlog doc.

## Decision points

- End of Phase 0: confirm v1 feature inventory + wallet design.
- End of Phase 4: decide whether the ICM helper stretch ships in v1 or moves to v1.5.
- End of Phase R1: go/no-go on cutover.

## What is not in this plan

- Player App roadmap is its own SOW and Action Plan.
- Direct payment-processor / EFTPOS / PayID / bank API integration.
- ID scanning, packages, cash games, multi-venue, loyalty, accounting integrations.
- Gaming compliance / regulatory features beyond the audit log and wallet ledger.
