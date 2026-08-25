# Floor-staff feedback backlog

> Captured **1 July 2026** from Guy's poke-around of the live app with the floor team (managers). These are v1 refinements to already-built features, not new scope. Work items below are **added on to** the standing flagged tasks (see the bottom section + `HANDOFF.md`).

## Defaulted assumptions (questions went unanswered — correct any of these)

- **Templates (B1):** treated as **blocked pending manager data** — I can't invent venue-canonical blind structures. Say the word and I'll instead draft best-guess AU-standard defaults now for managers to refine.
- **Seating items (A2 + B2):** the **quick wins** (button size, batch open) are split out as do-now tasks; the **seat-list flow rework** folds into the standing floor-staff seating UX walkthrough.
- **Tournament list sorting (A1):** all obvious columns clickable-sortable (name / buy-in / date / status / entries), **alphabetical (name) as the default** landing sort.

---

## A. Quick code wins — ✅ ALL DONE & live-verified 1 July 2026 (branch `feature/floor-feedback-quick-wins`)

- [x] **A1 — Tournament list: clickable column sorting.** `/td/tournaments` (`src/pages/td/Tournaments.jsx`, `src/hooks/useTournaments.js`). Default sort **alphabetical by name**; click a column header to sort; **buy-in** sorts **high→low** on first click. Make name / buy-in / date / status / entries all sortable (per default assumption). Client-side sort over the already-fetched rows; keep CSV export honouring the active sort.
- [x] **A2 — Open-table button prominence + batch open.** `/td/tables` (`src/pages/td/Tables.jsx`, `src/lib/tournaments/seating.js` `openTable`). Make **"+ Open table"** bigger/clearer (it's too small and subtle). Add **batch open** — open N tables in one action (count input or "open all needed"). Tables still start deactivated per the existing lifecycle. *(The deeper seat-flow rework is B2.)*
- [x] **A3 — Deposit flow: alphabetical player dropdown.** `/desk/deposit` (`src/pages/desk/Deposit.jsx`). In addition to the search bar, show a **dropdown/list of the player base in alphabetical order** that filters down as you type (or scroll). **Reuse the `/desk/players` search flow pattern as-is** (Guy: "can copy the player search flow exactly").
- [x] **A4 — Deposit player-picker: whole row clickable.** Same screen. Remove the awkward separate **"Select"** button — the **entire player asset (name + details) should be clickable** to pick them. (The list rows on `/desk/players` are already whole-row clickable from the reskin — mirror that here.)
- [x] **A5 — Audit log filter search is buggy (incremental match).** `/admin/audit` (`src/pages/admin/AuditLog.jsx`, `src/hooks/useAuditLog.js`). Searching e.g. "player" in **Target type** shows nothing until the word is **fully typed** — should filter **incrementally (substring/prefix, case-insensitive)** as you type. Bug fix.
- [x] **A6 — Audit log "all actions" dropdown: alphabetical order.** Same screen. The action-type dropdown is in **random order** — sort it **alphabetically** (sort `WELL_KNOWN_ACTION_TYPES` for display).

## B. Needs manager input / collaborative design

- [x] **B1 — Real default tournament templates.** Managers want a standard set: **Turbo, 20-min, 30-min, 40-min, Main Event.** ✅ **Blind structures received 1 July 2026** (Sixhundy Sunday sheet + Winter Championship cards). Extracted the **canonical PlayLive ladder** (one 32-level ladder shared across all events; BB-ante = big blind; breaks after L6/12/17/22/28) and built all 5 as **structure templates** in `scripts/seed/templates.js` on that ladder, differing only by level duration (turbo 15 / 20 / 30 / 40 / Main Event 40→60). Emulator reseeded + REST-verified. **Refinements done 2 July 2026** (branch `feature/b1-template-refinements`, live-verified — all render + validate on read, zero console errors): added the real venue events — **Sixhundy Sunday** structure (24→30, exact) + tournament template ($600); **Championship Opening** structure (30→40) + tournament template ($325/$75/30k); **Main Event** tournament template ($1,300/$200/100k) on the existing `st-mainevent` (40→60). **Kept** turbo 15-min + the generic 20/30/40 uniform — the real escalating events are now captured as their own templates. **Collision fixed** — the `seed:tournaments` showcase Main Event id renamed `st-mainevent`→`st-me-showcase`, so the canonical one is authoritative regardless of seed order. **⚑ Still needs manager numbers:** Sixhundy stack/hospo/guarantee are estimates; Opening/Main guarantees + house-consumption are 0 placeholders; and the Main Event's exact print (starts L1 200/400, doubled opening level, no L1 ante, denser breaks) + the multi-entry equity-payout rule ($10–12 per 1,000 chips on smaller bags) aren't modelled. Confirm turbo=15 + uniform-vs-escalate for the generics.
- [ ] **B2 — Seat-list "find players" flow rework.** `/td/tables`. The seat list to find players is **odd/unintuitive**; rework the flow to managers' preferences. **Folds into the standing floor-staff seating UX walkthrough** (below) — this is the concrete symptom that walkthrough should fix, alongside the balancing player-selection rule + alternate ordering already flagged.

---

## C. Standing flagged tasks — REFRESHED 10 Aug 2026 (stale entries closed out)

### Still open

- **Floor-staff seating UX walkthrough** — the whole seating/balancing UI is functional-first and expected to change; owns **B2** above plus the Tables-screen touch items from the iPad pass (`docs/reviews/2026-08-10-ipad-pass.md` M1/M2/M3/M10: disabled-button reasons in unrenderable tooltips, hover-only pip names, unpadded text-buttons, the "unseat · eliminate · milestone" word-button row). See the `seating-ux-pending-floor-review` memory.
- **Reskin open dials** (still tunable): status-badge + money colours (semantic vs fold-into-red), glass-blur intensity, how-much-red.
- **iPad on-device pass** — the CODE half is done (audit + blocker fixes, 10 Aug — see the report); the on-device half (Guy's iPad against staging, per the checklist at the end of the report) + older-iPad perf check remain.
- **Templates don't carry table size** — `maxSeatsPerTable` isn't in `TemplateConfig` yet (instantiating a template defaults to 9).
- **B1 manager numbers** (from above): Sixhundy stack/hospo/guarantee estimates; Opening/Main guarantees + house-consumption placeholders; the Main Event's exact print + multi-entry equity-payout rule unmodelled (NB equity refunds now have a field: `payoutConfig.equityRefunds` feeds the payout engine).
- **Bounty calculator sheet** (from the venue workbook) — possibly relevant; awaiting Guy's team's confirmation. Don't build until confirmed.
- **Payout engine open ends:** add-on SALES aren't a desk flow yet (`payoutConfig.addOnCount` is set by hand on the payouts screen); "Mix Max" handedness has no v1 tournament format; sheet future-changes get re-ingested when the venue updates it.

### Closed since this list was written

- ~~**2.8 / 3.12** (Guy's walkthrough + mock-tournament sign-offs)~~ → superseded by the **staging/stakeholder testing round** now running on the live URL (July–Aug 2026).
- ~~**Payout curve algorithm**~~ ✅ **DONE 10 Aug 2026** — the venue's real calculator (`Payout Calculator.xlsx`) was reverse-engineered into `src/lib/payoutEngine.js` (fixture-exact) with a run-once STORED `payoutTable` on the tournament + a settings panel on the payouts screen; series points toggleable. Spec: `docs/payouts/venue-payout-engine-spec.md`. The old placeholder `payoutCurve` remains only as the legacy fallback path.
- ~~**Phase 4**~~ ✅ **DONE 10 July 2026** (4.1–4.5, 4.7–4.10; ICM 4.6 parked to v1.5 triage) + the before-real-money hardening tier (16 July).
- ~~**Deploy firestore.indexes.json to prod**~~ ✅ **DONE 8–10 July 2026** (incl. the entries collection-group index + the CG rules fix).
- ~~**Drop the legacy `tournaments` collection**~~ ⚠️ **SUPERSEDED — DO NOT DROP.** The ~1,800 legacy Casinoware docs are almost certainly the analytics dashboard's data source (16 July discovery). The app can't see them (every tournaments query keeps the `orderBy(scheduledStartTime)` invariant). Relocating them is a Guy + analytics-project decision, parked.

---

## D. Stakeholder feedback round — Aug 2026 (capture here)

> Guy's stakeholders are testing on the live URL. As notes arrive, capture them below in the A/B format (quick win vs needs-design), triage against the still-open items above, and branch per the workflow (feature branch → Guy tests → merge).

### D1 — Guy's list, 24 Aug 2026 (14 items) — 10 BUILT on `feature/floor-feedback-aug`, 4 parked

Verbatim items are quoted; the note under each is Claude's read against the current code.

**Structure editor (`src/components/StructureEditor.jsx`) — 5 items, one cluster**

- [x] **D1.2 — "When typing in levels - enter key to go to next line = easier to type."**
      Quick win. `NumField` has no key handling; add Enter → focus the same field on the next row, and Enter on the last row appends a level (which already carries the previous level's values forward). Shift+Enter goes back up.
- [x] **D1.3 — "Set end of Rego on level page by right click for end of rego & End of day (different colour lines to represent each)."**
      Medium. Two existing concepts, surfaced inline on the structure rows instead of in separate forms: **end of rego** = `tournament.lateRegCutoffLevel` (schema `tournament.js:213`, already validated against the structure length); **end of day** = the session slice boundary `maximumEndIndex` (`SessionPlanBuilder.jsx`). Right-click → context menu on a row, plus a coloured rule drawn under it (two distinct colours). **iPad needs long-press as the equivalent gesture** — right-click alone strands the touch persona.
- [x] **D1.4 — "Smart key button to double blinds + copy 'Ante' over."**
      Quick win. Per-row (or on `+ Level`) action: next level = previous SB/BB × 2, ante carried forward unchanged. *Assumption: literal doubling, not a venue-ladder step.*
- [x] **D1.5 — "Ability to change minutes in bulk."**
      Quick win. "Set all levels to N minutes" + ideally a range ("levels 1–12"). Breaks keep their own durations unless explicitly included.
- [x] **D1.6 — "Drag drop feature on break levels when building."**
      Medium. Replaces/supplements the ▲▼ `RowActions` buttons with drag-to-reorder. Must work with touch drag on iPad, and `renumber()` still runs on drop so `blindNumber` stays sequential.

**Registration / re-entry — 2 items**

- [x] **D1.7 — "Re-entry end of level 'x'."**
      **✅ Answered 24 Aug (Guy):** they *can* differ, and the rule is asymmetric — *"if a player has already entered, they can re-enter, but if they haven't, late reg is closed to them."* So late-reg close stops **new** players; already-entered players keep re-entering until their own later cutoff. Needs `reentryCutoffLevel` on the tournament **and** an entry-type-aware registration gate (today `registrationOpen()` is a single status check for both).
- [ ] **D1.8 — "Re-buy feature? Amount of rebuys?"**
      **⚑ Real gap, needs a decision.** Today `reentryConfig.type: 'rebuy'` + `maxRebuys` exist and are enforced, but `planEntry` (`src/lib/tournaments/registration.js:78`) models a rebuy as *a new entry after busting* — i.e. functionally a re-entry with its own cap. A classic **top-up rebuy** (a still-seated short stack buys chips during the rebuy period, no new entry) is **not built**: no desk flow, no chip-add, no prize-pool line. Same shape as the already-flagged add-on gap (`payoutConfig.addOnCount` is still typed in by hand on the payouts screen). Scoping this is a conversation, not a quick win.

**Payouts (`PayoutEditor` in `src/pages/td/TournamentDetail.jsx:1034`) — 2 items**

- [x] **D1.11 — "Prizepool placement to be at the bottom when entering prize pool to assure 100% accuracy."**
      There is already a `tfoot` Total row (percent sum vs 100%, and distributed cash) plus a summary line beneath. Read: make it **stick to the bottom of the viewport while scrolling a long place list**, so the running total is always visible while typing. *Assumption — confirm.*
- [x] **D1.12 — "When going to 'fixed amount' have % value inputted with the ability to amend $ amount."**
      Quick win, clearly specified. `setType()` currently seeds percentages when switching *into* byPercent but leaves `payoutStr` blank when switching to byPlace. Switching to **Fixed amount** should pre-fill each row's dollars from `percent × prize pool` (through the rounding rule), then let the TD edit dollars freely.

**Tables — 1 item**

- [x] **D1.13 — "Tables -> ability to select specific table numbers."**
      Small/medium. `openTable` (`src/lib/tournaments/seating.js`) reads the current max `tableNumber` and writes max+1. Add an explicit-number path with a uniqueness check within the session (`tableNumber` is unique per `sessionId`, not per tournament). Batch open (A2) keeps auto-numbering.

**Needs clarification before any code — 3 items**

- [ ] **D1.1 — "Milestone feature -> leads to qualified winner on Ipad?"**
      **⏸ PARKED 24 Aug (Guy):** *"maybe it was just unclear where this was done — I think in the past it needed to be done at the desk. Let me ask what they mean, for now ignore it."* Likely a Casinoware-habit mismatch: the venue expects this at the **desk**, the app puts it on the **TD tables** screen. Re-triage when the floor clarifies. Original note: the milestone flow is built (`src/lib/tournaments/satellite.js`, TD action on `/td/tables`): it seats-out the player, sets `ticketWinnings`, and leaves `finishingPlace` null. What it does *not* have is a visible **qualified-winners roster** — the only surface today is a count next to the "out" number. Three possible readings: (a) add that roster screen, (b) the flow is awkward/unreachable on the iPad, (c) qualified winners should appear in the **Player App** (Flutter) for the player. Which?
- [ ] **D1.9 — "Have players account as a different registry? (Can track transfers/refunds are operating as required back into accounts.)"**
      **⏸ PARKED 24 Aug (Guy):** *"I'll ask for specifics on this one, honestly not sure."* Original note: wallet + `walletTransactions` ledger already exist, with per-player history on `/desk/players/:id`. Read: a **separate reconciliation view for tournament-side money movement** (entry payments, voids, refunds, win credits) split out from desk deposits/withdrawals — i.e. prove refunds actually landed back in accounts. `/admin/reconciliation` may already be close. Confirm what "different registry" means.
- [x] **D1.10 — "Tournament screen to show: how much long registration is opened for (minutes count down) / Which Level they are currently playing at."**
      **✅ Answered 24 Aug (Guy): the TD tournament detail page** (`/td/tournaments/:id`) — add a late-reg minutes countdown + the current level to its header. Original note: the **venue display** (`/display`, `src/pages/Display.jsx`) already shows both: a "Late reg — closes in N" countdown row (`Display.jsx:409`) and the current level on the clock face plus the `LevelTrack` strip. So either the feedback predates that screen being seen, or it means a *different* screen — the TD clock, the tournament detail header, or the tournament list. Needs pointing at.

**Process, not code**

- [ ] **D1.14 — "Does this need to be texted [tested?] my Mixed game academy for the mixed game parts?"**
      Guy's call, not a build item. The `mixed` / `horse` / `stud` game types exist in the schema and `bringIn` is on every level entry, but no mixed-game *rotation* logic is built (a HORSE game-change-per-level engine is not in v1 scope). If Mixed Game Academy is going to review, worth confirming what they'd be reviewing against.

**Suggested build order** (quick wins first, all in one branch off `feature/player-accounts` or a fresh one):
**BUILDING NOW** — branch `feature/floor-feedback-aug`, 24 Aug 2026:
D1.2, D1.3, D1.4, D1.5, D1.6, D1.7, D1.10, D1.11, D1.12, D1.13.

**Parked pending floor clarification:** D1.1, D1.9.
**Parked pending a scoping conversation:** D1.8 (top-up rebuys).
**Guy's call, not code:** D1.14.


## Suggested order (historical — the A items all shipped 1 July)

1. ~~**A5 + A6** → **A1** → **A3 + A4** → **A2**~~ ✅ all done.
2. **B1** — manager numbers still outstanding (capture sheet).
3. **B2** — schedule the seating UX walkthrough with managers; it also settles the standing seating flags + the iPad-pass Tables items.
