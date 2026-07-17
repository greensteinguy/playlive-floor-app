# Progress Log — PlayLive Floor App

A plain-language record of what was built, session by session. Items marked
**[extra]** were not in the original plan — they came from floor-team feedback
or opportunities spotted along the way.

**Where we stand (16 July 2026, week 8 of 12):** Phases 0–4 of the six-phase
build are code-complete — that's the entire operational core: tournament setup,
the live clock, registration and payments, seating, the wallet, payouts, and
reconciliation. The app is deployed to a live testing environment at
admin.playlive.melbourne. Remaining: the TV display + iPad polish phase, the
consumer-app adaptors phase, and the human sign-off reviews — which this
testing round kicks off.

---

## Week 1 — Discovery & Setup (Phase 0)

- Casinoware feature inventory completed with the floor team (what to keep,
  what to drop, how Mystery Bounty works).
- Audit of the existing shared database; documented quirks and duplicates.
- Project repository set up (same tech stack as the analytics dashboard).
- Key architecture decisions locked: online-only operation (the venue
  provides reliable internet; the app refuses writes rather than risk
  conflicting data), and the wallet as **record-keeper, not payment
  processor** — the venue's existing till/EFTPOS/PayID systems move money,
  the app records that it happened.
- Registration desk shadowed for a shift → wallet design document.

## Week 2 — Foundations (Phase 1)

- Staff sign-in with four roles: Manager, Tournament Director, Cashier,
  Read-only. Every screen respects the role.
- **Security rules deployed** — the database refuses access to anyone without
  a staff role, enforced server-side, not just in the app. (This was the
  project's first hard gate: no real data before rules.)
- The full database schema designed and documented; every read and write in
  the app validated against it automatically.
- The wallet ledger engine: 13 money operations (deposits, buy-ins, tickets,
  withdrawals, win credits, corrections), all atomic — a buy-in that debits a
  wallet and creates an entry either fully happens or fully doesn't. Two
  iron rules with no override: a wallet can never go negative, and every
  amount must be positive.
- Duplicate-player merge tool (for cleaning up the imported player base).
- Audit log: every staff action recorded with who / what / when, viewable and
  filterable by managers.
- App shell with tailored home screens per persona (desk vs floor).
- 418 automated tests at this point.

## Weeks 3–4 — Tournament Setup & Clock (Phase 2)

- Tournament templates, two-level: reusable blind structures + full
  tournament templates ("Thursday $80 Turbo" as one click).
- Tournament creation wizard: all formats — NLH, PLO, satellites (with ticket
  rewards), Mystery Bounty, multi-day, and multi-flight (several Day 1s
  converging into one Day 2).
- Payout structure editor: by percentage or fixed amounts, auto-fill,
  rounding rules, manual override of every place.
- **The live clock.** Blind levels count down and advance automatically, stay
  in sync on every screen, and survive page reloads and network blips. Pause,
  resume, jump levels. (Design note: the clock stores an anchor time rather
  than ticking in the database — this is why it can't drift.)
- Floor controls: the tournament lifecycle (draft → scheduled → late reg open
  → closed → finished), with unusual jumps requiring a manager and a recorded
  reason.

## Weeks 5–6 — Registration, Seating & Wallet (Phase 3)

- Player profiles, fast fuzzy search, and quick-create at the desk.
- **Registration with all payment methods:** cash, EFTPOS, from wallet, and
  ticket (with top-up when the ticket doesn't cover the buy-in). Prize pool
  automatically excludes hospitality.
- Wallet deposits: cash, EFTPOS, and a guided **PayID wizard** that walks the
  cashier through reading out the venue PayID and confirming funds arrived
  before recording.
- **The whole seating suite:** random seat draw with even table distribution,
  manual moves, table balancing (minimum player moves, ±1), table breaking
  with automatic redistribution, opening/closing/activating tables, and an
  alternates waitlist (first-in-first-out, "seat next" one-tap).
- Per-player wallet ledger on the profile: every transaction with a running
  balance, filters, and CSV export.
- **[extra]** Sub-second protection everywhere: if the venue internet drops
  mid-save, the app shows a clear error and re-enables the button instead of
  hanging forever.

## Early June — Floor-team driven improvements

- **[extra] Full visual redesign** — the black/white/PlayLive-red "Floor OS"
  look, replacing the developer-grade styling.
- **[extra] Seating room overview** rebuilt after TD feedback ("doesn't scale
  to many tables"): each table is now a compact card with a ✓/✗ seat map;
  names on demand.
- **[extra] Player elimination pulled forward** from Phase 4 so bust-outs
  could be tested with the seating tools together.

## 1 July — Floor feedback round #1 (all six quick wins shipped)

The floor managers walked through the app and produced a feedback list. All
six quick-win items shipped the same week **[extra]**:

- Tournament list: clickable column sorting.
- Open-table button made prominent + open several tables at once.
- Deposit screen: full player list, alphabetical, whole row clickable.
- Audit log: search-as-you-type fixed; action list alphabetised.
- Plus: the venue's **real blind structures** entered as templates — Sixhundy
  Sunday, Championship Opening, Main Event, and the standard turbo ladder.

## 10 July — Payouts, Results & Withdrawals (Phase 4)

The entire end-of-tournament flow, built and tested in one coordinated push:

- Bust-out recording with **automatic finishing places**, safe even when two
  staff eliminate players simultaneously. Mistakes reversible with an audit
  trail.
- Mystery Bounty draws: random from the remaining pool, duplicate-proof, with
  a reveal screen and bounty board.
- Satellite milestones: one tap marks a player as having won their ticket.
- Last-longer (Upper Deck / Main Deck) winner settlement.
- **Payouts screen:** calculated from the real prize pool, deal-making mode
  (custom amounts, manager acknowledgment if the total differs from the
  pool), and **per-player cashier confirmation** before anything credits a
  wallet — no bulk auto-pay, by design.
- Withdrawals queue: cashier creates, **manager completes** (money leaves the
  wallet only on manager confirmation).
- End-of-day **reconciliation view**: cash/EFTPOS/PayID taken, withdrawals
  paid, net wallet movement — with CSV export for checking against the till.
- Final results page per tournament.
- The one planned stretch item — the ICM deal calculator — was consciously
  parked for v1.5, exactly as the plan's decision point allowed.
- 817 automated tests, plus an independent comprehensive code review.

## 16 July — Staging launch (this round)

- Deployed to Firebase Hosting: **https://playlive-floor.web.app**, then the
  custom domain **https://admin.playlive.melbourne**.
- Four role-based test accounts created and configured.
- **[extra] "Sign in with Google" added** to the login page, ready for staff
  Workspace accounts (email + password also works).
- Full end-to-end smoke test on the live environment: player creation,
  deposits, tournament creation, registration from wallet, clock, audit
  trail — all passing. One bug found (a broken back-link on the clock
  screen), fixed and redeployed the same hour.
- Role gating and phone usability verified on a real phone.
- Historical Casinoware data (1,773 past tournaments) found in the shared
  database and **deliberately preserved** — it belongs to the analytics
  dashboard and coexists safely with the new app.
- This stakeholder package prepared.

---

## What remains

| Item | Notes |
|---|---|
| Stakeholder feedback round | **You are here** — the reason for this package |
| Guy's formal Phase 2 & 3 sign-off reviews | Now unblocked by the staging environment |
| Seating UX walkthrough with floor staff | The seating screens are functional-first and expected to change with your input |
| Real payout curve | The auto-fill uses a placeholder curve; swaps to the venue's real table when supplied |
| Phase 5 — TV display + iPad polish | Weeks 10–11 in the plan |
| Phase 6 — Analytics dashboard + Player App adaptors | Week 12 in the plan |
| Rollout | Data import from Casinoware, handbook, training, parallel run, cutover — scheduled around the venue's calendar |
