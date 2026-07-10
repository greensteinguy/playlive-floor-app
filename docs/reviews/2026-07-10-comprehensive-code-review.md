# Comprehensive Code Review — 10 July 2026

Six parallel review agents each read one area of the app in full (source + tests) and graded it independently. This document is the compiled result. Requested by Guy to see how the current model (Claude Fable 5) evaluates the app built with a prior model, with emphasis on **table management** and **clock management**.

## Scorecard

| Area | Grade | One-line verdict |
|---|---|---|
| Tournament clock | **A−** | Anchor-based derivation model is exactly right; gaps are multi-device write-path details |
| Tournament lifecycle / sessions / payouts | **B+** | Disciplined domain layer; status machine checks shape not world-state; payout cash math unbuilt |
| Wallet / money | **B** | Correct ledger architecture; missing idempotency creates real duplicate-money windows |
| Table management / seating | **B−** | Good pure-planner design undercut by one systemic stale-entry concurrency flaw |
| Registration / entries / players | **B−** | Atomic entry+payment writes, but double-registration is possible across two devices |
| Infrastructure / rules / auth | **B−** | Real deployed rules + tests, but a live production-path defect and an audit tamper hole |

**Overall: B.** The architecture is genuinely good — better than most solo-built apps of this size. The pure-function/Firestore-op split, whole-document Zod validation on every write, atomic multi-doc transactions, and the clock's anchor model are all the right calls, honestly documented and well unit-tested. What holds the app back is one repeated blind spot: **the app is designed for multiple concurrent staff devices, but most business-rule guards run against stale client snapshots outside the transaction that commits the write.** The transactions protect *how* data is written; they don't re-verify *whether the action is still valid* at commit time.

---

## The five cross-cutting patterns

Nearly every serious finding below is an instance of one of these:

### 1. Guards outside the transaction (the systemic flaw)
The duplicate-registration check, late-reg gate, seat-source lookup, and balance previews all evaluate client-fetched snapshots that can be minutes old, and the committing transaction never re-reads them. Two devices acting near-simultaneously produce: a player seated at two tables, a player registered and charged twice, an entry into a closed tournament, a double-drawn room, two "Table 5"s. Firestore transactions are used — but they only re-read the docs they write, not the docs the *decision* was based on.

### 2. No idempotency on money-bearing ops
`withWriteTimeout` (10s) can report failure on a write that later commits. Every retry mints fresh `generateId()` doc IDs, so the natural cashier retry duplicates the deposit/entry/payout — and because a duplicate writes both the ledger row and the balance bump, **reconciliation reports zero drift on self-consistently wrong books**. The ticket path is the only one that self-protects (in-transaction state check); it's the template the rest should follow.

### 3. Client wall-clocks written into the record
`now()` = `Timestamp.now()` everywhere: clock anchors, ledger rows, audit rows, `registeredAt` (which orders the alternates waitlist). A skewed desk PC writes persistent error into clock pause points, excludes transactions from end-of-day reconciliation windows, and reorders the waitlist.

### 4. Missing recovery paths
There is no void-entry/refund op (schema fully supports it — nothing writes it), no un-bust, no undo for level changes (Back/Advance restart the level at full duration), no repair path for an entry pointing at a deleted table. On a live floor, mistakes will happen; today most of them end in a manual Firestore console edit mid-event.

### 5. Written-but-unwired code
`subscribeToTables`, `subscribeToEntries`, the `gotoLevel` clock op (built, tested, no UI), `withdrawalRequest`/`withdrawalCancel` ledger types, `addOn` entry type, several data-layer CRUD helpers. Much of the "top improvements" work below is plumbing existing tested code into use, not writing new systems.

---

## 🔴 Live right now on staging (fix first)

The deployed `firestore.rules` contain **no collection-group match blocks** (`match /{path=**}/entries/{id}` etc.), so the three shipped `collectionGroup()` queries are permission-denied on playlive-floor.web.app today:

- Player profile **Activity tab** (`src/lib/firestore/entries.js:63` via `usePlayerActivity`)
- **Dedupe merge** — dies mid-operation (`src/lib/players/merge.js:82`)
- Admin **Reconciliation** page (`src/lib/firestore/walletTransactions.js:68`)

The `entries` CG **index** was deployed but the matching rule never was; `tickets.state` and `walletTransactions` additionally have no CG-scope index entries, so they'd fail with `failed-precondition` even after the rules fix. The rules test suite never issues a collection-group query, which is why this slipped through.

While in the rules file, fix the second finding: `auditLog` has `allow write: if isStaff()` — write includes **update and delete**, so any staff member can delete the audit row covering their own action. Should be `allow create: if isStaff(); allow update, delete: if false;`. Same blanket-write lets staff hard-delete wallet ledger rows — add `allow delete: if false` on `walletTransactions`/`tickets`. Then extend the rules test matrix to cover update/delete verbs and CG queries so both stay locked in.

---

## Area detail

### Tournament clock — A− (the strongest area)

**What's right:** The persistence model — store only `clockStartIndex` / `clockStartedAt` / `clockPausedAt` and *derive* the live level and countdown — is exactly the correct design. Levels auto-advance with zero writes, refresh is lossless, and there's no mutable `remainingSeconds` to corrupt. The "never snap mid-run" rule is genuinely engineered: `clock-sync.js` is a pure optimistic-anchor state machine whose tests literally assert reference-equality ("same reference → no snap") and absorb late server echoes. Resume math is millisecond-exact and shared between the server op and optimistic layer so predictions equal the committed doc by construction. Breaks, capped days, and play-to-winner edge cases are handled and tested. Three-layer split (pure math → pure reducer → thin hook) is textbook.

**Top issues:**
- **H1 — `PENDING_TIMEOUT` divergence** (`clock-sync.js:329-334`): if two TDs act simultaneously (A pauses while B advances), A's screen can ignore both echoes and then adopt the wrong baseline on timeout — the *controlling* device shows the wrong level indefinitely until the next clock event or refresh. Fix: on timeout, compare derived state vs server; re-seed if the level differs. A justified one-time correction after a genuine external event is exactly what the gospel rule permits.
- **H2 — Anchors stamped with client wall-clock** (`tournaments/clock.js:73-74`): a pause from a device 90s skewed writes a freeze point 90s wrong for everyone, persisted. Use `serverTimestamp()` (or a measured client↔server offset) before a second control device is used in anger.
- **M1 — Two-TD Advance race double-advances** (blinds skip a level, no error surfaced). Pass the expected `fromIndex` into the op and abort if the derived current no longer matches.
- **M2 — Live structure edits re-map a running clock** with no guard, no event, no audit — the exact snap the gospel forbids. Block the editor while a session clock runs, or make the edit an explicit re-anchor event.
- **M4/M5 — Missing floor controls:** no add-time op anywhere; `gotoLevel` is built and tested but has no UI; a misclicked Back loses the level position unrecoverably. Add-time is a one-line anchor shift (`clockStartedAt += deltaMs`) — the architecture makes it trivial.
- Smaller: stale-`nowMs` flash on external re-seed; no `visibilitychange` tick (iPad wake / background-tab throttling); iPad Safari `AudioContext` needs gesture priming or the auto-advance beep is silent; dead `/td/clock` placeholder route; duplicated `tsToMillis`.

### Table management / seating — B−

**What's right:** Clean pure/impure split with injectable RNG; correct Fisher–Yates; balance/break transactions re-read all open tables and *re-plan inside the transaction* (above-average discipline); schema invariants with teeth (seat count, uniqueness, broken⇒closed) enforced on every whole-doc write; good confirm-preview UX for balance/break; typed error taxonomy; every op audit-logged.

**Top issues:**
- **CRITICAL — Seat ops trust the client-stale `entry.currentTableId`** instead of re-reading the entry inside the transaction (`seating.js:353-406`, `:414-444`, `:460-511`). Two devices moving/eliminating/seating the same player produce: a player's entryId occupying **two seats**, a busted player parked in a seat forever, the same alternate seated twice. This is the one failure class that shows *silently wrong seat state* in front of players. Fix: `tx.get` the entry, derive the source seat from the fresh doc, reject on drift.
- **HIGH — No realtime subscription:** `useSeating` is a deliberate one-shot fetch while `subscribeToTables` sits unused. The iPad's room view, balance preview, and "Balanced ✓" badge silently diverge until the TD acts. This is the architectural gap feeding the issue above.
- **HIGH — Double-draw race** (`seating.js:261-292`): the `TablesExistError` pre-check runs before a *batch* (no contention check). Two TDs tapping "Draw seats" within a second → **two complete sets of tables**. Fix with a transactional sentinel read or deterministic table IDs.
- **MEDIUM:** `openTable` number race (two "Table 5"s); `clearSeating` can orphan a concurrently-seated entry pointing at a deleted table with no repair path; deactivated-but-occupied tables drop out of the balance math ("Balanced ±1" while one table is 4 deep over the rest).
- **Domain polish (consciously deferred, confirm in floor walkthrough):** balancing moves the highest-numbered seat, not the next big blind — deterministic, so seat 9 gets dragged all night; no final-table redraw; double-break shows a misleading error; **no undo for eliminate** (wrong-tap = manual DB edit during live play); "open table then draw" is an impossible workflow.

### Registration / entries / players — B−

**What's right:** Entry + ledger + balance genuinely atomic in one transaction; wallet `>= 0` invariant checked against a fresh in-transaction read; ticket re-use blocked correctly in-transaction (the one race-safe payment path); excellent Entry schema invariants (`superRefine` for seat/bust/void consistency); protected-field discipline on player updates; AU phone normalization (`0` ↔ `+61`) in search and dedupe; good desk flow (tournament-first, inline quick-create, auto-reset).

**Top issues:**
- **CRITICAL — Double-registration across devices:** the only duplicate guard is `planEntry` against a stale client list; the payment transaction never re-reads the player's entries; entry IDs are random. Two staff confirming the same player → two live entries, **two charges**, duplicate entry numbers, and (next point) no way to fix it in-app. Fix: deterministic entry ID (`${playerId}_${entryNumber}` or a per-player registration lock doc) checked with `tx.get` — this also makes timeout-retries idempotent for every payment method.
- **HIGH — No void/refund path exists.** The schema, counters, and seating are all void-aware; nothing writes it. A mistaken buy-in cannot be corrected in-app. Day-one operational need for a cash venue.
- **HIGH — Late-reg/status gate is stale-client-only** — a device with an old page registers into a closed (or finished) tournament. Re-read the tournament inside the payment transaction; while there, write counter deltas atomically (kills the racy recount too).
- **MEDIUM:** merge double-counts `totalDeposited` (source not zeroed — analytics reads this); merge pre-check fetches *every withdrawal request ever*; `payViaTicket` can drive `ticketBalance` negative via unvalidated `tx.update`, which then **bricks the player doc** (every subsequent validated read throws); no diacritic folding in search (`jose` won't find "José" — real issue for a Melbourne player base); dedupe is phone-only; stale wallet balance falsely blocks the wallet payment method.
- **LOW:** no Enter-to-select/arrow-key search flow (the fast desk rhythm is impossible); some sub-44px touch targets; no emulator concurrency test for the double-registration scenario.

### Wallet / money — B

**What's right:** Integer cents everywhere with the only float at the form boundary (correctly rounded and tested); append-only ledger + cached balance updated in the same transaction (OCC-safe across desks); IDs generated *before* `runTransaction` so Firestore's internal retries can't duplicate rows; `walletTxDelta` as single source of truth shared by ledger display and reconciliation; compensating adjustments instead of edits; sound withdrawal state machine; **compliance clean** — nothing in `src/` initiates real money movement (verified by grep; PayID is display-only behind a "funds received" checkbox).

**Top issues:**
- **HIGH — Duplicate-money window on write timeout** (`_timeout.js:18-21` documents it): slow network → timeout toast at 10s → commit lands at 12s → cashier retries → second $500 deposit, and **reconciliation shows drift = 0**. Fix: generate the transaction ID when the confirm screen is shown (one ID per cashier gesture) and `tx.get` it before `tx.set` — highest impact per line of code in the module.
- **HIGH — `confirmWinCredit` has no double-payout guard** (`winCredit.js:30-80`) — unlike its bounty sibling, which does this right. Two cashiers working the end-of-tournament payout list both confirm 1st place → player credited twice, books self-consistent. The single most likely real-money loss in the current code. Mirror the bounty pattern (payout marker checked+set in-transaction; `Entry.cashWinnings` slot already exists).
- **HIGH — All money invariants (including roles) are client-JS-only** until rules mirror them. `actorRole` is a caller-supplied string. Known Week-3 gate — but rules must check custom claims and make `walletTransactions` create-only or the "HARD invariant" comments stay aspirational.
- **MEDIUM:** `ticketBalance` negative-write brick (same as registration M3); ledger timestamps from desk-PC clock skew the recon window; migration `recordOpeningBalance` doubles balances on re-run (guard is a comment, not code; docstring says "sets" but code *increments*); `withdrawalRequest`/`Cancel` ledger types are dead — pending withdrawals place no hold, so completions can bounce after the player spends; manager below-face-value ticket override leaves no in-transaction trace if the best-effort audit write is lost.
- **Test note:** unit tests are genuinely good (boundaries, error paths, named regressions) but the mock `tx.set` never runs the real Zod schema, and there's no emulator concurrency suite — the riskiest failure modes are exactly the ones the suite can't see.

### Tournament lifecycle / sessions / payouts / templates — B+

**What's right:** Tournament + full session graph created in one validated batch with pre-wired convergence pointers (dangling graphs impossible); `validateSessionPlan` checks slice tiling and survivor-routing partitions with human-readable errors, shared between live form feedback and the write path; format flags *derived* from the plan at create; status transitions validated in-transaction against fresh state with manager-override + audit for non-standard jumps; seed-fixture conformance gate.

**Top issues:**
- **HIGH — Structure tab lets format flags drift** from the session graph the create path so carefully derives them from (free `isMultiDay`/`isMultiFlight` toggles that can *only* create drift — remove them, derive from the subcollection).
- **HIGH — Editing the blind structure can strand the session graph:** trim a structure below a Day-2 session's `maximumStartIndex` and Day 2 can never start — discovered on the floor, with no repair path since plans are immutable post-create. Re-check session slices on structure save.
- **HIGH — `lateRegCutoffLevel` is decorative** — stored, edited, schema-bounded, never consulted by registration or the clock. Derive "effectively closed" from the clock anchor (pure function beside `deriveClock`).
- **MEDIUM:** status machine validates transition shape, not world state (`finished` with 80 players seated; `cancelled` doesn't cascade to sessions); whole-tab patches silently revert other devices' edits (no diff, no `updatedAt` precondition); parallel flights last-writer-win on the tournament's denormalized `liveState`; **prize pool ignores add-ons and guarantees** (`entryCount × buyIn`); the percent→cash conversion that must sum *exactly* to the pool doesn't exist yet, and the editor preview already shows drift (±0.5% tolerance + independent per-place rounding). Build `distributePayouts(pool, structure)` with largest-remainder as a pure tested lib *before* Phase 4 touches wallets.
- **LOW:** templates silently drop `maxSeatsPerTable` (always 9); archived structure template → empty structure with provenance still recorded; some dead data-layer CRUD.

### Infrastructure / rules / auth / shell — B−

**What's right:** Rules exist, are deployed, default-deny, read roles from server-set custom claims, and have an emulator-backed role×collection test matrix (including garbage-claim probes); every read/write funnels through Zod at `_client.js`; ADR-001 genuinely honored (no persistence anywhere; `withWriteTimeout` is exactly the right compensation, well tested); `.env.production` confirmed untracked; emulator uses `demo-` project so misconfig can't hit prod; leak-free toast, per-route error boundaries, single-source nav config.

**Top issues (beyond the two urgent rules fixes above):**
- **MEDIUM — Authed-but-role-less redirect loop:** every new staff account (between creation and `set-role.js`) bounces `/` → `/login` forever. Render "account not yet provisioned" instead.
- **MEDIUM — Audit logging is client-voluntary:** nothing couples a wallet write to its audit row; failures are swallowed; `actorRole` is caller-supplied. Acknowledged trade-off — but H2's create-only rule is the minimum to make the log mean something.
- **MEDIUM — Reads have no timeout guard** — the register page's player lookup can hang forever on a network wobble; writes got the guard, reads didn't. Add `withReadTimeout`.
- **LOW:** direct-URL access to full player PII for `readonly`/`td` roles (nav hides, route doesn't — confirm as product decision vs SOW §269); `auth.signIn/signOut` audit types declared but never emitted; audit pagination cursor uses raw timestamp (ties skip rows); ~1h role-revocation latency documented but no forced refresh; zero component/UI tests.

---

## Consolidated roadmap (ranked)

**Now (staging is live):**
1. **Collection-group rules + CG indexes, redeploy** — unbreaks Activity tab, dedupe merge, Reconciliation today.
2. **Rules verb hardening** — audit log create-only; deny delete on ledger collections; extend rules tests to update/delete + CG queries.

**Before first real-money tournament (correctness of record):**
3. **Idempotency keys on every money op** — gesture-scoped transaction IDs checked in-transaction (kills timeout-retry duplicates for deposits, buy-ins, payouts).
4. **Win-credit double-payout guard** — mirror the bounty pattern.
5. **Transactional business-rule guards** — re-read the entry doc in seat ops; re-read tournament status + player entries (deterministic entry ID) in the payment transaction; transactional draw-once sentinel for `drawSeats`.
6. **Recovery paths: `voidEntry` (+refund row) and un-bust** — the escape valve for every mistake above, and the schema already supports both.

**Before multi-device use in anger:**
7. **Realtime subscriptions** for tables + register page (the helpers already exist — this is hook plumbing) so both devices converge in seconds instead of minutes.
8. **Server time** — `serverTimestamp()` for clock anchors and ledger rows.
9. **Clock multi-device fixes** — `PENDING_TIMEOUT` re-seed comparison, idempotent advance (`expectedFromIndex`), structure-edit guard while running.

**Floor-readiness polish (fold into the planned seating walkthrough):**
10. **TD controls** — add-time op + goto-level UI (op already built); un-bust button; count deactivated-occupied tables in balance math; fix double-break error text; final-table redraw.
11. **Payout exact-distribution lib** (`sum === pool`, largest-remainder) before the Phase 4 Payouts page; enforce `lateRegCutoffLevel`; world-state guards on `finished`/`cancelled`.
12. **Desk speed** — Enter-to-select search, diacritic folding, name-based dedupe key, role-less-account screen, read timeouts.

## What the prior model got right (credit where due)

The clock architecture, the pure-planner pattern with injected RNG, whole-doc Zod validation as a JS substitute for types, atomic session-graph creation, the append-only ledger with in-transaction balance cache, honest self-documenting trade-off comments, and the emulator-backed rules matrix are all decisions a senior engineer would sign off on. The recurring gap — stale-snapshot guards and missing idempotency — is one *pattern* to fix across ~a dozen call sites, not a rearchitecture. The foundations are worth building on.
