# Scope of Work — PlayLive Floor App

**Version:** v0.6 (Revised after Phase 0 Firestore audit + migration sequencing decision)
**Date:** 27 May 2026
**Owner:** Guy Greenstein  |  **Build partner:** Claude (AI collaborator)
**Build window:** 12 weeks of development; rollout (UAT, training, cutover) scheduled separately on top.

> Markdown mirror of `01_Scope_of_Work.docx` for Claude Code. The .docx is the version shared with the team; this is the version the AI collaborator reads. **v0.6 has not been mirrored back to the .docx yet — when Guy next refreshes the team-facing version, the .docx needs to pick up the changelogs and §7 edits below.**

---

## Changelog (v0.5 → v0.6)

Came out of the Phase 0 Firestore audit and the migration-sequencing decision that followed. Detail in `DECISIONS.md` and `docs/schema/firestore-audit.md`; this changelog is the summary.

- **§7 Data Migration rewritten.** Migration is no longer a Phase 1 task. Sequencing: (1) Phase 1 designs the canonical schema for the new system's best case, uninfluenced by legacy data; (2) Phase 2 builds tournament creation, proving the schema; (3) a new Rollout-phase work block (R1.0a + R1.0b in the Action Plan) does field mapping from Casinoware CSVs to the canonical schema and runs the import. The legacy Firestore `tournaments` collection's 1,695 documents are **dropped** to reclaim the name for the canonical schema; the audit dump + Casinoware itself are the backup paths.
- **§5.4 updated:** staging Firebase project (originally Phase 0 task 0.4) **skipped** — building directly on shared `playlive-25a17`. Rationale: analytics dashboard and Player App are not in active use today.
- **No scope additions or feature changes.** v0.6 is sequencing and infrastructure clarity only.

## Changelog (v0.4 → v0.5)

Came out of the Phase 0 Casinoware walkthrough and registration-desk shadowing. Source-of-truth answers live in `docs/casinoware-feature-inventory.md` and `docs/wallet-design.md`; this changelog is the summary.

- **Corrected (§3.4):** Tournament-pay methods are **four**, not five. PayID is **deposit-only** (never a direct tournament-pay method). Players who want to pay by PayID first deposit to wallet via the PayID wizard, then pay from wallet. Driver: PayID transfers can exceed the tournament cost and the venue must credit the full amount.
- **Clarified (§3.1):** **Multi-day** and **multi-flight** are distinct tournament structures, not the same concept. Multi-day = single tournament across 2+ days (play down to ~15%, resume). Multi-flight = multi-day with multiple Day 1s converging to one Day 2.
- **Clarified (§3.1):** Templates are **two-level**. Structure templates (blind structure only) are a standalone entity that can be referenced by tournament templates.
- **Clarified (§3.1):** "Upper Deck / Main Deck split" **is** the last-longer side bet — they're the same concept. v1 has one toggle, not two.
- **Simplified (§3.1):** Removed `trophyPrice` as a standalone field. Trophy cost is folded into the existing house consumption field.
- **Demoted (§3.1 / §4):** Stats screen on the venue display moves from v1 to v1.5+. v1 display cycles between blind countdown and prize-pool screen.
- **Added (§3.1):** Satellite milestone mechanic — players are auto-removed and issued a ticket when their stack reaches a multiple of the starting stack equal to the ticket-reward-to-buy-in ratio.
- **Added (§3.4 / §5.7):** Wallet design decisions baked in: always-positive `amount` with type-determined direction; cashier confirms each `win_credit` (no auto-credit); tickets are tournament-entry only in v1; **wallet balance can never go negative, no manager override**.
- **Added (§7):** Migration imports existing player records including any existing wallet balances. Source-of-truth for balances TBD (Casinoware export, separate spreadsheet, or other — flagged in HANDOFF as a remaining-to-clarify).

## Changelog (v0.3 → v0.4)

- **Added:** Player wallet with deposit recording (cash / EFTPOS / PayID), spend from balance at registration, withdrawal-request workflow, transaction ledger.
- **Added:** Tickets as generic credit usable on tournaments of equal-or-greater value.
- **Added:** Enhanced player profile (mandatory phone, optional email/street address, sensitive-tier BSB / account number).
- **Added:** Tournament-creation fields (short description, hospitality, trophy, house consumption, last-longer, Upper Deck / Main Deck, auto-generated payout structure, weekly recurring generator). Alternates ticket printing with queue number.
- **Removed:** Offline tolerance and multi-device conflict resolution. Floor App is now online-only (see ADR-001). Simpler architecture, no IndexedDB cache, no conflict-resolution policy.
- **Restructured:** 12 weeks is the build window only. UAT, training, parallel run, and cutover happen in a separate Rollout phase after the build is feature-complete on staging.
- **Deferred to v1.5+:** ID scanning at registration; Packages (package builder + purchase).

## 1. Background

PlayLive Melbourne is a poker venue currently running its tournament operations on Casinoware, a third-party tournament management system. Casinoware carries an ongoing monthly licensing cost, has limited extensibility, and produces inconsistent data exports — which has been a recurring blocker for the other PlayLive software projects already underway.

This Scope of Work covers the design and build of a purpose-built replacement: a custom Floor App, owned by PlayLive, that floor staff use to run tournaments live in the venue. It handles tournament setup, the live tournament clock and venue TV display, player registration and seating, table balancing, payouts, and (new in v0.4) a player wallet that records deposits, spends, and withdrawal requests against a player's running balance. It writes directly to the same Firestore database (Firebase project `playlive-25a17`) that the other two PlayLive apps already use.

### 1.1 Where this fits in the wider PlayLive software stack

| Application | Audience | Stack | Status |
|---|---|---|---|
| **Floor App (this SOW)** | Floor staff: TDs, dealers, cashier | React + Vite + Tailwind + Firebase (JS) | Not started |
| Player App (separate SOW) | Players: discovery, registration, wallet self-service | Flutter (mobile-first) | ~40% built |
| Analytics Dashboard | Owners / management: reporting | React + Vite + Tailwind + Firebase | ~70-80% built |

The Floor App is the operational source of truth — it writes the data the other two read.

## 2. Objectives

- Eliminate the recurring monthly Casinoware licensing cost.
- Remove Casinoware as a blocker for the analytics dashboard and player app by writing clean, well-structured tournament and wallet data directly into Firestore.
- Give PlayLive full control over its own tournament + wallet software so future projects build on a stable, owned foundation.
- Match Casinoware on day-to-day operational tasks without forcing changes to how tournaments are run.
- Add a player wallet that captures deposits, spends, and withdrawals as a clean ledger — replacing whatever informal tracking happens today.

## 3. In-Scope (v1)

### 3.1 Tournament Setup, Clock & Display

- Define tournaments. Fields: name, short description, type, buy-in, fee, guarantee, start time, late-reg cutoff, hospitality cost, **house consumption budget (includes trophy cost when relevant — single field)**, **Upper Deck / Main Deck split toggle (this is the last-longer side bet — same concept in venue terminology)**, add-on toggle, bounty toggle, freezeout or re-entry with configurable counts.
- Supported formats: NLH (freezeout / re-entry), PLO and other variants (Omaha, mixed games, HORSE, Stud), satellites with **milestone auto-removal** (player removed and issued a ticket when their stack reaches a multiple of the starting stack equal to the ticket-reward/buy-in ratio — e.g. $100 buy-in with $1000 ticket reward triggers at 10× starting stack), **multi-day events** (single tournament resuming on a later day after playing down to ~15% of the field), **multi-flight events** (multi-day with multiple Day 1s converging to one Day 2 with prize-pool accumulation), Mystery Bounty (published bounty pool drawn at random on each knockout), Main Event.
- Blind structure builder: levels, blinds, antes, duration, breaks; copy-from-structure-template; validation.
- Payout structure: by position or by percentage, with rounding. Auto-generated default from entries + buy-in, manually overridable. Bounty events have a separate bounty-pool definition.
- **Templates — two levels.** _Structure templates_: standalone blind structures, reusable across tournament templates. _Tournament templates_: full tournament configuration, may reference a structure template. Weekly recurring generator instantiates from tournament templates.
- Live tournament clock with sound alerts.
- Venue display mode: full-screen cycling between blind countdown and prize-pool screen. _(Stats screen deferred to v1.5+.)_
- Floor controls: pause/resume, jump to next level, extend break, on-the-fly edits with audit log.

### 3.2 Player Registration, Seating & Table Balancing

- Player profile fields. **Mandatory:** full name, phone number. **Optional:** email, street address. **Sensitive (Cashier + Manager role only, audit-logged on read):** BSB, account number. **Derived/display:** total deposited, current wallet balance, ticket balance.
- New player registration: quick-create form covering the mandatory fields.
- Fast fuzzy-name player search.
- Duplicate-merge tooling.
- Tournament registration with payment method selection (cash, EFTPOS, from wallet, ticket — **four methods, PayID is deposit-only and not a direct tournament-pay method**).
- Multi-method payment recording. Floor App captures method + amount + reference; actual payment processing happens through existing venue systems. Ticket payments enforce equal-or-greater rule.
- Re-entry, add-on, late registration. Running entry count and prize pool update live.
- Seat assignment: random draw, manual override, printable seat list to operator-PC printer.
- Live table balancing (9-handed, ±1 player).
- Table breaking workflow.
- Waitlist / alternates with printable alternate ticket showing queue number.

### 3.3 Payouts & Results Recording

- Bust-out recording with timestamp.
- Mystery Bounty draw on each knockout, updating remaining-bounty display.
- Last-longer settlement (the Upper Deck / Main Deck side bet from §3.1).
- Prize pool calculated from entries minus juice/rake with overlay for guaranteed tournaments.
- Payout structure applied.
- Deal-making **(must-have):** free-form manual entry of negotiated payouts, with confirmation and full audit trail.
- ICM calculator **(stretch / nice-to-have):** in-app helper used as reference. Always advisory.
- Winnings credited to player's wallet as a `win_credit` ledger entry **on cashier confirmation** (no auto-credit — see `docs/wallet-design.md` Q4).
- Post-tournament results page.

### 3.4 Player Wallet & Payment Recording  (updated in v0.5)

The wallet is a record-keeping front-end. The Floor App tracks per-player balance as a liability the venue owes back. Actual money lives in PlayLive's bank account / EFTPOS settlement / cash till — moved by existing venue processes, not by the Floor App. Full design lives in `docs/wallet-design.md`; this section is the SOW summary.

- **Deposit methods (three):** cash, EFTPOS, PayID. Each captures method + amount + reference + actor + timestamp. App does not initiate or settle the payment.
- **PayID deposit wizard at registration screen:** guides staff through giving the player venue PayID details and confirming receipt. PayID is **always** a deposit-to-wallet step — never a direct tournament-pay method, because PayID amounts can exceed tournament cost and the venue must credit the full amount received.
- **Tournament-pay methods (four):** ticket, cash, EFTPOS, from wallet. PayID-funded entries go via deposit → pay-from-wallet, recorded as two ledger rows.
- **Spends from wallet:** at registration, "From my account" debits the wallet atomically with the entry record.
- **Tickets:** per-player balance of generic credit, **tournament-entry only in v1**. Each ticket has a face value and may only be used on tournaments whose total cost ≥ ticket face value. Top-up with another method supported for the gap.
- **Withdrawal requests:** player asks for balance back. App records the request, desired payout method (cash, EFTPOS refund, bank transfer to stored BSB/account — all three used daily), amount. Two-step pattern: any Cashier creates, only a Manager marks completed (which debits the wallet).
- **Win credits:** at payout, the cashier confirms each `win_credit` before it lands on the player's wallet. No auto-credit.
- **Hard rule — wallet balance can never go negative.** Any spend that would push balance < 0 is rejected at the module layer and at the Firestore rules layer. No manager override path; cashier takes a top-up via another method first.
- **Ledger sign convention:** `amount` is always positive; `type` determines credit-vs-debit. Easier to read; safer to validate.
- **Transaction ledger per player:** full immutable history. Corrections happen by appending a compensating `adjustment` entry, not by editing past rows.
- **Wallet reconciliation view:** end-of-day staff view showing total venue float vs total wallet liabilities by payment method.

### 3.5 Cross-Cutting

- Auth: Firebase Auth with email/password for staff.
- Role-based access with two primary personas. **TD persona:** clock, balancing, deal-making, payouts. **Registration Desk persona:** player search, registration, wallet deposits, withdrawals queue. Four roles (Manager / TD / Cashier / Read-only) enforced at the Firestore rules layer.
- Device targets: venue PC (mouse + keyboard, attached printer) **and** iPad (touch-first). Venue display targets a full-screen browser on a TV.
- **Online-only operation.** Requires reliable venue internet. See §5.2 — offline tolerance removed from v1 in favour of simpler architecture.
- Audit log: every staff action timestamped and attributable to a user. Sensitive-field reads also logged.

## 4. Out-of-Scope (v1)

- Cash game and cash-table waitlist management. (v2 candidate.)
- Player-facing features — those live in the separate Player App. The Player App may add a self-serve wallet view and PayID deposit flow as a v1.x feature, reading the same wallet data the Floor App writes.
- ID scanning at registration. **v1.5 candidate.**
- Packages (package builder + purchase flow). **v1.5 candidate.**
- Stats screen on the venue display (player counts, average stack, ITM line, top finishers, remaining bounty pool). **v1.5 candidate** — moved from v1 in v0.5. Display cycles between blind countdown and prize-pool screen only in v1.
- Direct payment-processor / EFTPOS / PayID API integration. Floor App records; venue's existing systems process.
- Direct bank-transfer initiation from Floor App for withdrawals. Floor App records the request; venue staff process externally.
- Loyalty / rewards program logic.
- Multi-venue support (designed-for in data model, not built out in v1).
- Gaming compliance / regulatory reporting beyond the audit log. Audit log + wallet ledger feed separate compliance processes; Floor App does not produce regulator-facing artefacts itself.
- Backfill / clean-up of historical Casinoware data beyond what's already in Firestore.
- Hardware procurement.

## 5. Technical Architecture

### 5.1 Stack alignment

Same stack as the analytics dashboard. Sibling repos, shared UI patterns, same Firebase project (`playlive-25a17`).

- React 19 + Vite + Tailwind CSS, JavaScript.
- React Router for navigation.
- Firebase Firestore (online mode) with real-time listeners where appropriate.
- Firebase Auth for staff login.
- Firebase Hosting for deployment alongside the analytics dashboard.

### 5.2 Always-online operation  (replaces v0.3 offline-tolerance section)

v0.4 removes offline tolerance from v1 scope. The Floor App requires reliable venue internet to operate. Rationale:

- Removing offline persistence + multi-device conflict resolution shrinks v1 by ~2 weeks.
- The wallet ledger is materially easier to reason about with a single authoritative store.
- Venue internet is a network/hardware concern that can be hardened independently (redundant connection, 4G failover, etc.).
- If a future Floor App version needs offline support, it can be added without changing the data model — Firestore offline persistence is opt-in per-client.

**Implication:** During an internet outage, the Floor App stops accepting writes. The live clock continues to tick locally (no per-tick network call), but bust-outs, registrations, and wallet transactions wait until connectivity returns. Venue should plan for a backup network path.

See ADR-001 for the full decision record.

### 5.3 Data model & integration with the other two apps

Floor App writes canonical tournament, entry, player, level, payout, bounty, and wallet-transaction shapes. Player App and Analytics Dashboard read them.

- New collections in v0.4: `wallets`, `walletTransactions`, `tickets`, `withdrawalRequests`.
- Adaptor passes on the analytics dashboard and Player App in Phase 6 keep all three apps consistent. No structural rewrite of either consuming app.

### 5.4 Firestore security rules

- First proper `firestore.rules` file covering all three apps' access patterns.
- Role-based access (Manager / TD / Cashier / Read-only) enforced at rules layer.
- Wallet writes restricted to Cashier and Manager.
- Sensitive fields (BSB, account number, full transaction ledger detail) require Cashier or Manager; reads audit-logged.
- Player App anonymous-auth users get read-only/appropriate-write rules.
- ~~Staging Firebase project for testing rule changes.~~ **Skipped in v0.6** — building directly on shared `playlive-25a17` because the analytics dashboard and Player App are not currently in active use, removing the original "production-impact" concern. See `DECISIONS.md` for the trade-off accepted.

### 5.5 Hosting & deployment

- Firebase Hosting (project `playlive-25a17`).
- Two URLs: operator app (venue PC or iPad) and venue display (full-screen browser on TVs).
- CI/deploy mirrors the analytics dashboard workflow.

### 5.6 Runtime validation (substitute for compile-time types)

JavaScript, matching analytics dashboard. Without TypeScript we lose compile-time guarantees on shapes — most worrying for money-handling code. Mitigation:

- Shared Zod-style schema-validation module defining canonical shapes (Tournament, Entry, Player, Level, Payout, Bounty, Wallet, WalletTransaction, Ticket, WithdrawalRequest).
- All Firestore writes go through validators. Bad shapes throw at write-time.
- All reads validate too — catches pre-existing dirty records rather than silently corrupting calculations.

### 5.7 Wallet as record-keeping (not processor)

The wallet design deliberately keeps the Floor App outside the compliance critical path.

- Deposits: staff complete payment via existing venue systems (EFTPOS terminal, cash till, banking app for PayID), then record it in the Floor App.
- Spends from wallet: Floor App debits the wallet ledger atomically with registration. No external transaction occurs.
- Withdrawal requests: Floor App records the request and queues it. Staff process cash-out / refund / bank transfer through existing systems, then mark completed which debits the wallet.
- Transaction ledger is the durable record. Reconciliation against bank statements and EFTPOS settlements happens externally.

## 6. Deliverables

| Deliverable | Description |
|---|---|
| Operator web app | React app for floor staff: tournament setup, clock, registration, seating, balancing, payouts, wallet. |
| Venue display app | Full-screen cycling view for tournament TVs: clock, prize pool, stats. |
| Player wallet module | Deposit recording, spend, ticket handling, withdrawal-request queue, transaction ledger, reconciliation view. |
| Firestore data model | Canonical schema shared across all three PlayLive apps. |
| Firestore security rules | First proper firestore.rules with role-based access and sensitive-field protection. |
| Consumer-app adaptors | Updates to analytics dashboard and Player App for new schema. |
| Operator handbook | Short printable guide for floor staff, split by persona. |
| Cutover plan | Written plan for the day Casinoware is switched off, with rollback steps (Rollout phase). |

## 7. Data Migration

The Phase 0 Firestore audit (`docs/schema/firestore-audit.md`) revealed that the existing Firestore data is a live-stream snapshot from Casinoware — not the source of truth. Casinoware itself is the source of truth; CSV exports from Casinoware are the migration path. This drives the v0.6 sequencing:

1. **Schema first, uninfluenced by legacy.** Phase 1 task 1.3 designs the canonical schema for the new system's best case. The legacy Firestore shape does not constrain it.
2. **Drop and reclaim the `tournaments` name.** The 1,695 legacy documents in the Firestore `tournaments` collection are deleted; the collection name is reused for canonical-schema documents. Backup paths: Casinoware itself, manual Casinoware CSV exports, and the local audit dump at `scripts/firestore-audit/output/tournaments.dump.json`.
3. **Prove the schema by use.** Phase 2 builds tournament creation against the canonical schema. By end of Phase 2 the schema is validated against the new system actually working.
4. **Field mapping done with Guy in the loop.** Once the schema is stable, Guy + Claude collaborate on a field-by-field mapping doc from Casinoware CSV shapes to canonical-schema shapes (Action Plan task R1.0a). Covers shape conversion (dollars → integer cents), enum mapping, sparse-array-as-map unwrapping, and which fields are dropped.
5. **Import runs before Rollout training.** Migration script (R1.0b) consumes the mapping doc, imports historical players, opening wallet balances, and historical tournaments into the canonical collections. Each imported balance becomes one `walletTransactions` row with `reference = "opening_balance"`. Runs before R1.2 (champion training) so champions train against real data.
6. **Wallet starts non-empty.** Updated from v0.4 / v0.5 assumption — opening balances are imported per the R1.0b run.

What the migration explicitly does **not** do:
- It does not preserve the legacy Firestore document shapes anywhere readable by the new app.
- It does not require analytics dashboard / Player App schema compatibility during the migration window — both apps are not in active use and will pick up the new canonical schema via Phase 6 adaptor work.
- It does not do live data migration; the import is a one-off batch run that can be re-executed if needed.

## 8. Assumptions

- Venue hardware in place: operator PC with attached printer, one or more iPads, tournament display TVs, EFTPOS terminal, cash till, venue network.
- Venue internet is reliable. Brief outages tolerated (work pauses); long outages are an operational issue. Redundant connection / 4G failover recommended.
- PlayLive's Firebase project (`playlive-25a17`) remains the home for all three apps, on a paid Blaze tier.
- Casinoware is month-to-month, so cutover timing is not constrained by contract notice.
- Full access to live Casinoware for the Phase 0 walkthrough.
- Two in-house champions committed: TD + Registration Desk.
- Floor staff are willing to be involved in UAT during the Rollout phase.
- Guy is the sole reviewer / decision-maker.
- Gaming compliance / regulatory functions handled by separate workstreams. The wallet ledger and audit log feed those workstreams.
- Real-world money movement continues to flow through the venue's existing systems.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Casinoware feature creep mid-build. | Phase 0 includes a thorough screen-by-screen walkthrough; feature inventory signed off before build. |
| Internet outage during a tournament stops the Floor App. | Venue advised to set up a redundant connection or 4G failover. Live clock keeps ticking locally during short outages. |
| Wallet ledger drifts from real-world money movements. | Reconciliation view designed in from day one; daily end-of-day reconciliation documented in the handbook. Every transaction attributable to a staff actor. |
| BSB / account data leaked or misused. | Stored as sensitive-tier; Cashier + Manager role required to read; reads audit-logged. Firestore rules enforce access at the DB layer. |
| Withdrawal marked completed without money actually being paid. | Two-step pattern: any Cashier creates the request, only a Manager can mark completed; free-text reference for the external transaction. |
| Mystery Bounty mechanics turn out more complex than anticipated. | Discrete sub-feature of Phase 4 with its own checkpoint. Can be deferred to v1.5 without affecting cutover. |
| Live data corruption during cutover. | Parallel-run period in the Rollout phase. Daily Firestore backups during the window. |
| Build slips because Guy is the only developer. | Plan splits into independent modules. v1 scope deliberately tight. |
| Open Firestore (no rules) exploited before cutover. | Rules deployed in Phase 1 before the Floor App writes any production data. |
| JavaScript lets a money-handling bug slip through. | Runtime validators on every write. Wallet operations always have a confirmation step. Audit log makes any error easy to trace and reverse. |

## 10. Success Criteria

v1 is complete and Casinoware can be switched off when all of the following are true:

1. PlayLive has run at least five real tournaments end-to-end on the new system in parallel with Casinoware, with no operational regressions.
2. The wallet ledger has reconciled cleanly against external bank/EFTPOS records for at least two end-of-day cycles.
3. The analytics dashboard and player app both read tournament and wallet data produced by the new system without manual cleanup.
4. Floor staff have signed off on the operator handbook and confirmed they no longer need Casinoware for day-to-day operations.
5. The Casinoware subscription has been cancelled.
