# Action Plan — Completion Status

Status of every task in the 12-week build plan (Action Plan v0.7), as of
**16 July 2026 (week 8)**.

**Legend:** ✅ done · 🔶 partial / in progress · ⏸ parked by decision · ⬜ not started

**Summary: Phases 0–4 are code-complete.** 41 of 46 build-phase tasks are done;
the open items are the two human sign-off reviews (now unblocked by staging),
one on-device test, one parked stretch feature, and Phases 5–6.

## Phase 0 — Discovery & Setup (Week 1) — ✅ complete

| # | Task | Status |
|---|---|---|
| 0.1 | Casinoware feature inventory | ✅ |
| 0.2 | Firestore audit | ✅ |
| 0.3 | Repo setup | ✅ |
| 0.4 | Staging Firebase project | ⏸ Skipped by decision (27 May) — build proceeds on the shared project; the hosted testing environment fills the staging role |
| 0.5 | ADR-001 online-only | ✅ |
| 0.6 | Wallet & payments discovery | ✅ |

## Phase 1 — Foundations (Weeks 2–3) — ✅ complete (one device test open)

| # | Task | Status |
|---|---|---|
| 1.1 | Firebase Auth, four staff roles | ✅ Live accounts in use on staging since 16 July |
| 1.2 | Firestore security rules | ✅ Deployed 28 May — the "no production writes before rules" hard gate |
| 1.3 | Canonical schema doc | ✅ |
| 1.4 | Runtime validators | ✅ |
| 1.5 | App shell + persona landings | ✅ |
| 1.6 | Validated data layer | ✅ |
| 1.7 | Wallet ledger module | ✅ Hard invariants (no negative wallets) tested and pinned |
| 1.8 | Duplicate-player merge tool | ✅ |
| 1.9 | Audit log viewer | ✅ Indexes deployed to production 16 July |
| 1.10 | iPad layout pass | 🔶 Code pass done; on-device test pending — phone check on 16 July passed, iPad expected during this feedback round |

## Phase 2 — Tournament Setup & Clock (Weeks 3–5) — ✅ complete (sign-off open)

| # | Task | Status |
|---|---|---|
| 2.1 | Tournament create (all formats, wizard) | ✅ |
| 2.2 | Blind structure builder + tournament list | ✅ |
| 2.3 | Payout structure editor | ✅ Auto-fill curve is a placeholder until the venue's real payout table is supplied |
| 2.4 | Multi-day / multi-flight / satellite setup | ✅ |
| 2.5 | Templates (structures + tournaments) | ✅ Real venue structures entered 1 July |
| 2.6 | Live clock engine + TD control screen | ✅ |
| 2.7 | Floor controls (status lifecycle) | ✅ |
| 2.8 | **Guy's create-and-run walkthrough** | ⬜ Human gate — now unblocked by the staging environment |

## Phase 3 — Registration, Seating & Wallet (Weeks 5–8) — ✅ complete (sign-off open)

| # | Task | Status |
|---|---|---|
| 3.1 | Enhanced player profile | ✅ |
| 3.2 | Fuzzy player search | ✅ |
| 3.3 | Quick-create registration | ✅ |
| 3.4 | Registration with 4 payment methods | ✅ |
| 3.5 | Ticket payment logic (top-up rule) | ✅ |
| 3.6 | Wallet deposit + PayID wizard | ✅ |
| 3.7 | Seat assignment (random draw + manual) | ✅ Thermal printing of seat cards stays Phase 5; CSV export in place |
| 3.8 | Live table balancing | ✅ Balancing player-selection rule flagged for the floor-staff walkthrough |
| 3.9 | Table breaking | ✅ |
| 3.10 | Alternates / waitlist | ✅ |
| 3.11 | Per-player transaction ledger | ✅ |
| 3.12 | **Guy's mock-tournament review** | ⬜ Human gate — now unblocked by the staging environment |

## Phase 4 — Payouts, Results & Withdrawals (Weeks 8–10) — ✅ complete, early

| # | Task | Status |
|---|---|---|
| 4.1 | Bust-out recording + automatic finishing places | ✅ Done 10 July |
| 4.2 | Mystery Bounty draws + satellite milestones | ✅ Done 10 July |
| 4.3 | Last-longer (Upper/Main deck) logic | ✅ Done 10 July |
| 4.4 | Payout calculation screen | ✅ Done 10 July |
| 4.5 | Deal entry mode | ✅ Done 10 July |
| 4.6 | ICM helper (stretch) | ⏸ Parked to v1.5 — exactly per the plan's end-of-Phase-4 decision point |
| 4.7 | Cashier win-credit confirmation | ✅ Done 10 July — per-player confirm, no bulk auto-credit |
| 4.8 | Withdrawal request queue | ✅ Done 10 July |
| 4.9 | End-of-day reconciliation view | ✅ Done 10 July |
| 4.10 | Final results page | ✅ Done 10 July |

## Phase 5 — Venue Display & iPad Polish (Weeks 10–11) — ⬜ not started

| # | Task | Status |
|---|---|---|
| 5.1 | TV display app at /display | ⬜ |
| 5.2 | Cycling display (blinds + prize pool) | ⬜ |
| 5.3 | Display styling + multi-tournament rotation | ⬜ |
| 5.4 | iPad-specific pass | ⬜ |

## Phase 6 — Consumer-app Adaptors (Week 12) — ⬜ not started

| # | Task | Status |
|---|---|---|
| 6.1 | Analytics dashboard updates | ⬜ |
| 6.2 | Player App updates | ⬜ |
| 6.3 | Backwards-compat read layer | ⬜ Historical data confirmed preserved and coexisting (16 July) |
| 6.4 | **End-of-build review** | ⬜ Human gate |

## Rollout Phase — ⬜ scheduled after build completion

Data import from Casinoware (R1.0), operator handbook, champion + group
training, parallel run over 3–5 real tournaments, reconciliation verification,
then cutover and Casinoware cancellation. Timing depends on the venue's
tournament calendar.

## Delivered beyond the plan

Work that shipped without being a planned task:

- Full visual redesign (the black/white/red "Floor OS" look)
- Seating room overview rebuilt to scale to many tables (✓/✗ seat maps)
- Player elimination pulled forward from Phase 4 for integrated testing
- Floor feedback round #1: all six quick wins shipped within the week
- Real venue blind structures as permanent templates
- "Sign in with Google" for staff Workspace accounts
- Write-timeout protection (no frozen "Saving…" buttons on network drops)
- Live staging environment + custom domain (admin.playlive.melbourne)
- 817 automated tests + an independent comprehensive code review
