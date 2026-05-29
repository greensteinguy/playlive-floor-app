# Handoff — current state

> This is the living "where we left off" doc. **Update it at the end of every Claude Code session and every Cowork planning session.** Commit alongside whatever else changed. It is how context survives between sessions and across tool switches.

Last updated: **29 May 2026** by Claude — **fixed the structure-template save hang**: creating a structure template (in fact *any* emulator write) left the Create button stuck on "Saving…" — Firestore's default WebChannel transport applied the write server-side but never returned the ack to the client, so `setDoc`'s promise never resolved, so `onDone()` never fired. Forced HTTP long-polling for the emulator Firestore client only — `initializeFirestore(app, { experimentalForceLongPolling: true })` in `src/firebase/config.js`. This is **transport-only, NOT offline persistence**, so ADR-001 still holds; production (Mode 3) is untouched. Verified in-browser against the emulator: created a "Long-Poll Smoke Test" structure → editor closed, list count 3→4, new row present, zero console warnings/errors (the best-effort audit write resolved too). Lint + build clean. — *Earlier same day:* **tournament add-ons are now variable**: when an add-on is offered, both its cost and the chips it grants are configurable (previously `hasAddOn` was a bare boolean). Extended `ReentryConfig` in both the `Tournament` and `TournamentTemplate` schemas with `addOnCost` (Money, nullable) + `addOnChips` (ChipCount, nullable), gated non-null iff `hasAddOn` via `superRefine`; wired the pair into the create form (2.1) and the template editor (2.5) behind the Has-add-on toggle, plus seed / fixtures / tests / canonical-schema. Form guard requires a positive chip count; cost may be 0 (free add-on). Verified: `npm test` **283 pass** (+2 add-on conformance tests), lint + build clean, **both forms smoke-tested against the emulator** (gating in both directions + end-to-end persistence with REST read-back). — *Earlier same day:* **tournament config forms converted to a 3-step wizard** (General Information / Structure / Re-entry & extras) on a new shared `src/components/FormWizard.jsx`; applies to **both** the create form (2.1) and the template editor (2.5). Free navigation (every step header clickable), validate-on-submit (flags every offending step with a red "!" and jumps to the first one). Reverses the 29 May single-page call (see DECISIONS.md) after the filled-out page proved too long to scan once a real blind structure was in. Structure gets its own step; the create form's format toggles moved there from Schedule. Verified: `npm test` **283 pass**, lint + build clean, **both forms round-tripped against the emulator** (create persisted a valid 7-level tournament; a template save persisted its renamed title + bounty config). — *Earlier same day:* Phase 2 **task 2.1 (tournament create) DONE**. Wizard create form at `/td/tournaments/new` (manager-only): `createTournament` domain op (Date→`Timestamp` at boundary, full-doc `validatedSet`, best-effort audit), 15 tier-1 tests incl. schema-conformance for nlh/satellite/mysteryBounty/multi-flight, reuses `StructureEditor`, optionally seeds from a tournament template (`fromTemplateId`). Shared form primitives extracted to `src/components/FormFields.jsx`; option lists to `src/lib/gameTypes.js`. Verified: `npm test` **283 pass** (25 files), `npm run lint` clean, `npm run build` clean, **emulator round-trip confirmed end-to-end** (selected the Friday template → form populated → created → read the doc back: correct `name`/`gameType`/`status`, `scheduledStartTime` `19:00` AEST → `09:00Z`, 7-entry structure, counters 0, winner-takes-all `payoutStructure`, `createdBy: mock-user`, both provenance ids). Two implementation calls logged in DECISIONS.md (payout placeholder + mysteryBounty pool derivation). **Next: task 2.2 (tournament list) — replaces the placeholder at `/td/tournaments`, adds the "+ New tournament" entry point, needs a `useTournaments` hook.** Three Phase 1 leftovers still carried (iPad smoke test, deploy indexes, drop legacy `tournaments`).

---

## Project phase

**Phase 2 — Tournament Setup & Clock: IN PROGRESS, week 3+ of 12.** Tasks 2.5 (templates) and 2.1 (tournament create) complete; 2.2 (list) next. (Phase 1 closed end of week 2.)

## Phase 2 starting notes — READ FIRST IF YOU ARE THE NEXT AGENT

Phase 1 left a working foundation: typed data layer, validated schemas, atomic wallet module, app shell with persona-tailored landings + permission-filtered sidebar, audit log viewer, dedupe tool, deployed rules. Phase 2's job is to **make tournaments actually work**: list / create / clock / seating / payouts setup / templates. None of those exist beyond the placeholder pages at `/td/*`.

### Read these before writing code

1. **`CLAUDE.md`** — project context.
2. **This file (HANDOFF.md)** — everything below.
3. **`docs/schema/canonical-schema.md`** — the authoritative shape of tournaments, sessions, entries, tables, bountyDraws. Especially §5.1 (sessions model with `convergesIntoSessionId` routing graph + `maximumStart/EndIndex` cap vs `actualStart/EndIndex` runtime — non-obvious and load-bearing for multi-day/multi-flight).
4. **`docs/02_Action_Plan.md` Phase 2 row block** — task scope.
5. **`src/lib/wallet/README.md`** + **`src/lib/players/README.md` if it exists** + **`src/lib/firestore/README.md`** — patterns to follow. The wallet module is the most polished example: pure helpers, atomic transactions, typed errors, unit-tested.
6. **`src/lib/schema/README.md`** — schema conventions (`.strict()`, `superRefine` for cross-field invariants, never relax a HARD invariant).

### Conventions established in Phase 1 — follow them

- **One module per domain area.** `src/lib/players/` (dedupe + merge), `src/lib/wallet/` (money), and soon `src/lib/tournaments/` (Phase 2). Operations are pure async functions; each takes `{actorId, actorRole}` for audit-trail traceability.
- **All multi-doc writes go through `runValidatedTransaction`.** No exceptions. Reads first, writes second. Race-safe: re-read inside the transaction what you also need to mutate.
- **Typed errors per domain.** Subclass a base `<Domain>Error`. Each operation throws specific subclasses (`AlreadyMergedError`, `InsufficientWalletBalanceError`, etc.) so callers can `catch (e instanceof X)`.
- **Audit-log writes are best-effort** (`writeAuditLogSafe`) and happen *after* the transaction commits. A missing audit row never undoes a successful operation.
- **Pages use reducer-driven `use*` hooks** in `src/hooks/`. See `useAuditLog.js` for the pattern: a `reducer` with explicit action types, mock-mode handled silently (don't surface `MockModeError` as a UI error), `exportAll` separate from paginated fetch.
- **List pages get CSV export.** Wire `src/lib/csv.js`'s `downloadCsv` with a column spec. The pattern is in `AuditLog.jsx` and `Dedupe.jsx`. Manager-only pages typically have it in the top-right of the filter bar.
- **Confirmation for destructive actions**: "type WORD to confirm" pattern (see `Dedupe.jsx`'s `MERGE` input). Avoid raw confirm dialogs.
- **Tap targets ≥44px** (iOS HIG). Use `py-3` for sidebar / action buttons, `py-2` for filter chips. Add `active:` states for tap feedback.
- **Mock-mode is a first-class concern.** `VITE_USE_MOCK_DATA=true` should produce a clean empty state ("Mock mode — no data available") rather than an error.
- **Tier 1 unit tests for every operation.** Use the `src/lib/wallet/_test-helpers.js` factory pattern (`makeMockStore`, mock `tx`, seed data in an in-memory store). Don't skip tests on a new operation — Phase 1's HARD-invariant tests caught a real bug (the adjustment-direction parsing).

### Phase 2 implementation order (suggested)

Roughly the order tasks unblock each other:

1. **Task 2.5 — Templates. ✅ DONE (29 May 2026).** Structure templates + tournament templates, both manager-only at `/td/templates`. Domain module `src/lib/tournaments/` (6 ops: create/update/archive × structure/tournament), `useStructureTemplates`/`useTournamentTemplates` hooks, reusable `src/components/StructureEditor.jsx`, panels under `src/pages/td/templates/`, `seed:templates`. **2.1 should reuse `StructureEditor` and load a tournament template's `config` as form defaults.**
2. **Task 2.1 — Tournament create. ✅ DONE (29 May 2026).** 3-step wizard at `/td/tournaments/new` (manager-only UI gate) on the shared `src/components/FormWizard.jsx` (General Information / Structure / Re-entry & extras; free navigation, validate-on-submit). `createTournament` op in `src/lib/tournaments/tournaments.js`; reuses `StructureEditor`; optionally seeds from a tournament template. Shared form primitives in `src/components/FormFields.jsx`, option lists in `src/lib/gameTypes.js`. **Edit mode + the remaining core fields (fee/guarantee) + multi-day/multi-flight/satellite setup are deferred to 2.4.** (The add-on is now variable — cost + chips — done 29 May; see the "variable tournament add-ons" session block below.)
3. **Task 2.2 — Tournament list. ← NEXT.** Replaces the placeholder at `/td/tournaments`. Will need a list hook (`useTournaments`) following `useAuditLog`'s pattern. CSV export. **This is where the created tournament becomes visible, and it owns the "+ New tournament" entry point linking to `/td/tournaments/new`** (the create form currently has no in-app link to it — you reach it by URL).
4. **Task 2.4 — Multi-format wizards.** The sessions model is the trickiest part of the project so far. Re-read canonical-schema.md §5.1 carefully. Sessions have a routing graph (`convergesIntoSessionId` is the only routing field — `dayNumber` / `flightLabel` are display-only). Use `runValidatedBatch` to create all sessions atomically at tournament-setup time (pre-known IDs via `generateId()`).
5. **Task 2.3 — Live clock.** Use Firestore real-time subscriptions (`subscribeToTournament`) for the clock. The venue display will subscribe to the same doc. Pause/resume sets `pausedAt`. Advancing levels updates `currentStructureIndex`. Server-time discipline: never trust client clock for "what time is it now" — use `Timestamp.now()` from the SDK consistently.
6. **Task 2.6 — Seating.** Tables + entries. Bulk operations (open all tables, balance) are batched. Seat-card / alternate-ticket printing is later in Phase 5 — for now, just produce the data.
7. **Task 2.7 — Status transitions.** Default invariants with manager-override path (`tournament.statusChanged` audit + optional `manager.override` audit when bypassing the default sequence).

### Things to verify with Guy at the start of Phase 2 — ✅ ANSWERED 29 May 2026 (full detail in DECISIONS.md)

- **Tournament create form layout** → originally **sectioned single page**, but **reversed 29 May 2026 to a 3-step wizard** (General Information / Structure / Re-entry & extras) after the filled-out page proved too long to scan. Both the create form and the template editor share `src/components/FormWizard.jsx`. gameType still drives conditional Satellite / Mystery-bounty sections (now on the Re-entry & extras step). See DECISIONS.md.
- **Clock visual design** → **big & readable across the room** — giant blind text, large pause/resume + advance controls on the TD's own clock screen, not just the Phase 5 venue display.
- **Seat-card print format** → four fields: **Player name, Table & seat number, Tournament name + start time, Starting stack.** Task 2.6 must capture all four; Phase 5 renders them.
- **Registration UX** → **tournament-first, with a confirm step.** Cashier picks the tournament (`/td/tournaments/:id/register`), then registers a player, confirming before the wallet/entry write commits.

### Carried into Phase 2 (Phase 1 leftovers — none block Phase 2 start)

1. **iPad on-device smoke test.** Code-review pass is done; Guy needs to actually open a dev URL on an iPad and run through the runbook in the "This session" block below. Most likely findings: CSV download UX in Safari (Files-app prompt? inline view?); home-indicator overlap on toasts and the mock-role-switcher.
2. **Deploy `firestore.indexes.json` to `playlive-25a17`.** `npx firebase deploy --only firestore:indexes --project playlive-25a17`. Required for the audit log viewer's filtered queries to work in production; everything else is fine without it. Waits on Guy's go (touches production).
3. **Drop the legacy `tournaments` collection** (1,695 docs in the old Casinoware-snapshot shape). **This is a hard gate before any Phase 2 production write.** The canonical schema's `tournaments` collection name is the same — we can't write to it while 1,695 incompatible docs sit there. The script is ready in Claude's head; waits on Guy's explicit go (destructive). Phase 2 development against the emulator is fine until then.

### Dev workflow reminders

- `npm run dev` (with `VITE_USE_MOCK_DATA=true` + `VITE_FIRESTORE_EMULATOR=false` in `.env.local`) → pure mock mode, no Firestore.
- `npm run dev` (with `VITE_FIRESTORE_EMULATOR=true`) → talks to the local Firestore emulator. Requires `npm run emulator` to be running in another terminal. Auth stays mocked. The emulator client is pinned to **HTTP long-polling** (`experimentalForceLongPolling`, see `src/firebase/config.js`) because default WebChannel hangs write-acks on this Windows/localhost setup — symptom was a save button stuck on "Saving…". After editing `src/firebase/config.js`, fully **restart** `npm run dev` (HMR won't re-init the Firebase client).
- `npm run seed:*` → seed scripts. Phase 2 will want a `seed:tournaments` script following the same pattern (push permissive dev rules + write via `withSecurityRulesDisabled`).
- `npm test` → 283 tier-1 unit tests, ~2.4s.
- `npm run test:rules` → 174 emulator-backed rules tests, ~7s. Requires Java on PATH (Eclipse Temurin 21 installed; `export PATH="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot/bin:$PATH"` if a shell doesn't see `java`).
- `npm run lint && npm run build` → must be clean before each commit.

### What NOT to do in Phase 2

- **Don't relax the two HARD invariants** (`walletBalance >= 0`, `walletTransactions.amount > 0`). They survived Phase 1; they're the foundation of the wallet ledger's integrity.
- **Don't add a new walletTransaction type** without updating the type union in `src/lib/schema/walletTransaction.js` AND `src/lib/wallet/_shared.js` `balanceDelta` AND `src/lib/wallet/reconciliation.js`. The audit-log direction-field fix happened because a similar three-place change was made and one place fell behind.
- **Don't bypass the wallet module** for ticket / walletTransaction / withdrawal writes. The data layer's per-collection wrappers intentionally don't expose write helpers for those collections. Phase 2 task 2.6 should call `payViaWallet` / `payViaTicket` / etc. when registering players into tournaments.
- **Don't drop the legacy `tournaments` collection in production without Guy's explicit, in-session "yes drop it now" confirmation.** Destructive. Backup paths: Casinoware itself, manual CSV exports, local audit dump at `scripts/firestore-audit/output/tournaments.dump.json`.

## This session (29 May 2026) — variable tournament add-ons

Made tournament add-ons configurable: when an add-on is offered, both its **cost** and the **chips** it grants are now set explicitly (previously `hasAddOn` was a bare boolean). Full vertical slice — schema → both forms → seed / fixtures / tests → docs. Full reasoning + the design asymmetries are in DECISIONS.md (29 May entry).

- **Schema (both `src/lib/schema/tournament.js` and `tournamentTemplate.js`).** `ReentryConfig` gains `addOnCost: Money.nullable()` + `addOnChips: ChipCount.nullable()` beside `hasAddOn`, with a `superRefine` requiring both non-null iff `hasAddOn === true` (both null otherwise). Mirrors the existing `maxReentries` / `maxRebuys` type-gating but adds schema-level enforcement.
- **Forms — `src/pages/td/TournamentNew.jsx` (create) and `src/pages/td/templates/TournamentTemplatesPanel.jsx` (template editor).** The Has-add-on toggle now reveals an **Add-on cost** (`Money`) + **Add-on chips** (`Num`) pair; both clear to `null` when off. initialForm / applyTemplate seed them from an existing config (`centsToStr` / `String`); buildArgs / buildConfig gate them on `hasAddOn` and convert via `dollarsToCents` / `intOf`. `validate()` blocks submit when `hasAddOn` and chips ≤ 0 ("An add-on must grant a positive number of chips"). **Cost may be 0** (free add-on); **chips must be > 0** (form-level guard).
- **Seed / fixtures / tests.** `scripts/seed/templates.js` `reentry()` helper + the `tt-retired` call site carry the new fields (`addOnCost: 50_00, addOnChips: 20_000`). `src/lib/schema/_fixtures.js` and the `tournaments.test.js` / `templates.test.js` fixtures updated. Added 2 conformance tests in `tournaments.test.js` (a valid rebuy add-on parses and carries the values; a `hasAddOn: true` with null fields is rejected by the real schema).
- **Docs.** `docs/schema/canonical-schema.md` §3.1 `reentryConfig` block documents `addOnCost` / `addOnChips` (non-null iff `hasAddOn`); §3.5 inherits the shape.
- **Verification.** `npm test` **283 pass** (+2), `npm run lint` clean, `npm run build` clean. **Emulator round-trip, both forms (Mode 2):** toggling Has-add-on reveals/clears the two fields; create form persisted addOnCost 7500 / addOnChips 25000 (confirmed via REST read-back); template editor round-tripped 4000 / 15000 with the re-entry type preserved; seed `tt-retired` shows 5000 / 20000; the positive-chips guard blocked submit with the expected toast. No console errors.

## Earlier this session (29 May 2026) — 3-step wizard refactor (create form + template editor)

Converted both tournament-config forms from a single page to a 3-step wizard (**General Information / Structure / Re-entry & extras**) on a new shared `src/components/FormWizard.jsx`. Reverses the 29 May single-page design call — see DECISIONS.md for the full reasoning.

- **`src/components/FormWizard.jsx` (new).** Presentational only — owns no form state. Props: `steps` (`{key,label,content}[]`), `current`, `onStepChange`, `errorKeys` (step keys to flag), `actions` (right-aligned JSX slot). Renders a clickable stepper (red "!" badge on errored steps), the current step's content, and a Back/Next + actions footer. Both forms render the same chrome.
- **Free navigation, validate-on-submit.** Every step header jumps directly; Back/Next are conveniences. The primary action (Create / Save changes) sits in the persistent `actions` slot reachable from any step and validates the WHOLE form. `validate()` was refactored from a single error string to an object keyed by step (`general` / `structure` / `rest`); on a failed submit the page sets `stepErrors`, jumps to the first errored step via `STEP_ORDER.find`, and toasts that step's message.
- **`TournamentNew.jsx`** — three steps; the three format toggles (multi-day / multi-flight / upper-deck) moved out of Schedule into the Structure step so "shape of the tournament" is grouped. Create button still disabled in pure mock mode.
- **`TournamentTemplatesPanel.jsx`** — same three steps for the template editor; keeps its **own** `bountyTotalPool` field (TemplateConfig is exempt from the `sum === totalPool` invariant — see DECISIONS.md), unlike the create form which derives it.
- **Verification.** `npm test` **283 pass**, `npm run lint` clean, `npm run build` clean. **Emulator round-trip, both forms (Mode 2):** create wizard — free-jumped across all three steps, confirmed an empty submit flags General + Structure with "!" and jumps to General, then seeded the Friday template + set a start time and created → emulator read-back showed a valid `$100 NLH` / scheduled / 7-level doc. Template editor — opened the Mystery Bounty template, free-jumped to the Re-entry & extras step (Mystery-bounty section with its own total-pool field renders), renamed it and saved → emulator read-back confirmed the new name + intact bounty config. No console errors.

## Earlier this day (29 May 2026) — task 2.1 (Tournament create)

**Phase 2 task 2.1 (Tournament create) — DONE.** Built as a single-page form (since converted to the wizard above) at `/td/tournaments/new`, manager-only (route already gated `requiredRoles={['manager']}`; the create button is additionally disabled in pure mock mode). Builds directly on the 2.5 template work.

- **`createTournament` domain op — `src/lib/tournaments/tournaments.js`** (re-exported from `index.js`). Pure async, takes `{actorId, actorRole}` like every domain op. Assembles a full `Tournament` doc, converts `Date → Timestamp` at the boundary (`toTimestamp` / `toNullableTimestamp`), writes via `validatedSet` (which re-parses the WHOLE doc through the Zod `Tournament` schema incl. every `superRefine` — so a written doc is a proven-valid doc), then a best-effort `tournament.created` audit row after the write. Initializes all live-state/counter fields (`status`, `isOnBreak: false`, `currentStructureIndex: null`, `entryCount`/`uniquePlayerCount`/`remainingPlayerCount`/`totalPrizePool: 0`, `createdBy: actorId`). Rejects a blank `actorId` with `TournamentError` before any write.
- **`DEFAULT_PAYOUT` placeholder + mysteryBounty `totalPool` derivation** — see the dedicated DECISIONS.md entry (29 May). Short version: `payoutStructure: null` → winner-takes-all default (real editor is 2.3); mysteryBounty `bountyPoolConfig.totalPool` is derived as `sum(bountyValues)` so the schema's `sum === totalPool` invariant can't be violated from the UI.
- **15 tier-1 tests — `tournaments.test.js`.** `vi.mock`s `../firestore` (validatedSet echoes the doc back, generateId fixed), imports the REAL `Tournament` schema. Suites: document assembly (path, live-state/counter fields, defaults), payout default (winner-takes-all when null, passthrough when explicit), time conversion (Date→Timestamp, null lateReg preserved), **schema conformance** (`Tournament.safeParse(capturedDoc())` for nlh / satellite / mysteryBounty / multi-flight fixtures), audit metadata, and rejections (blank actorId, non-Date / NaN scheduledStartTime).
- **Shared form primitives extracted — `src/components/FormFields.jsx`.** `Section`, `Text`, `Money`, `Num`, `Select`, `Toggle`, `BountyValues`, `EmptyState`, plus a new dark-themed `DateTime` (datetime-local). `TournamentTemplatesPanel.jsx` was refactored to import these (≈150 lines of local primitives/helpers/constants deleted, behaviour unchanged) so the template editor and the create form share one set.
- **Option lists consolidated — `src/lib/gameTypes.js`.** `GAME_TYPES`, `GAME_TYPE_LABEL`, `REENTRY_TYPES`. Single source of truth used by the template panel, the create form, and the upcoming list/detail.
- **The form — `src/pages/td/TournamentNew.jsx`** (was a placeholder). Money/numeric fields held as **strings** (so decimal entry isn't fought by re-renders), converted via `src/lib/money.js` (`dollarsToCents`/`intOf`/`intOrNull`) at save. `StructureEditor` holds the structure as a real array. A "Start from template" select calls `applyTemplate(id)` to map a tournament template's `config` onto every form field and load its `config.structureTemplateId` levels; a separate structure-template loader sets the embedded structure + records `structureTemplateId` provenance. `validate()` checks name, ≥1 valid `Structure` level, a valid `scheduledStartTime`, optional-but-valid lateReg, and ≥1 bounty value for mysteryBounty. Coupled multi-day/multi-flight setters keep `isMultiFlight ⇒ isMultiDay`. Conditional Satellite / Mystery-bounty sections by `gameType`. On success: toast + `navigate('/td/tournaments')`; `TournamentError` is caught → error toast.
- **Verification.** `npm test` → **283 pass** (25 files, was 257/23 — added `money.test.js` + `tournaments.test.js`'s createTournament suite). `npm run lint` clean. `npm run build` clean (pre-existing 500 kB chunk warning only). **Emulator round-trip, full UI path:** booted the Firestore emulator + dev server in Mode 2 (mock manager + emulator), seeded templates, drove the browser via the preview tool — navigated to `/td/tournaments/new`, picked the "Friday $100 NLH" template (populated name + loaded 5 levels + 2 breaks), set start `2026-06-06T19:00`, clicked Create. Read the doc back from the emulator REST API: `name` "$100 NLH", `gameType` nlh, `status` scheduled, `scheduledStartTime` `2026-06-06T09:00:00Z` (= 19:00 AEST, conversion correct), `structure` 7 entries, counters 0, `payoutStructure` winner-takes-all, `createdBy` mock-user, `buyIn` 10000c, `startingStack` 30000, `structureTemplateId` st-deepstack, `fromTemplateId` tt-friday-nlh. End-to-end confirmed.
- **Known gap for 2.2:** the create form has **no in-app entry point yet** — you reach `/td/tournaments/new` by URL. The "+ New tournament" button belongs on the tournament list (task 2.2). Also `.claude/launch.json` (preview-tool dev-server config) was added this session; it's a local dev convenience — committing it is harmless but optional.

## Previous session (29 May 2026) — task 2.5 (Templates)

**Phase 2 task 2.5 (Templates) — DONE.** Full vertical slice, manager-only, live at `/td/templates`. New `src/lib/tournaments/` domain module follows the wallet-module conventions exactly.

- **Domain module `src/lib/tournaments/`:**
  - `errors.js` — base `TournamentError`.
  - `templates.js` — six operations: `createStructureTemplate` / `updateStructureTemplate` / `archiveStructureTemplate` and the three `…TournamentTemplate` equivalents. Internal DRY helpers `createTemplate` / `reviseTemplate` keyed off a `TEMPLATE_KINDS` table (path + schema + audit targetType per kind) so the six public exports don't duplicate bodies.
  - **Updates go through `runValidatedTransaction` read-modify-write, NOT `validatedUpdate`.** This is load-bearing: `validatedUpdate` does a partial write that does **not** re-validate against the schema (see the WARNING in `firestore/_client.js`), so it would let an invariant-bearing field (`levels`' sequential `blindNumber`, `config`'s `superRefine`) drift. Re-reading and `tx.set`-ing the full merged doc re-runs the validator. Any future template-like editor must do the same.
  - Audit: best-effort `writeAuditLogSafe` after commit. `…created` carries `{name, levelCount}` / `{name, gameType}`; `…updated` carries `{changedFields}`; `…archived` sets `archivedAt: now()`.
  - `index.js` re-exports the six ops + `TournamentError`.
- **13 tier-1 tests** (`templates.test.js`) — `vi.mock`s `../firestore`, runs the transaction callback against an in-memory `tx`. Covers full-doc assembly, description default `null`, metadata shape, patch-merge + `updatedAt` bump + `changedFields`, archive timestamp, and rejections (blank actorId/id → `TournamentError`; `NotFoundError` propagates with no audit row). All green.
- **`useTemplates.js` hook** — reducer pattern matching `useAuditLog`. `useStructureTemplates()` / `useTournamentTemplates()` fetch all, **filter `archivedAt === null`**, sort by name. Mock mode → clean empty state.
- **`src/components/StructureEditor.jsx`** — reusable controlled editor over a `Structure` array (level | break rows). Every mutation re-runs `renumber()` so `blindNumber` stays sequential across level entries (breaks skipped) — the exact invariant `Structure.superRefine` enforces. Inline per-row validation hints via `Structure.safeParse`. **Task 2.1 reuses this.**
- **UI:** `src/pages/td/Templates.jsx` hub (tabs: structures / tournaments) → `StructureTemplatesPanel.jsx` (list ↔ editor, CSV export, type-to-confirm archive) and `TournamentTemplatesPanel.jsx` (sectioned single-page form per Guy's design call; money fields held as strings, converted at save; `isMultiFlight ⇒ isMultiDay` enforced by coupled setters; conditional Satellite / Mystery-bounty sections by gameType).
- **Wiring:** `nav.js` Templates item (manager-only, `allowedRoles: []`), `App.jsx` manager-only route, `scripts/seed/templates.js` (+ `seed:templates` npm script) seeding 2 structure + 3 active + 1 archived tournament template.
- **`auditLog.js`** — added the six template action types to `WELL_KNOWN_ACTION_TYPES`.
- **`canonical-schema.md` fixes:** §3.4 `structureTemplates.levels` rewritten — it reuses the `Structure` discriminated union (level | break entries), **not** the stale flat array with per-level `breakAfterMinutes`/`isColorUp` that was documented. §3.6 well-known actionType table gained the six template rows.
- **Verification:** `npm test` → 257 pass (23 files). `npm run lint` → clean. `npm run build` → clean (pre-existing 500 kB chunk warning only). **Emulator round-trip:** booted Firestore emulator, ran `seed:templates`, read both collections back over the REST API — all 6 docs present, `levels` round-tripped as the discriminated-union shape. (`npm run test:rules` was NOT re-run this session — no rules changes; the access matrix already covers `structureTemplates`/`tournamentTemplates`.)

## Earlier session (28 May 2026)

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

## Earlier session (27 May 2026)

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

The agenda for the next session is laid out fully in the **"Phase 2 starting notes"** block at the top of this doc. The short version:

1. **Continue Phase 2: ~~2.5 (templates) ✅~~ → ~~2.1 (tournament create) ✅~~ → 2.2 (list, NEXT) → 2.4 (multi-format wizards) → 2.3 (clock) → 2.6 (seating) → 2.7 (status transitions).** Task 2.2 replaces the `/td/tournaments` placeholder with a real list (needs a `useTournaments` hook following `useAuditLog`'s pattern + CSV export), and owns the "+ New tournament" link to the 2.1 create form. Edit mode + the remaining 2.1 core fields (fee/guarantee/add-on toggle) + multi-day/multi-flight/satellite setup roll into 2.4.
2. Three Phase 1 leftovers carried forward — none block starting Phase 2:
   - iPad on-device smoke test (Guy, with an iPad).
   - Deploy `firestore.indexes.json` (waits on Guy's go; touches production).
   - Drop the legacy `tournaments` collection in production (hard gate before any Phase 2 production write; waits on Guy's explicit go).
3. **Narrow SA role back down.** The audit SA currently has `Editor`. Audit is done; downgrade to `Cloud Datastore Viewer` or disable. Not urgent.
4. **(For Guy's awareness) Provision a real Manager user** in Firebase Auth. Steps in `docs/operator/initial-admin-setup.md`. Not blocking — mock mode covers UI iteration.

## What's blocked

Nothing today. Phase 2 development can start immediately against the emulator. The only thing that's gated is **production writes** to the canonical `tournaments` collection — they wait on the legacy-collection drop (item 2 above).

**Coordination risk to watch** (not a blocker today): if the analytics dashboard or Player App needs to come back online mid-build, the in-progress rules / schema state of `playlive-25a17` must not break them. Likely fine — Phase 6 was always going to handle the schema migration for the other two apps — but worth being explicit about.

## Open questions for Guy

The four Phase 2 design questions (form layout, clock visual design, seat-card print format, registration UX) were **answered 29 May 2026** — see the "Things to verify with Guy" block above and the 29 May DECISIONS.md entry. No open design questions blocking task 2.1. New questions will surface when 2.4 (multi-format / sessions model) and 2.3 (clock) are built.

## Test infrastructure (reference)

For future sessions and future devs.

```
npm test               # tier 1: validators + wallet + tournaments (283 tests, ~2.4s)
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
