# Decisions log

A running log of architecture and product decisions made on this project, with reasoning. Add to it whenever a non-trivial call is made. Significant decisions also get a full ADR in `docs/adr/`.

Format: newest first. Date, decision, reasoning, who decided.

---

## 29 May 2026 — Tournament create (task 2.1): payout placeholder + mysteryBounty pool derivation

Two implementation calls made while building the create form (`src/pages/td/TournamentNew.jsx` + `createTournament` in `src/lib/tournaments/tournaments.js`). Both are reversible and scoped to create-time defaults.

**1. `payoutStructure` defaults to a winner-takes-all placeholder, not a real editor.** When the create form passes `payoutStructure: null`, `createTournament` substitutes `DEFAULT_PAYOUT` — `{ type: 'byPercent', rounding: 'nearest5', positions: [{ place: 1, payout: 0, percent: 1 }] }`. *Why:* the `Tournament` schema requires a non-null `payoutStructure`, but the real payout editor is **task 2.3**. A single 100%-to-1st position is the minimal schema-valid structure and an honest default (the TD sets real payouts before the tournament finishes). *Trade-off:* a tournament created now and never touched by 2.3 would pay 100% to first — acceptable because no payout actually executes until the payouts screen exists, and 2.3 lands before any tournament is run for money.

**2. Mystery-bounty `totalPool` is derived as the sum of the entered bounty values, not a separate field.** The form collects a list of bounty values; on save it sets `bountyPoolConfig.totalPool = sum(bountyValues)`. *Why:* the `Tournament` schema's `BountyPoolConfig.superRefine` enforces `sum(bountyValues) === totalPool`. Exposing `totalPool` as its own input is a foot-gun (any mismatch is a validation error the manager can't easily diagnose). Deriving it makes the invariant impossible to violate from the UI. *Note:* this invariant lives on `Tournament` only, **not** on `TemplateConfig` — the template editor (2.5) doesn't derive it, so a template carrying bounty values is not required to balance until it's instantiated into a tournament here.

**Decider:** Claude (implementation calls during task 2.1). Flagged here for Guy's awareness; either can be revisited when the payout editor (2.3) and multi-format setup (2.4) are built.

## 29 May 2026 — Phase 2 UX design calls (form layout, registration flow, clock, seat cards)

Four design questions surfaced at the start of Phase 2 (flagged in HANDOFF's "Things to verify with Guy" block). Guy's answers, to be treated as binding for the relevant Phase 2 tasks:

**1. Tournament template / create form layout → sectioned single page** (not a multi-step wizard). One scrolling page with labelled sections (Template details, Tournament basics, Format & structure, Re-entry, plus conditional Satellite / Mystery-bounty sections that appear based on `gameType`). *Why:* managers configuring a tournament want to see and tweak everything at once; a wizard hides fields and adds clicks. Applies to task 2.5 (template editor — already built this way) and task 2.1 (create form, which reuses the same section layout + the shared `StructureEditor`).

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
