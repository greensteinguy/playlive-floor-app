# Timeline — PlayLive Floor App

**Version:** v0.3 — Companion to SOW v0.4 and Action Plan v0.3
**12-week Build phase:** 4 May → 26 July 2026
**Rollout phase** (UAT, training, cutover) runs separately afterwards.

> Markdown mirror of `03_Timeline.docx` for Claude Code consumption.

## How v0.3 differs from v0.2

- Phases 7 (UAT & Parallel Run) and 8 (Cutover) removed from the 12-week window. Now sit in a separate Rollout phase scheduled around PlayLive's tournament calendar.
- Phase 6 (Consumer-app Adaptors) moved to Week 12 as the build-phase closer.
- Wallet & withdrawal work absorbed into Phases 1, 3, and 4 — Phase 3 grew from 2 to 3 weeks; Phase 4 grew from 2 to 3 weeks.
- Offline-tolerance simulation (was Phase 5 in v0.2) is gone — Floor App is online-only.

## Build phase — Gantt (12 weeks)

Week 1 starts Mon 4 May 2026; Week 12 finishes Sun 26 July 2026.

```
Phase                                W1 W2 W3 W4 W5 W6 W7 W8 W9 W10 W11 W12
0  Discovery & Setup                 ██
1  Foundations                          ██ ██
2  Tournament Setup & Clock                ██ ██ ██
3  Registration, Seating, Wallet                 ██ ██ ██ ██
4  Payouts, Results & Withdrawals                          ██ ██  ██
5  Display & iPad Polish                                       ██  ██
6  Consumer-app Adaptors                                            ██
```

## Build phase — Week-by-week

| Wk | Phase | Focus this week | Milestone / Output |
|----|-------|-----------------|---------------------|
| **1**  | Phase 0    | Casinoware feature inventory + wallet discovery (shadow registration desk). Audit existing Firestore. Stand up empty repo and staging Firebase. Lock ADR-001 (online-only). | **Feature inventory, wallet design note, schema audit, staging Firebase up** |
| 2  | Phase 1    | Firebase Auth + four staff roles. App shell with persona-tailored landing screens. Begin firestore.rules covering all collections including wallet collections. | Login flow working with role claims |
| **3**  | Phase 1+2  | Finalise Firestore rules and deploy to staging (**HARD GATE**). Runtime validator module. Wallet ledger module (no UI). Begin tournament create/edit form and blind-structure builder. | **Rules deployed. Schema v1 frozen. Wallet ledger primitives ready.** |
| 4  | Phase 2    | Payout structure builder (with auto-generate). Satellite + multi-flight setup. Tournament templates + weekly recurring generator. Live clock engine. | Working clock prototype |
| **5**  | Phase 2→3  | Floor controls (pause/resume/jump). Internal Phase 2 walk-through. Begin player search + new player registration with enhanced profile fields. | **Phase 2 sign-off** |
| 6  | Phase 3    | Registration with multi-method payment selection (cash, EFTPOS, PayID, wallet, ticket). Ticket equal-or-greater rule. Wallet deposit screen including PayID wizard. | Registration + all 5 payment methods live on staging |
| 7  | Phase 3    | Seat assignment + printable seat list. Table balancing engine. Table breaking. Waitlist with alternate ticket printing. | Seating + balancing + alternates working |
| **8**  | Phase 3→4  | Per-player transaction ledger view. Internal Phase 3 walk-through (mock tournament with every payment method). Begin bust-out recording. | **Phase 3 sign-off** |
| **9**  | Phase 4    | Payout calculator. Mystery Bounty draw flow. Last-longer settlement. Deal-making (manual entry). ICM helper if time (stretch). | **First full tournament can run end-to-end on staging** |
| **10** | Phase 4+5  | Win-credit-to-wallet on final results. Withdrawal-request queue with two-step pattern. End-of-day reconciliation view. Begin display app at /display. | **Wallet round-trip complete (deposit → spend → win → withdraw)** |
| 11 | Phase 5    | Cycling display (blinds, prize pool, stats). Display polish. iPad pass on every screen. | Display polished. iPad pass report. |
| **12** | Phase 6    | Update analytics dashboard and Player App to consume new schema (including wallet read views). Backwards-compat shim. End-of-build review with Guy. | **BUILD PHASE COMPLETE — feature-complete on staging** |

## Build phase — Major milestones

- **End of Week 1:** Feature inventory + wallet design frozen. Anything added later pushes the build window.
- **End of Week 3:** Firestore security rules deployed to staging. HARD GATE before any production write.
- **End of Week 5:** First tournament can be created and run end-to-end on staging.
- **End of Week 8:** Every registration payment method works on staging (cash, EFTPOS, PayID, wallet, ticket).
- **End of Week 9:** First full tournament (registration → seating → bust-outs → payouts) runs end-to-end.
- **End of Week 10:** Wallet round-trip works (deposit → spend → win-credit → withdrawal request → completion).
- **End of Week 12:** **BUILD PHASE COMPLETE.** Floor App feature-complete on staging. Hand-off to Rollout phase.

## Build phase — Calendar

| Week | Dates | End-of-week deliverable |
|------|-------|--------------------------|
| **1**  | 4 – 10 May          | **Feature inventory + wallet design + schema audit + ADR-001** |
| 2  | 11 – 17 May         | Auth + role-aware app shell |
| **3**  | 18 – 24 May         | **Firestore rules deployed (HARD GATE). Schema v1 frozen. Wallet ledger primitives ready.** |
| 4  | 25 – 31 May         | Working clock prototype |
| **5**  | 1 – 7 June          | **Phase 2 sign-off — tournaments can be created and run end-to-end** |
| 6  | 8 – 14 June         | Registration with all 5 payment methods + PayID wizard live |
| 7  | 15 – 21 June        | Seating + balancing + alternates working |
| **8**  | 22 – 28 June        | **Phase 3 sign-off — full registration / seating / wallet flow** |
| **9**  | 29 June – 5 July    | **First full tournament runs end-to-end on staging** |
| **10** | 6 – 12 July         | **Wallet round-trip complete (deposit → spend → win → withdraw)** |
| 11 | 13 – 19 July        | Display polished. iPad pass report. |
| **12** | 20 – 26 July        | **BUILD PHASE COMPLETE — feature-complete on staging** |

## Rollout phase (separate schedule)

Begins once the build phase is complete. Calendar pace depends on PlayLive's tournament schedule — bug-fix cycles and parallel-run tournaments cannot be artificially compressed.

```
Rollout activity                                   R1 R2 R3 R4 R5 R6 R7 R8 R9 R10
R1 Handbook + champion training                    ██ ██
R1 Group training                                     ██
R1 Tournaments 1–2 (parallel run)                       ██ ██
R1 Bug-fix sprint                                          ██ ██
R1 Tournaments 3–5 + reconciliation                           ██ ██ ██ ██
R2 Pre-cutover checklist + deploy                                       ██ ██
R2 Cutover + cancel Casinoware + post-mortem                               ██ ██
```

Rollout-week numbering is relative (R1, R2, ...) because absolute calendar dates depend on when the build phase completes and PlayLive's tournament schedule. Rough estimate: 8–12 weeks from build-phase completion to Casinoware switch-off.

## Rollout phase — Hard gates

- **Before any production write:** Firestore security rules deployed (carried over from build Week 3).
- **Before parallel-run tournaments:** both champions trained, handbook in hand.
- **Before cutover:** floor staff UAT sign-off **and** at least two clean end-of-day wallet reconciliations against external records.

## Slip strategy

- **Build phase:** critical-path tasks (clock, registration, payouts) cannot slip without pushing Week 12. Stretch goals (ICM helper, display polish beyond minimum) are the first to defer if pressure builds.
- **Rollout phase:** parallel run is the buffer. If issues are found, we run more parallel tournaments — cutover slips rather than rushes. Casinoware is month-to-month, so an extra month of subscription is the cost of getting cutover right.
