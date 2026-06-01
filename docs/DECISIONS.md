# Decisions log

A running log of architecture and product decisions made on this project, with reasoning. Add to it whenever a non-trivial call is made. Significant decisions also get a full ADR in `docs/adr/`.

Format: newest first. Date, decision, reasoning, who decided.

---

## 1 June 2026 — Seat assignment (task 3.7): even-distribution random draw, separate draw/clear, standalone page

Built seating's first task — random seat draw, manual override, seat list — as a domain module (`src/lib/tournaments/seating.js`) + the `/td/tables` page. Several implementation calls, all reversible:

**1. The random draw distributes players evenly across tables from the start** (`distributeCounts` — e.g. 19 players 9-handed → tables of 7/6/6, not 9/9/1), shuffles the entries (injectable rng for tests), and fills seats 1..k per table. *Why even from the start:* standard poker practice — balanced tables are what the later balancing task (3.8) maintains; an initial fill-then-balance would just create immediate rebalancing work. Random *which-table/order* (via the shuffle) is the "draw"; seat-number-within-table is sequential for v1 (a random seat-within-table is a possible refinement).

**2. Draw (initial) and Clear are separate ops, not an in-place redraw.** `drawSeats` refuses if tables already exist for the session; `clearSeating` deletes the session's tables and clears every seated entry's seat fields. A redraw = Clear then Draw (the page chains them behind a confirm). *Why:* each op stays small and atomic, and clearSeating explicitly nulls every entry that referenced a deleted table, so there are no dangling `currentTableId` refs — an in-place redraw would have to reconcile old vs new assignments in one pass. drawSeats/clearSeating are single `runValidatedBatch` writes; a manual `seatEntry` move is one `runValidatedTransaction` over the target table, the source table (if different), and the entry (canonical §6.1 #6).

**3. Seats-per-table defaults to 9 (NLH), configurable per draw — not a tournament field.** The `Tournament` schema has no seats-per-table; the draw takes a seat-count input (default `DEFAULT_SEAT_COUNT = 9`). *Why:* it varies by format and the venue can decide at draw time; adding a schema field for it now would be premature.

**4. The seating page is the standalone `/td/tables` (the existing nav item) with a tournament + session picker, not a new tournament-scoped route.** It deep-links via `?tournamentId=` (a "Tables" link on the tournament detail top bar preselects it) and auto-selects the session for single-session tournaments. *Why:* reuses the existing nav entry; tables are per-session so the picker is needed regardless. The seat-card data (player · table · seat · starting stack = `tournament.startingStack`) exports to CSV; the thermal print job stays Phase 5.

**Verification:** `npm test` **568 pass** (+18 in `seating.test.js`: pure planners incl. a no-overflow sweep across many field sizes + Table-schema conformance of drawn tables; all four ops via the mock-store, incl. occupied/out-of-range/busted rejections and cross-table moves). Lint + build clean. Full emulator browser smoke-test: registered 5 players into a single-day tournament, drew at seatCount 4 → 2 tables [3,2] (REST-verified table docs + entry seat fields), moved a player across tables (occupancy [2,3], source seat freed + target filled atomically), exported the seat list, then Clear (tables deleted + every entry seat cleared, 0 dangling) → redraw → 1 table of 5. Zero console errors.

**Decider:** Action Plan spec (random draw / manual override / seat list). The even-distribution algorithm, the draw/clear split, the seatCount default, and the standalone-picker route were Claude's implementation calls.

## 31 May 2026 — Data-layer write timeout (no more infinite "Saving…")

A Firestore write against an unreachable backend used to spin forever: the SDK retries indefinitely (online-only, ADR-001), the write promise never settles, the `finally` that clears the button never runs, so a save sits on "Saving…" / "Creating…" with no feedback. Surfaced twice in dev when the local emulator was down.

**Decision: a 10-second write-timeout race at the data-layer write boundary.** `withWriteTimeout(promise, opLabel)` (`src/lib/firestore/_timeout.js`) races every write — `validatedSet`, `validatedUpdate`, `validatedDelete`, `runValidatedTransaction`, `runValidatedBatch` — against a deadline and rejects with a typed `WriteTimeoutError` whose `message` is user-facing: *"The server isn't responding. Please try again — if this problem persists, contact your system administrator."* The UI catch blocks already toast typed errors, so the four player/money flows (player create + edit, deposit, registration) surface it cleanly; every other write inherits the protection automatically and re-enables its button via the existing `finally`.

**Why the data layer, not each call site:** one wrapper protects every write app-wide and can't be forgotten on a new page. Why a typed error: `instanceof WriteTimeoutError` survives `wrapWalletErrors` (which re-throws the same instance), and the UI formatters already strip the `[wallet.*]` prefix.

**Why 10s, and the accepted caveat:** normal writes settle in well under a second (emulator or production), so 10s only trips on a genuinely unreachable/stalled backend — finite feedback beats an infinite spinner. The one edge case: a write that lands *after* the timeout (rare — a slow-but-alive backend) can't be recalled, so a retry could duplicate it. Accepted for v1 because the realistic trigger is "backend down" (nothing landed); the deadline is a single exported constant (`WRITE_TIMEOUT_MS`) if it needs tuning. Reads are deliberately left untouched (a hung read shows "Loading…", lower-stakes than an ambiguous money write) — a candidate follow-up.

**Verification:** `npm test` **550 pass** (+6 in `_timeout.test.js`: resolves-fast, rejects-after-deadline, doesn't-fire-early, propagates-a-real-rejection-unmasked, carries-label-+-user-message, clears-its-timer), lint + build clean. Browser-verified against the emulator: a normal create still completes in ~160ms; with the emulator killed, a create timed out and rendered the toast verbatim, then re-enabled the button (no infinite hang).

**Decider:** Guy requested the timeout + toast and the message wording. The 10s deadline, the data-layer placement, the typed-error approach, and the writes-only scope were Claude's implementation calls. Follows the 31 May wallet-deposit work, where the underlying hang was first diagnosed.

## 31 May 2026 — Wallet deposit + PayID wizard (task 3.6): player-first flow, receipt-gated PayID, venue PayID via env

Built the wallet-deposit screen (`/desk/deposit`) and its PayID wizard. The deposit op (`recordDeposit`) was already built/tested in Phase 1, so this was UI + the wizard + surfacing — **no new wallet/domain code**. Several implementation calls, all reversible:

**1. Player-first with a confirm step.** The deposit screen finds/quick-creates the player, takes amount + method, then **reviews before committing** — the same shape as registration (Guy's Phase-2 "confirm before the money write" UX call), applied here because a deposit also moves money. Deep-linkable from the player profile via `?playerId=` (a "+ Record a deposit" CTA on the Wallet tab), matching wallet-design §2.1 ("cashier opens the deposit screen on the player's profile").

**2. PayID stays deposit-only and the wizard gates on an explicit receipt confirmation.** Reaffirms the [27 May PayID-is-deposit-only decision](#27-may-2026--payid-is-deposit-only-never-a-direct-tournament-pay-method). The wizard shows the venue's receiving PayID for the cashier to read out, instructs the player to transfer the **full** amount, and **disables the Review/record action until a "I've confirmed $X was received in the venue account" checkbox is ticked** (the checkbox clears if the amount changes, so a confirmed receipt is always for the displayed amount). *Why a hard gate:* the app is record-keeping, not a payment processor — it must not record a PayID deposit the venue hasn't actually received. The full received amount is captured (a PayID can exceed any entry cost; the player then pays from wallet — two clean ledger rows).

**3. Venue PayID details are deployment config (env), not code.** New `VITE_VENUE_PAYID` / `VITE_VENUE_PAYID_NAME`, surfaced through a pure, unit-tested `resolveVenuePayId(env)` in `src/lib/venuePayId.js` (the impure `getVenuePayId()` reads `import.meta.env`). *Why env:* the PayID is venue-specific and changes per deployment, exactly like the Firebase config — keeping it out of code means no commit churn when it changes and no fictional value baked in. **Unconfigured is non-blocking:** the wizard shows a "not configured" note but still lets the cashier record the deposit (they may know the PayID by heart; the deposit record is what matters). It's display-only — the app never transmits it anywhere.

**4. Deposits surfaced now; the full ledger stays task 3.11.** The profile **Wallet & tickets** tab gains a **deposits-only** table (via a new one-shot `useWalletTransactions` hook — `timestamp` desc, a single-field orderBy so **no composite index** is needed). The hook already fetches *every* transaction type, so 3.11 (the full per-player ledger: spends, win credits, withdrawals, adjustments, with per-type sign + running balance) is a render change, not a new query. *Why split:* 3.6's remit is deposits; showing only deposits keeps the tab honest about what's been built without faking the rest of the ledger.

**Process note (caught by the smoke-test):** the deep-link preselect first used a `useRef` "once" guard + a fetch-cancellation flag. Under React StrictMode (dev) the mount→unmount→remount cancels the first `getPlayer` and the remount skips (ref already set), so the preselect silently never landed. Fixed with a race-safe `setSelectedPlayer((prev) => prev ?? p)` and no ref — correct under StrictMode and it won't clobber a selection the cashier already made. (It would have worked in a prod build, where StrictMode renders once, but the pattern was fragile; the functional-set version is the right one regardless.)

**Verification:** `npm test` **544 pass** (+4 in `venuePayId.test.js`), lint + build clean. Full emulator browser smoke-test: a cash deposit (Bob $25→$75) and a PayID deposit (Charlie $100→$220) both REST-verified (player `walletBalance` + `totalDeposited` up, `ticketBalance` untouched, a `deposit` walletTransaction with the right method/amount/reference), the PayID receipt gate held, the profile Wallet tab showed the deposit, the deep-link preselected the player, zero console errors.

**Decider:** Guy's standing UX calls (confirm-before-money-write, PayID-deposit-only). The receipt-gate, the env-config approach, the deposits-now-vs-full-ledger-3.11 split, and the StrictMode fix were Claude's implementation calls — flagged here. The local `.env.local` smoke-test PayID is a placeholder; Guy sets the real one before production.

## 31 May 2026 — Clock pause/resume smoothness: optimistic local-anchor countdown (render layer)

Fixed a bug in the task-2.6 clock: the TD screen's big countdown **jumped on pause→resume**. The fix is a render-layer redesign; `src/lib/clock.js`, the clock domain ops, and the schema are untouched.

**The gospel rule (Guy).** The *running* displayed clock is what players read to know the current blinds, so it must count down perfectly smooth + monotonic with **zero** jumps. We MAY write Firebase on clock *events* (start/pause/resume/advance/finish), but must **never** adjust/snap the running (non-paused) displayed clock to a Firebase/server-derived time. While running, the **local** countdown is the source of truth; re-seed it only on genuine state-change events.

**Root cause.** `useClock` derived the countdown from the Firestore echo on every tick. Pause/resume are async transactions whose new anchor is stamped at *commit* time; between click → commit → echo the display counted against the stale anchor and then **snapped** to the new one when it echoed back. Worst on the emulator (`experimentalForceLongPolling` removes latency compensation), but the window exists in production (WebChannel) too.

**Decision: an optimistic local-anchor countdown, reconciled (not re-derived) against echoes.** The controlling screen keeps a local anchor in its own wall-clock; button clicks mutate it synchronously (pause freezes instantly; resume continues from the frozen remaining via the *same* `resumeStartedAtMs` math the domain op uses) and the async write happens in the background. The display is `deriveClock(syntheticSession(localAnchor), …)` — reusing the tested derivation but fed from the local anchor, so auto-advance / capped slices / play-to-winner / paused-freeze all still hold. When an echo arrives it is **reconciled**, never blindly applied.

**The one genuinely hard call — two signatures.** The client can't predict the server's commit-ms, so:
- **Confirmation** of our own in-flight op uses a **coarse** sig (`clockStartIndex:state:status`) — the only thing predictable at click time. A coarse-matching echo is recognised as our own action and **absorbed without re-seeding** (this is what hides the round-trip and kills the jump).
- **External-event detection** uses a full **identity** sig (`…:startedAtMs:pausedAtMs:…`). It's stable across auto-advance (which writes nothing) but changes on every real event — including a re-anchor onto the *same* level — so a genuine change from another device re-seeds, while a no-op echo is ignored.

The screen's existing `busy` gate guarantees one in-flight op at a time, so a coarse match can't be ambiguous (no FIFO queue needed). A 6s pending-timeout backstop is **confirm-style (keeps the smooth local clock), never a rollback**, so a slow-but-successful write can't itself cause a jump. The only running-side re-seed-from-server besides a genuine external event is the **rollback on an op *rejection*** (a rare precondition failure, surfaced via a toast).

**Where the logic lives.** All gospel-critical, time-pure logic is in a new `src/lib/clock-sync.js` (signatures, synthetic session, seed, optimistic transitions, `reconcile`, and the `clockSyncReducer`), unit-tested without a React renderer (34 tests). `useClock` is thin glue (subscriptions, a 250ms tick gated on the local anchor, optimistic dispatch + rollback). `TournamentClock.jsx` is unchanged.

**Process note.** The design was hardened with a multi-agent **workflow** (map the bug + invariants + test setup → 3 adversarial reviewers red-teaming the proposed design against the gospel rule → synthesize an implementation spec + test matrix). It surfaced the coarse-vs-identity split and the timeout-must-not-snap guard *before* any code was written. Claude reviewed the synthesis too and corrected one wrong claim in it (a "skew-immune seed" that mathematically reduces to a 1:1 copy on the controlling device — true cross-device skew handling remains a Phase-5 TV concern).

**Verification.** `npm test` **434 pass** (+34 in `clock-sync.test.js`; the 44 existing clock tests in `clock.test.js` / `tournaments/clock.test.js` untouched and green), lint + build clean. Not browser-smoke-tested this round — the jump is a timing property the unit tests assert deterministically (monotonic-while-running, instant freeze, resume continuity with no latency snap, round-trip echo absorbed, external re-seed, rollback, session-switch reset), the render wiring is unchanged, and the live emulator/dev server were in use by the parallel multi-flight agent.

**Built in an isolated git worktree** off `main` (branch `fix/clock-smooth-pause-resume`) because a parallel agent was live in the main checkout on `feature/multi-flight-convergence` with uncommitted work; switching branches there would have disrupted it. The changed files are disjoint from the multi-flight work, so the merge is clean.

**Decider:** Guy set the gospel rule and approved the optimistic-local approach in the brief. The two-signature reconciliation, the confirm-style timeout, the pure-module split, and the worktree isolation were Claude's implementation calls (the first two flagged by the design workflow's red-team). Builds on the 30 May clock entry below.

## 31 May 2026 — Multi-flight is a general N→N→1 funnel (routing partition), not all-into-one

Generalized the session model so multi-flight tournaments can have **multiple flights at every stage** funnelling down to one final — e.g. WSOP-style Day 1A–D → Day 2ABC + Day 2DEF → Day 3 — not just "all Day-1 flights into one Day 2" (the prior limit).

**Routing model — fan-in funnel, no fan-out.** Each flight feeds **exactly one** flight in the next stage; a stage's flights **partition** the previous stage's flights (each upstream flight assigned to exactly one downstream — no orphan, split, or duplicate). This keeps the graph a clean in-tree with one final session, which is exactly what `convergesIntoSessionId` already models, so **NO schema change** was needed. (A single flight *splitting* across multiple downstream flights = fan-out would need a schema change; Guy confirmed the venue doesn't do that — survivors of a flight stay together.)

**Plan model.** The domain session plan went from a flat `{ days: [{ flightCount, endStructureIndex, … }] }` to `{ stages: [{ endStructureIndex, playToPercentRemaining, flights: [{ scheduledStartTime, survivorsFrom }] }] }`, where `survivorsFrom` holds indices into the previous stage's flights ([] for stage 0). `validateSessionPlan` enforces the partition + contiguous slice tiling + single final; `buildSessionDocs` wires `convergesIntoSessionId` from the partition (pre-generated UUIDs, one atomic batch — unchanged). Per-flight start times now (Day 1A and 1B can start at different times).

**UI — routing grid.** `SessionPlanBuilder` became a routing grid: stages of flights, each later flight with a "survivors from" chip-picker over the previous stage, live partition validation, and quick-start presets (single / multi-day / multi-flight). Chosen over pool-tags and a visual flow diagram (Guy picked the grid in the workshop; visual flow is a possible later polish).

**Verification:** `npm test` **409 pass** (`sessions.test.js` rewritten for stages incl. the deep funnel + partition rejections; `tournaments.test.js` create tests updated), lint + build clean. Not browser-smoke-tested by Claude this round — Guy's emulator + dev server were live (ports 8080/5173), so the change HMR'd into his running app for live verification.

**Decider:** Guy ("N Day 1s leading to N Day 2s and onward"). The partition representation (`survivorsFrom`) and the routing-grid UI were Claude's implementation calls from the workshop. Builds on the task-2.4 sessions model.

## 30 May 2026 — Late registration cutoff is a blind LEVEL, not a wall-clock time

Changed `Tournament.lateRegCutoffTime` (a `Timestamp`) to `lateRegCutoffLevel` (a nullable positive int = the blindNumber late reg runs through). Late registration now closes at the **end of a designated blind level**, not at a fixed clock time.

**Why:** a tournament can start late, pause, or run levels long/short, so a wall-clock cutoff is wrong in practice — the venue (and every poker room) defines late reg as "through the end of level N." Tying it to the structure level makes it correct regardless of real-world timing, and it's edit-stable (level 6 stays level 6 even if you retime levels).

**Shape:** `lateRegCutoffLevel: z.number().int().positive().nullable()`. null = no preset cutoff (a manager closes late reg manually via the task-2.7 status flow: lateRegOpen → lateRegClosed). A `superRefine` on `Tournament` bounds it — when set it must be ≤ the number of level entries in `structure` (blindNumbers run 1..N across levels; breaks are skipped).

**Surface:** both the create form (2.1) and the detail Details tab (2.2) now render a **level dropdown** ("Through Level N (sb/bb)", value = blindNumber) via a shared `lateRegLevelOptions(structure)` helper, replacing the datetime picker. `createTournament` / `updateTournament` drop the Date→Timestamp conversion for this field. Templates were unaffected (TemplateConfig never carried a late-reg field).

**Relationship to status (2.7):** this is the *planned* cutoff (display + future auto-close); the *actual* close is still the manual lateRegOpen → lateRegClosed transition. Auto-closing late reg when the clock passes the cutoff level is a natural Phase-3 enhancement, not built here.

**Verification:** `npm test` **400 pass** (+2 net: a passthrough test replaced the old Date-conversion test; added schema-invariant tests for in-range + out-of-range cutoff levels), lint + build clean. Not browser-smoke-tested by Claude this round — Guy had his emulator + dev server live (ports 8080 + 5173 in use for 2.8-walkthrough prep), so the change hot-reloaded into his running app for live verification.

**Decider:** Guy ("late reg cutoff shouldn't be a designated time but instead at the end of a designated level"). Storing the blindNumber (vs a structure array index) was Claude's implementation call — it matches the TD's mental model and survives structure edits.

## 30 May 2026 — Clock (task 2.6): server-authoritative + auto-advance; TD screen now, TV display (registered-displays model) deferred to Phase 5

Scoping calls for the upcoming **task 2.6 (live clock)**, made with Guy during requirements before any code. Recorded now (not after build) so the design survives — this session itself began by recovering a prior session that lost its context mid-task.

**1. The clock is SERVER-AUTHORITATIVE. No client ever computes "what time is it now".** Firestore holds the clock's true state; the TD's control screen *and* every venue TV simply **subscribe and render**. *Why:* it keeps every screen in perfect sync regardless of device clock drift, makes a TV a dumb browser pointed at a URL, and makes the eventual Phase-5 TV display a thin read-only subscriber over the exact data the engine already writes. Aligns with the Phase-2 starting note ("never trust client clock; use `Timestamp.now()` from the SDK").

**2. New level-timing fields are needed (a contained schema addition).** The `Tournament`/`Session` docs today carry `currentStructureIndex` (which level) and `pausedAt`, and each structure level/break carries `durationMinutes` — but there is **no field for when the current level started / when it ends**, so "time remaining" can't be computed reliably. Task 2.6 adds level-timing fields (a level **deadline** timestamp plus pause-accounting). *Implementation sub-call (Claude's, TBD at build):* model pause either as `levelEndsAt` + freeze-remaining-on-pause (resume shifts the deadline forward), or as `currentLevelStartedAt` + `accumulatedPauseMs`. The clock is **per-session** (a multi-day event runs its clock on the active session — see canonical-schema §5.1), so the timing fields most likely live on the session, denormalized onto the tournament as needed for the display.

**3. Levels AUTO-ADVANCE at zero.** When a level's timer expires the clock automatically rolls to the next level/break and restarts; the TD can still manually jump or rewind. *Why:* matches Casinoware's behaviour and keeps the TVs hands-off (no per-level TD action required).

**4. Scope of 2.6 = clock engine + TD control screen ONLY; the player-facing TV display is deferred to Phase 5.** The TD screen is the big cross-the-room clock with pause/resume/advance, gated to manager + TD (matches the write rules + the Phase-2 "clock visual design" note). The engine de-risks the hard part (server-authoritative timing, pause/resume, auto-advance, the per-session multi-day clock) first; the display then drops in as a subscriber with no rework.

**5. The Phase-5 TV display will use a REGISTERED-DISPLAYS + REMOTE-ASSIGNMENT model (decided now, built later).** Each TV opens a **permanent** URL like `/display/{displayId}` and never moves off it. A new `displays` collection maps each display to an `assignedTournamentId` (+ display mode); staff reassign which tournament a given TV shows from a floor-app control panel, and the TV switches live with nobody touching it. *Why:* the venue runs **several tournaments simultaneously in different parts of the room**, so "which clock is on which TV" must be reassignable remotely. This replaces Casinoware's current approach (remote PCs pushing a feed over HDMI to the TVs) with static URLs the system updates. Recorded here so 2.6's clock state is designed as a clean, self-contained subscription target — no display-routing assumptions baked into the engine. (Lands in Action-Plan tasks 5.1 / 5.3; a simultaneous-multi-flight nuance — two flights of one tournament in different rooms — can later assign a display to a *session* rather than just a tournament.)

**Decider:** Guy chose engine-first scope, the registered-displays model, and auto-advance, and described the venue's current HDMI setup + the multi-room requirement. The server-authoritative architecture and the specific timing-field/pause modelling are Claude's implementation calls, flagged above.

## 30 May 2026 — Payout editor (task 2.3): placeholder curve, transient percent-paid, $5/$10 rounding

Built the payout-structure editor on the tournament detail page's **Payouts tab** (was a read-only positions table). It replaces the winner-takes-all `DEFAULT_PAYOUT` placeholder from the 2.1 entry below with a real, editable structure — by **percentage** (shares of the eventual prize pool) or **fixed amount** per place, with a rounding rule, an auto-fill generator, and manual override of every row. Four implementation calls, all reversible:

**1. The auto-fill curve is a deliberate PLACEHOLDER, not the venue's real algorithm.** `payoutCurve(count)` in `src/lib/payouts.js` returns `count` fractions that sum to exactly 1, strictly descending, using simple **triangular rank weights** (N, N-1, …, 1); the last place absorbs the rounding remainder so the sum is exact with no float drift. *Why a stand-in:* the venue currently fills payouts from a **CSV that runs its own algorithm** over (number of entries, total prize pool, percent of field paid). Guy will supply that CSV/algorithm later ("I can provide that csv but not right now"), so the editor had to be usable end-to-end without blocking on it. The triangular curve is obviously simple so no one mistakes it for the finished math.

**2. Clean replacement seam for the CSV algorithm.** Everything generation-related lives in `src/lib/payouts.js` — pure, no Firestore/React, unit-tested (11 tests). When the CSV arrives, the only function to swap is `payoutCurve` (and possibly `paidPlaceCount`'s rule); `applyRounding` and the editor wiring stay. The editor calls `payoutCurve` in exactly one place. This is why the generation logic is a separate lib and not inlined in the component.

**3. "Percent of field paid" is a transient form input, NOT persisted.** The auto-fill panel takes a percent-paid value and derives the paid-place count as `round(entries × pct)`, floored at 1 (`paidPlaceCount`). That percent is a **generation parameter**, not part of the saved structure — the persisted `payoutStructure` is just `{ type, rounding, positions[] }`. *Why:* percent-paid is an input to *producing* a curve, not a property of the curve; re-deriving it from a saved structure is lossy and meaningless after manual overrides. It resets to blank on each load.

**4. `nearest5` / `nearest10` round to the nearest $5 / $10 — FLAG FOR GUY TO CONFIRM.** `applyRounding` treats these as whole-**dollar** steps (500 / 1000 cents), not 5/10 *cent* steps, because poker payouts are always handed out in round dollars. `'none'` rounds to the nearest whole cent. **This is an assumption about venue practice — Guy should confirm $5/$10 (vs, say, $25/$50/$100 steps for bigger events) when he supplies the CSV.** If the real steps differ, it's a one-line change per rule plus possibly more enum options.

**Also (no schema/domain change needed):** the save reuses the existing `updateTournament` RMW op with a new audit `actionType: 'tournament.payoutEdited'` (already in `WELL_KNOWN_ACTION_TYPES`); the `PayoutStructure` schema already supported both `byPercent` and `byPlace`. The **byPercent sum-to-100% check is a UI-level guard** in the form's `validate()` (rejects when |sum − 100%| > 0.5%), *not* a schema invariant — the schema deliberately omits it so intermediate editing states (a half-entered set of percentages) aren't structurally invalid mid-edit.

**Verification:** `npm test` **308 pass** (+11 in `payouts.test.js`: `paidPlaceCount` round/floor/zero/non-finite; `payoutCurve` sums-to-1 across n=1..50, strictly descending, triangular values, schema-valid `PayoutStructure` built from the curve; `applyRounding` $5/$10/cent). Lint + build clean. Browser smoke-test against the emulator (Mode 2): auto-fill produced the exact 50 / 33.33 / 16.67 curve (running total green at 100%); breaking it to 110% turned the total amber and **blocked the save** (Firestore confirmed the stored structure unchanged); a valid 100% save persisted 3 positions and survived a fresh reload (form re-seeds from the saved structure); role-gating confirmed — cashier + readonly get every input disabled, no Save bar, the "Read-only access" banner.

**Decider:** Guy specified the approach (percent-paid-driven auto-fill, CSV-replaceable, manual override of every row). The curve shape, the transient-input design, the UI-level sum guard, and the $5/$10 rounding interpretation were Claude's implementation calls — the rounding one is explicitly flagged above for Guy's confirmation. Builds on the [task 2.1 payout-placeholder entry](#29-may-2026--tournament-create-task-21-payout-placeholder--mysterybounty-pool-derivation) below.

## 29 May 2026 — Tournament add-ons are variable (configurable cost + chips)

Extended the tournament **add-on** model from a bare boolean to a configurable cost + chip grant. When a tournament (or tournament template) offers an add-on, staff now set **both** how much it costs **and** how many chips it grants.

**Schema change (both `Tournament` and `TournamentTemplate`):** `ReentryConfig` gains two nullable fields beside the existing `hasAddOn` boolean —

- `addOnCost: Money.nullable()` (integer cents, AUD; `Money` allows 0)
- `addOnChips: ChipCount.nullable()` (non-negative integer)

A `superRefine` enforces the cross-field invariant: when `hasAddOn === true` both must be non-null; when `false` both must be null. This mirrors the existing type-gated `maxReentries` / `maxRebuys` pattern, but adds **schema-level** enforcement (the older type-gating is only applied in the form builders — there's no `superRefine` behind it).

**Form behaviour (create form task 2.1 + template editor task 2.5, which share the `FormFields` primitives):** the Has-add-on toggle reveals an **Add-on cost** (`Money` input) and **Add-on chips** (`Num` input) directly beneath it; both clear to `null` when the toggle is off. Values are held as strings and converted at the save boundary (`dollarsToCents` / `intOf`).

**Two deliberate asymmetries:**

- **Cost may be 0** — a free add-on is valid (`Money` is `>= 0`). The venue occasionally runs a free chip-up.
- **Chips must be > 0** — enforced at the form `validate()` level ("An add-on must grant a positive number of chips"), not in the schema. The schema's `ChipCount` is `>= 0`; the form is the stricter gate because an add-on granting zero chips is a data-entry mistake, not a real configuration.

**Why a field, not a fixed convention:** the venue's add-on price and chip amount vary per tournament; hard-coding either (e.g. "add-on = one starting stack at the buy-in price") would be wrong for most events. Both values are also needed downstream for prize-pool and chips-in-play math.

**Verification:** `npm test` **283 pass** (+2 conformance tests in `tournaments.test.js`: a valid rebuy-with-add-on doc parses and carries the values; a `hasAddOn: true` with null cost/chips is rejected by the real `Tournament` schema). Lint + build clean. Both forms smoke-tested against the Firestore emulator (Mode 2): gating verified in both directions, and end-to-end persistence confirmed via REST read-back (create form addOnCost 7500 / addOnChips 25000; template editor 4000 / 15000 with the re-entry type preserved; seed `tt-retired` 5000 / 20000).

**Decider:** Guy (requested the feature: "Tournament add ons are variable, both the add on and the amount of chips should be adjustable"). The schema-enforcement design and the cost-may-be-0 / chips-must-be-positive split were Claude's implementation calls, flagged here for awareness.

## 29 May 2026 — Tournament config forms → 3-step wizard (reverses the single-page call)

The tournament **create form** (task 2.1) and the **tournament-template editor** (task 2.5) are now both 3-step wizards — **General Information / Structure / Re-entry & extras** — built on a shared presentational `src/components/FormWizard.jsx`. This **reverses decision #1 of the "Phase 2 UX design calls" entry below** (sectioned single page, not a wizard).

**Why the reversal:** Guy reviewed the rendered single-page form and found it too long to scan once a real blind structure was filled in — the structure editor's rows pushed the re-entry / bounty fields far below the fold. The original anti-wizard reasoning ("a wizard hides fields and adds clicks") is answered by the *navigation model* rather than by avoiding steps:

- **Free navigation, not gated.** Every step header is a clickable button; Back/Next are conveniences, not a forced sequence. No field is more than one click away.
- **Validate on submit, not per step.** The primary action (Create / Save changes) lives in a persistent right-aligned slot reachable from any step. It validates the *whole* form at once; on failure it flags every offending step with a red "!" in the stepper and jumps to the first one with a toast. The wizard never blocks you on a step or buries a validation error.

**Structure gets its own step** precisely because the long blind structure was what made the single page unscannable — isolating it keeps the other two steps short. The create form's three format toggles (multi-day / multi-flight / upper-deck) moved out of the old Schedule section into the Structure step, so both forms group "shape of the tournament" together.

**One shared component, both forms.** `FormWizard` is presentational — it owns no form state; the parent passes the rendered step content, the current index + `onStepChange`, the set of errored step keys, and an `actions` JSX slot (Create/Save/Cancel/Archive differ between the two forms). Guy's stated reason for converting *both* forms (not just the create form) was cross-form consistency, since they already share `StructureEditor` + the `FormFields` primitives.

**Unchanged:** every field, the `createTournament` / template-save logic, and the divergence logged below (create form derives mysteryBounty `totalPool`; template editor keeps its own unbalanced field). Pure UX refactor — `npm test` still **281 pass**, lint/build clean, and both forms verified against the emulator (create persisted a valid 7-level tournament; a template save round-tripped its name + bounty config).

**Decider:** Guy, 29 May 2026, after reviewing the built single-page form. Supersedes the layout half of the "Phase 2 UX design calls" decision; the other three calls in that entry (registration flow, clock, seat cards) stand.

## 29 May 2026 — Tournament create (task 2.1): payout placeholder + mysteryBounty pool derivation

Two implementation calls made while building the create form (`src/pages/td/TournamentNew.jsx` + `createTournament` in `src/lib/tournaments/tournaments.js`). Both are reversible and scoped to create-time defaults.

**1. `payoutStructure` defaults to a winner-takes-all placeholder, not a real editor.** When the create form passes `payoutStructure: null`, `createTournament` substitutes `DEFAULT_PAYOUT` — `{ type: 'byPercent', rounding: 'nearest5', positions: [{ place: 1, payout: 0, percent: 1 }] }`. *Why:* the `Tournament` schema requires a non-null `payoutStructure`, but the real payout editor is **task 2.3**. A single 100%-to-1st position is the minimal schema-valid structure and an honest default (the TD sets real payouts before the tournament finishes). *Trade-off:* a tournament created now and never touched by 2.3 would pay 100% to first — acceptable because no payout actually executes until the payouts screen exists, and 2.3 lands before any tournament is run for money.

**2. Mystery-bounty `totalPool` is derived as the sum of the entered bounty values, not a separate field.** The form collects a list of bounty values; on save it sets `bountyPoolConfig.totalPool = sum(bountyValues)`. *Why:* the `Tournament` schema's `BountyPoolConfig.superRefine` enforces `sum(bountyValues) === totalPool`. Exposing `totalPool` as its own input is a foot-gun (any mismatch is a validation error the manager can't easily diagnose). Deriving it makes the invariant impossible to violate from the UI. *Note:* this invariant lives on `Tournament` only, **not** on `TemplateConfig` — the template editor (2.5) doesn't derive it, so a template carrying bounty values is not required to balance until it's instantiated into a tournament here.

**Decider:** Claude (implementation calls during task 2.1). Flagged here for Guy's awareness; either can be revisited when the payout editor (2.3) and multi-format setup (2.4) are built.

## 29 May 2026 — Phase 2 UX design calls (form layout, registration flow, clock, seat cards)

Four design questions surfaced at the start of Phase 2 (flagged in HANDOFF's "Things to verify with Guy" block). Guy's answers, to be treated as binding for the relevant Phase 2 tasks:

**1. Tournament template / create form layout → sectioned single page** (not a multi-step wizard). **⚠️ SUPERSEDED 29 May 2026 — see the "3-step wizard" entry above; both forms were converted to a wizard after the filled-out single page proved too long to scan.** One scrolling page with labelled sections (Template details, Tournament basics, Format & structure, Re-entry, plus conditional Satellite / Mystery-bounty sections that appear based on `gameType`). *Why:* managers configuring a tournament want to see and tweak everything at once; a wizard hides fields and adds clicks. Applies to task 2.5 (template editor — already built this way) and task 2.1 (create form, which reuses the same section layout + the shared `StructureEditor`).

**2. Player registration flow → tournament-first, with a confirm step.** Cashier picks the tournament first, then registers a player into it (route `/td/tournaments/:id/register`), and the registration is explicitly confirmed before the wallet/entry write commits. *Why:* matches how the desk actually works at the venue (a player walks up naming the event); the confirm step guards against mis-registration since the buy-in moves money. Applies to task 2.6 / the desk registration flow.

**3. Live clock → big and readable across the room.** The TD's clock control screen (not just the Phase 5 venue display) must have giant blind text and large pause/resume + advance controls legible from across the floor. *Why:* the TD glances at it from a distance while managing tables; small desktop-dashboard text fails that. Applies to task 2.3.

**4. Seat-card fields → Player name, Table & seat number, Tournament name + start time, Starting stack.** These four are what print on each seat card. *Why:* the minimum a player needs to find their seat and a TD needs to verify placement; everything else is noise on a thermal-printed card. The data captured in task 2.6 must include all four; the Phase 5 print job renders them.

**Decider:** Guy, 29 May 2026, in the Phase 2 kickoff. Recorded so the create-form, registration, clock, and seating tasks don't re-litigate layout.

## 28 May 2026 — Adjustment direction is an explicit field, not inferred from notes text

**Decided:** `walletTransactions` documents of type `adjustment` carry a structured `direction: 'credit' | 'debit'` field. The free-text `notes` field still records human reason but is no longer load-bearing for arithmetic.

**Why:** Tier 1 testing surfaced a real bug in `reconciliation.js`. Both `getReconciliationTotals` and `verifyBalanceMatchesLedger` were inferring direction via `(tx.notes ?? '').includes('credit')`. A debit whose reason naturally mentioned the word "credit" (e.g., "over-credited yesterday", "wrongly credited") got mis-classified as a credit. End-of-day totals and per-player ledger sums would silently drift. The fix removes the free-text dependency entirely.

**Implementation:**
- Schema: `walletTransactions.direction` is `'credit' | 'debit' | null`; `superRefine` requires it set on `type === 'adjustment'` rows and rejects non-null values on every other type.
- Writer: `writeAdjustment` sets the field directly.
- Readers: `getReconciliationTotals` and `verifyBalanceMatchesLedger` switch on `tx.direction`.
- Tests: regression cases use adversarial notes ("debit — over-credited the bonus") to lock in correct behaviour.

**Decider:** Claude (caught during testing), confirmed by Guy via the spinoff task. No alternative considered; the substring-match heuristic was wrong and the fix is unambiguous.

## 28 May 2026 — Firestore rules access matrix (task 1.2)

**Decided:** `firestore.rules` enforces the following per-collection role gates and nothing else. Reads are uniformly any-signed-in-role except `auditLog` (manager-only). Writes follow operational ownership:

| Write access | Collections |
|---|---|
| manager + td | tournaments, sessions, tables, structureTemplates, tournamentTemplates |
| all staff (manager + td + cashier) | entries, bountyDraws, walletTransactions, tickets, auditLog |
| manager + cashier | players, withdrawalRequests |

Unauthenticated requests, signed-in users with no `role` claim, signed-in users with an unrecognized role, and any path outside the explicit allow-list all hit the default-deny.

**Why:**
- Per the 27 May "enforce at app, not rules" decision, the rules layer is a coarse role-gate. No invariant enforcement, no per-field gating, no sensitive-field rules (BSB / account were removed in v0.7).
- The matrix matches who actually does what on the floor: TDs configure & run tournaments, cashiers handle players & money, all staff register entries and confirm bounty win-credits. WalletTransactions allow all-staff write because TDs legitimately confirm satellite wins via `confirmWinCredit` (per the `actorRole` enum on the wallet ops).
- AuditLog read is manager-only because it captures every manager override + every wallet adjustment — sensitive in aggregate. Write is open to all staff because every wallet op emits an audit row via `writeAuditLogSafe`.

**Trade-offs accepted:**
- Rules don't enforce that walletTransactions go through the wallet module — a cashier with direct Firestore access could write a malformed row (the validators would catch obviously-malformed shapes, but bypass of `runValidatedTransaction` atomicity is structurally possible). Mitigation: app-only writes, audit log captures all actions, no published direct-write tooling.
- A compromised cashier account can read every player record and write to most operational collections. We're trusting the role assignment.

**Tested:** 174 emulator tests in `tests/firestore-rules/`. Matrix coverage is per-role × per-collection × read/write.

**Decider:** Claude (drafted from operational personas in CLAUDE.md + the role enum in `walletTransaction.js`). To be confirmed by Guy before deploy.

## 27 May 2026 — Enforce business invariants in the app/UI, not in Firestore rules (with two named exceptions)

**Decided:** Firestore security rules cover **role-based access only** (e.g., "must be signed in", "must have role X to write to this collection path"). Business invariants — ticket face-value rules, status-transition rules, etc. — are enforced at the **application / UI layer**, with manager UI override paths for legitimate exceptions. Every override writes a `manager.override` entry to `auditLog` with reason + context.

**Two named exceptions** that stay as hard, non-overridable invariants:

1. **Wallet balance ≥ 0.** Wallet going negative creates real venue liability (the venue would owe the player money it never received), not a service-level favour the manager can extend. Cashier must take a deposit or alternative payment first — no UI path to bypass.
2. **`walletTransactions.amount > 0`** (the always-positive sign convention). Structural, not a business rule — a negative amount would corrupt the ledger semantics, not just bend an operational policy.

All other defaults — ticket face-value rules, status transitions, etc. — get manager override paths.

**Why:** Per Guy (first pass): "Poker is a client based business. While it opens us up to some security concern we want Managers to have the final say on how things go. If a manager wants to allow a player to break up their ticket for instance as a favor to the player we don't need to prevent that. We want to enable it." Per Guy (second pass, same day): "a player balance CANNOT go below zero. that is not something even a manager could do as a favor."

**Trade-offs accepted:**

- Larger security surface for the overrideable invariants: a bug or a malicious actor with appropriate auth claims could write data that violates a default. Mitigation: validators reject obviously-malformed shapes (e.g., negative amount on a transaction); audit log captures every state-changing action; manager override is itself attributable.
- The wallet module + UI bear most invariant-enforcement weight. Rules are a thin role-gate layer only.
- Phase 1 task 1.2 scope narrows considerably — just role-based access, no invariant logic.

**Affected docs (all updated this session):**

- `docs/schema/canonical-schema.md` §6.2 — "Default invariants" table with two rows flagged as hard / no override.
- `docs/wallet-design.md` §6 and Q6 resolution — Q6 carries the full history of the position change.
- `docs/02_Action_Plan.md` task 1.2 scope narrowed.
- SOW v0.7 §3.4 — wallet ≥ 0 stays hard; other wallet rules relax.
- New auditLog actionType `manager.override` introduced.

**Decider:** Guy. Captured during the Phase 1 schema review.

## 27 May 2026 — Historical CSV import is deferred to pre-Rollout, sized as its own work block

**Decided:** The Casinoware CSV import (historical players, balances, tournaments) is **not part of Phase 1**. Sequencing is:

1. Phase 1 task 1.3 designs the canonical schema as the best shape for the new system — uninfluenced by legacy data.
2. Phase 2 builds tournament creation. The schema is proven by the new system actually using it.
3. **New work block before Rollout** — Guy provides Casinoware CSV exports; Guy + Claude collaborate on a Casinoware-to-canonical field mapping doc; Claude implements the import script and runs it. Each imported wallet balance becomes one `walletTransactions` row with `reference = "opening_balance"`. Historical tournaments and players land in the canonical collections.

**Why:** Designing the schema to accommodate legacy data inverts the priorities — we end up with a worse forward shape to ease a one-time import. Separating the two means the schema is clean and the import is a discrete, well-scoped adapter task once the target shape is stable and proven. Also lets Guy be hands-on with the mapping decisions, which he wants.

**Action Plan impact:** Phase 1 task 1.8a (existing-record import) is **removed from Phase 1**. New tasks **R1.0a (mapping doc)** and **R1.0b (script + run)** added at the head of the Rollout phase, before champion training (R1.2), so champions can train against real data.

**Decider:** Guy. Captured in the answer to HANDOFF question O4.

## 27 May 2026 — Drop legacy Firestore `tournaments` collection; reclaim the name for canonical schema

**Decided:** All 1,695 existing documents in the Firestore `tournaments` collection will be deleted. The canonical-schema tournament docs (Phase 1 task 1.3) will be written into the same `tournaments` collection name — no `tournaments_v2` discriminator.

**Why:** Guy's preference is naming clarity over preservation. The existing Firestore data is just a live-stream snapshot from Casinoware, not the source of truth (Casinoware itself is). Historical reference data, if needed, comes from Casinoware CSV exports. The audit dump (`scripts/firestore-audit/output/tournaments.dump.json`) also preserves all 1,695 docs locally as a third safety net.

**Trade-offs accepted:**
- Destructive: 1,695 documents deleted from Firestore. Recovery path = Casinoware CSV export + local audit dump.
- Analytics dashboard and Player App will see an empty `tournaments` collection until canonical schema is populated. Per the staging-skipped decision, this is acceptable — both apps are not in active use.

**Open sub-question (logged in HANDOFF):** whether historical tournaments are re-imported from Casinoware CSV into the new canonical schema, or whether the new collection starts fresh from cutover. Doesn't gate this decision; gates how much Phase 1 task 1.8a actually does.

**Decider:** Guy. Captured in the answer to HANDOFF question O1.

## 27 May 2026 — Preserve `dealerMinutes` on canonical tournament schema (as a tracking field)

**Decided:** The canonical `tournament` shape includes a `dealerMinutes` (or similarly-named) number field. Purpose: estimate dealer-time / table-utilisation for analytics and cost / workload tracking.

**Why:** It's a field the venue actually uses for analytics — not vestigial data. v1 captures it; how it's populated (manual entry, derived from clock + table count, or both) is a Phase 2 / Phase 4 UI decision and doesn't gate the schema.

**Decider:** Guy. Captured in the answer to HANDOFF question O2.

## 27 May 2026 — Enum field design (Claude proposes, Guy reviews)

**Decided:** For legacy enum-as-number fields (`status`, `published`), Claude reverse-engineers the values from the audit dump and proposes a canonical mapping (string enums, possibly splitting one legacy field into multiple canonical fields if that's cleaner). Guy reviews when the canonical schema doc lands in Phase 1 task 1.3.

**Decider:** Guy. Captured in the answer to HANDOFF question O3.

## 27 May 2026 — Skip separate staging Firebase project; build directly on shared `playlive-25a17`

**Decided:** Phase 0 task 0.4 (create a separate staging Firebase project) is **skipped**. The Floor App is built directly against the shared `playlive-25a17` from Phase 1 onwards. Phase 1 rules deploy proceeds without staging-project coordination.

**Why:** The analytics dashboard and Player App technically read from `playlive-25a17`, but **neither is in active use today** — they're blocked on the very Casinoware/tournament-data problems the Floor App is being built to solve. So the original concern (Phase 1 rules deploy breaks production users of the other two apps) doesn't currently apply. When the dashboard and Player App come back online they'll be reading the new canonical schema anyway (Phase 6 work), and the rules will be designed to cover their access patterns at that point. Saves the staging-project setup overhead and the cost of keeping two Firebase projects in sync.

**Trade-off accepted:** if the analytics dashboard or Player App needs to come back online mid-build for any reason, we need to make sure the in-progress rules / schema state of `playlive-25a17` doesn't break them. Flagging in HANDOFF as a coordination risk to watch.

**Decider:** Guy. SOW v0.6 will drop the "staging Firebase project" assumption from §5.4.

## 27 May 2026 — PayID is deposit-only, never a direct tournament-pay method

**Decided:** Tournament-pay accepts four methods (ticket, cash, EFTPOS, from wallet), not five. PayID is exclusively a wallet-deposit method.

**Why:** PayID transfers can exceed the tournament cost, and the venue must credit the full received amount to the player — not just the entry fee. A direct PayID-to-tournament-pay flow would either drop the overflow or require special-casing. PayID-to-wallet then pay-from-wallet records the full amount cleanly as two ledger rows.

**Decider:** Guy. Captured in `docs/wallet-design.md` Q1; SOW v0.5 §3.4 reflects this.

## 27 May 2026 — Wallet ledger uses always-positive amounts, type determines direction

**Decided:** `walletTransactions.amount` is always positive (cents, AUD). The `type` field (deposit, spend, win_credit, etc.) tells the math whether to add to or subtract from balance.

**Why:** Easier for humans reading the ledger view (no sign-flipping). Simpler validators (`amount > 0` everywhere). Easier reports (filter by type, sum amounts). Trade-off accepted: balance derivation needs a small mapping table from type to credit/debit, vs a one-line sum.

**Decider:** Guy. Captured in `docs/wallet-design.md` §4.

## 27 May 2026 — Wallet balance can never go negative; no manager override

**Decided:** A spend that would push `wallets/{playerId}.balance` below zero is rejected. There is no manager override path. Cashier must take a top-up via another method first.

**Why:** Hard invariant simplifies reasoning everywhere (especially during reconciliation). Removes a class of "we owe a player money we didn't realise" bugs. Enforced at module layer and at Firestore rules layer (defence in depth).

**Decider:** Guy. Captured in `docs/wallet-design.md` Q6 and §6.

## 27 May 2026 — Win credits require cashier confirmation (no auto-credit)

**Decided:** When a player finishes in the money, the calculated payout displays for the cashier; the `win_credit` ledger row is only written after explicit cashier confirmation. No auto-credit.

**Why:** Safer than auto. Floor situation around final payouts (deals, last-longer settlements, ticket vs cash decisions, manual corrections) is high-stakes enough that the human-in-the-loop step is worth it. Phase 4 task 4.7 builds the confirmation UI.

**Decider:** Guy. Captured in `docs/wallet-design.md` Q4.

## 27 May 2026 — Multi-day and multi-flight are distinct tournament structures

**Decided:** v1 distinguishes multi-day (single tournament across 2+ days, ~15% of field returns) from multi-flight (multi-day with multiple Day 1s converging to one Day 2). SOW v0.4 collapsed them; v0.5 separates them.

**Why:** They model differently. Multi-day has one player pool resuming; multi-flight has parallel pools converging with prize-pool accumulation. Conflating them would force a more complex single abstraction or quietly miss one of the two real flows.

**Decider:** Guy. Captured in `docs/casinoware-feature-inventory.md` Q2; SOW v0.5 §3.1.

## 27 May 2026 — Templates are two-level (structure templates + tournament templates)

**Decided:** Blind-structure templates are a standalone entity. Tournament templates may reference a structure template. The recurring-tournament generator instantiates from tournament templates.

**Why:** Reflects venue practice — staff want to reuse a blind structure across multiple different tournament configurations without re-entering it each time. Without separating the levels, every tournament template carries its own copy of the structure and edits don't propagate.

**Decider:** Guy. Captured in `docs/casinoware-feature-inventory.md` Q1; SOW v0.5 §3.1.

## 27 May 2026 — Upper Deck / Main Deck IS the last-longer side bet (one concept, not two)

**Decided:** Single tournament toggle. The Upper Deck / Main Deck split is the structural mechanism for the last-longer side bet — they're synonymous in venue terminology. SOW v0.4 listed them as two separate fields; v0.5 has one.

**Why:** They were never separate in practice. Keeping them as two fields would invite invalid combinations (Upper/Main split with last-longer off?) and confuse the create-tournament UI.

**Decider:** Guy. Captured in `docs/casinoware-feature-inventory.md` Q3; SOW v0.5 §3.1.

## 27 May 2026 — Stats screen on venue display moved from v1 to v1.5+

**Decided:** v1 venue display cycles between blind countdown and prize-pool screen. The stats screen (player counts, average stack, ITM line, top finishers, remaining bounty pool) is nice-to-have and moves to the v1.5+ backlog.

**Why:** Guy's call after walkthrough — not needed for parity with Casinoware, doesn't gate cutover. Trims Phase 5 scope.

**Decider:** Guy. Captured in `docs/casinoware-feature-inventory.md` Q6 and `docs/v1.5-plus-backlog.md`.

## 27 May 2026 — Satellite milestone payout is auto-removal at a chip multiple; chips leave the table

**Decided:** In a satellite, when a player's stack reaches a multiple of the starting stack equal to the ratio between the ticket reward and the buy-in, the player is automatically removed and issued a ticket. Worked example: $100 buy-in, $1000 ticket reward → 10× ratio → trigger at 10× starting stack. **The chips are removed from play entirely** when this happens — total chips on the tables decreases as seats are awarded.

**Why:** Captures the actual Casinoware behaviour as observed. The satellite naturally winds down because chips leave the table as players hit the threshold — no separate "satellite-end" condition to detect beyond either all-seats-awarded or no-players-left.

**Decider:** Guy. Captured in `docs/casinoware-feature-inventory.md` Q5.

## 27 May 2026 — Existing player records and wallet balances are imported from Casinoware export

**Decided:** Migration imports existing player profiles and any existing wallet balances from a Casinoware export. Each imported balance becomes one `walletTransactions` row of type `deposit` with `reference = "opening_balance"`. Exact field-to-field mapping is left for Phase 1 task 1.8a (deferred design — the export format isn't worth pinning down until the importer is being built).

**Why:** SOW v0.4 assumed the wallet started empty. Guy's walkthrough confirmed there's existing player data (and balances) to bring forward, and the source of truth is the Casinoware ecosystem (exportable).

**Decider:** Guy. Captured in SOW v0.5 §7 and `docs/wallet-design.md` Q7.

## 27 May 2026 — Online-only operation (no offline persistence in v1)

**Decided:** The Floor App requires reliable venue internet to operate. No Firestore offline persistence, no IndexedDB cache, no multi-device conflict resolution logic in v1.

**Why:** Discovery round 2 traded the offline capability away in exchange for ~2 weeks of build time. Simpler architecture, simpler wallet ledger reasoning, faster cutover. The venue accepts network reliability as a hardware/networking concern (redundant connection or 4G failover) rather than a software design problem.

**Decider:** Guy. Recorded in full as ADR-001.

## 27 May 2026 — JavaScript, not TypeScript

**Decided:** Floor App is plain JavaScript, matching the analytics dashboard. Runtime validators (Zod) cover the type-safety gap for money-handling code.

**Why:** Direct code sharing with the analytics dashboard, no build/setup overhead, smaller learning curve. The money-safety concern is mitigated by validators on every Firestore write plus an audit log on every transaction. TS migration is on the v1.5+ backlog if it becomes valuable later.

**Decider:** Guy (after trade-off discussion).

## 27 May 2026 — Wallet is record-keeping, not a payment processor

**Decided:** The Floor App records that deposits, spends, and withdrawals happened. It does not initiate or settle them. EFTPOS, PayID, cash, and bank transfers continue to flow through the venue's existing systems.

**Why:** Keeps the Floor App firmly out of the compliance critical path. Avoids EFTPOS terminal integration, bank API integration, and AUSTRAC-adjacent reporting obligations. The wallet ledger + audit log become inputs to the venue's existing compliance processes, not regulator-facing artefacts themselves.

**Decider:** Guy.

## 27 May 2026 — 12-week build phase + separate rollout phase

**Decided:** The 12-week window covers development only, ending with a feature-complete Floor App on staging. UAT, training, parallel run, and cutover happen in a separate Rollout phase scheduled around PlayLive's tournament calendar.

**Why:** Rollout pace depends on real-world tournament scheduling — you can't compress it. Treating it as part of the build window created false confidence in dates. Splitting them lets the build phase have a firm date while the rollout phase runs at the pace the venue can absorb.

**Decider:** Guy.

## 27 May 2026 — Same stack as analytics dashboard (React 19 + Vite + Tailwind + Firebase)

**Decided:** Floor App lives in a sibling repo to `playlive-analytics`, using the same stack and visual styling, sharing the same Firebase project (`playlive-25a17`).

**Why:** One codebase pattern to learn and maintain. Direct code reuse for utilities and visual styling. Single source of truth for tournament data with the new Floor App as the writer and the dashboard as a reader.

**Decider:** Guy.

## 27 May 2026 — ID scanning and packages deferred to v1.5+

**Decided:** Player ID scanning at registration, and the package builder + purchase flow, are not part of v1.

**Why:** Both are real-feature additions that the floor team wants, but neither is required to replace Casinoware. Including them would push the build by another 3-4 weeks. They go on the v1.5+ backlog and get their own SOW when their time comes.

**Decider:** Guy.
