# Floor-staff feedback backlog

> Captured **1 July 2026** from Guy's poke-around of the live app with the floor team (managers). These are v1 refinements to already-built features, not new scope. Work items below are **added on to** the standing flagged tasks (see the bottom section + `HANDOFF.md`).

## Defaulted assumptions (questions went unanswered — correct any of these)

- **Templates (B1):** treated as **blocked pending manager data** — I can't invent venue-canonical blind structures. Say the word and I'll instead draft best-guess AU-standard defaults now for managers to refine.
- **Seating items (A2 + B2):** the **quick wins** (button size, batch open) are split out as do-now tasks; the **seat-list flow rework** folds into the standing floor-staff seating UX walkthrough.
- **Tournament list sorting (A1):** all obvious columns clickable-sortable (name / buy-in / date / status / entries), **alphabetical (name) as the default** landing sort.

---

## A. Quick code wins — buildable now, no external input

- [ ] **A1 — Tournament list: clickable column sorting.** `/td/tournaments` (`src/pages/td/Tournaments.jsx`, `src/hooks/useTournaments.js`). Default sort **alphabetical by name**; click a column header to sort; **buy-in** sorts **high→low** on first click. Make name / buy-in / date / status / entries all sortable (per default assumption). Client-side sort over the already-fetched rows; keep CSV export honouring the active sort.
- [ ] **A2 — Open-table button prominence + batch open.** `/td/tables` (`src/pages/td/Tables.jsx`, `src/lib/tournaments/seating.js` `openTable`). Make **"+ Open table"** bigger/clearer (it's too small and subtle). Add **batch open** — open N tables in one action (count input or "open all needed"). Tables still start deactivated per the existing lifecycle. *(The deeper seat-flow rework is B2.)*
- [ ] **A3 — Deposit flow: alphabetical player dropdown.** `/desk/deposit` (`src/pages/desk/Deposit.jsx`). In addition to the search bar, show a **dropdown/list of the player base in alphabetical order** that filters down as you type (or scroll). **Reuse the `/desk/players` search flow pattern as-is** (Guy: "can copy the player search flow exactly").
- [ ] **A4 — Deposit player-picker: whole row clickable.** Same screen. Remove the awkward separate **"Select"** button — the **entire player asset (name + details) should be clickable** to pick them. (The list rows on `/desk/players` are already whole-row clickable from the reskin — mirror that here.)
- [ ] **A5 — Audit log filter search is buggy (incremental match).** `/admin/audit` (`src/pages/admin/AuditLog.jsx`, `src/hooks/useAuditLog.js`). Searching e.g. "player" in **Target type** shows nothing until the word is **fully typed** — should filter **incrementally (substring/prefix, case-insensitive)** as you type. Bug fix.
- [ ] **A6 — Audit log "all actions" dropdown: alphabetical order.** Same screen. The action-type dropdown is in **random order** — sort it **alphabetically** (sort `WELL_KNOWN_ACTION_TYPES` for display).

## B. Needs manager input / collaborative design

- [~] **B1 — Real default tournament templates.** Managers want a standard set: **Turbo, 20-min, 30-min, 40-min, Main Event.** ✅ **Blind structures received 1 July 2026** (Sixhundy Sunday sheet + Winter Championship cards). Extracted the **canonical PlayLive ladder** (one 32-level ladder shared across all events; BB-ante = big blind; breaks after L6/12/17/22/28) and built all 5 as **structure templates** in `scripts/seed/templates.js` on that ladder, differing only by level duration (turbo 15 / 20 / 30 / 40 / Main Event 40→60). Emulator reseeded + REST-verified. **Open refinements (awaiting Guy):** (a) turbo level length (built 15-min — confirm vs 20-min); (b) uniform vs escalating durations for 20/30/40 (built uniform; your real events escalate, e.g. Sixhundy 24→30); (c) whether to also build full **tournament** templates with real money fields (Opening $325/$75/30k, Main $1,300/$200/100k, Sixhundy $600/stack-TBC); (d) Main Event exactness (your print starts L1 at 200/400 with a doubled opening level + no L1 ante + denser breaks — built on the standard 100/200 ladder). **Dev-seed hygiene:** `seed:tournaments` also writes a `st-mainevent` (20-level showcase) → id collision; reseeding tournaments *after* templates would clobber the canonical one. Worth reconciling the two seeds into one canonical set.
- [ ] **B2 — Seat-list "find players" flow rework.** `/td/tables`. The seat list to find players is **odd/unintuitive**; rework the flow to managers' preferences. **Folds into the standing floor-staff seating UX walkthrough** (below) — this is the concrete symptom that walkthrough should fix, alongside the balancing player-selection rule + alternate ordering already flagged.

---

## C. Standing flagged tasks (carried — for reference, unchanged)

- **Floor-staff seating UX walkthrough** — the whole seating/balancing UI is functional-first and expected to change; now also owns **B2** above. See the `seating-ux-pending-floor-review` memory.
- **Reskin open dials** (now merged, still tunable): status-badge + money colours (semantic blue/green/amber vs fold-into-red), glass-blur intensity, how-much-red.
- **2.8** — Guy's Phase 2 create-and-run walkthrough sign-off (human gate).
- **3.12** — Guy's mock-tournament review with every payment method (human gate).
- **Payout curve algorithm** — swap the placeholder triangular curve in `src/lib/payouts.js` `payoutCurve` for the venue's real CSV-keyed algorithm when Guy supplies it.
- **Templates don't carry table size** — `maxSeatsPerTable` isn't in `TemplateConfig` yet (instantiating a template defaults to 9).
- **Phase-1 leftovers:** iPad on-device smoke test (1.10); deploy `firestore.indexes.json` to prod (now also needs the entries collection-group index); drop the legacy `tournaments` collection before any production write.
- **Phase 4 (next build phase)** — Payouts, Results & Withdrawals: bust-out (4.1, partly pre-built by the pulled-forward elimination), mystery-bounty draw (4.2), last-longer (4.3), payout calc (4.4), deal-making (4.5), ICM helper (4.6, stretch), win-credit-to-wallet (4.7), withdrawal queue (4.8), reconciliation (4.9), results page (4.10).

## Suggested order

1. **A5 + A6** (audit fixes — small, clear bugs) → **A1** (list sorting) → **A3 + A4** (deposit picker) → **A2** (open-table button + batch). All independent, all shippable without meetings.
2. **B1** — kick off the template data-gather in parallel (send managers a capture sheet).
3. **B2** — schedule the seating UX walkthrough with managers; it also settles the standing seating flags.
