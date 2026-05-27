# PlayLive Floor App — Project Memory

This file is read automatically by Claude Code at the start of every session. Read it first, then `docs/HANDOFF.md` for the current state, then whatever specific task doc applies.

## What this project is

A custom tournament management web app for **PlayLive Melbourne**, a poker venue. It replaces a third-party tool called **Casinoware** that the venue currently pays for monthly. The Floor App is used by venue staff (Tournament Directors, registration desk, cashiers) to run tournaments live, manage seating, take buy-ins via multiple payment methods, track a per-player wallet, and record payouts.

## Where it sits in the wider system

Three apps share one Firestore database (`playlive-25a17` on Firebase). This SOW covers only the Floor App; the other two have their own separate plans.

| App | Audience | Stack | Status |
|---|---|---|---|
| **Floor App (this project)** | Floor staff: TDs, dealers, cashier | React + Vite + Tailwind + Firebase, JS | Phase 0 starting |
| Player App | Players: discovery, registration, wallet self-service | Flutter (mobile-first) | ~40% built, at `C:\Users\green\Documents\PlayLiveApp\playlive_tournament_app` |
| Analytics Dashboard | Owners / management: reporting | React + Vite + Tailwind + Firebase | ~70-80% built, at `C:\Users\green\Documents\playlive-analytics` |

The Floor App is the **operational source of truth** — it writes tournament and wallet data that the other two read.

## Stack & conventions

- React 19, Vite, Tailwind CSS, **JavaScript** (matches analytics dashboard; not TypeScript)
- React Router for navigation
- Firebase Firestore (online-only — see ADR-001), Firebase Auth (email/password for staff)
- Firebase Hosting for deployment
- Zod for runtime validation (substitutes for compile-time types — see SOW §5.6)
- Lint/format config copied from `playlive-analytics`
- Visual styling (colors, fonts) lifted from `playlive-analytics` for cross-app consistency

## The team

- **Guy** — product owner, sole reviewer, decision-maker. Non-developer working through Claude Code as build partner.
- **Claude** — AI development collaborator. Produces code, tests, docs, schemas against Guy's direction.
- Two future in-house champions identified for training in the Rollout phase: one TD, one Registration Desk staff member.

## Critical context

1. **The wallet is record-keeping, not a payment processor.** Floor App records that deposits, spends, and withdrawals happened. The venue's existing systems (EFTPOS terminal, cash till, banking app for PayID) actually move the money. This keeps the app out of the compliance critical path. See SOW §3.4 and §5.7.

2. **Online-only operation.** No offline persistence in v1 — see ADR-001. Network outage = app stops accepting writes. Venue is responsible for network reliability (redundant connection / 4G failover recommended).

3. **Two user personas drive the UX.** Tournament Director persona (clock, seating, balancing, deals, payouts) and Registration Desk persona (player search, registration, wallet deposits, withdrawals queue). Each gets a tailored landing screen; role-based access (Manager / TD / Cashier / Read-only) enforced at the Firestore rules layer.

4. **Device targets:** venue PC with attached printer (mouse + keyboard, dedicated thermal printer for seat cards / alternate tickets) **and** iPad (touch-first). Both are first-class.

5. **Player profiles have a sensitive tier.** BSB and account number (used for withdrawal payouts) live behind role-restricted Firestore rules and are audit-logged on read.

6. **Firestore is currently open (no rules).** First production write must wait until rules are deployed (end of Phase 1 = Week 3 hard gate).

## Project structure

```
Application/
├── CLAUDE.md                    ← this file
├── README.md                    ← short overview for humans
├── package.json
├── vite.config.js, tailwind.config.js, postcss.config.js, eslint.config.js
├── .env.example                 ← copy to .env.local with staging Firebase values
├── index.html
├── docs/
│   ├── 01_Scope_of_Work.md      ← canonical scope (also exists as .docx for the team)
│   ├── 02_Action_Plan.md        ← phases and tasks
│   ├── 03_Timeline.md           ← 12-week build + separate rollout
│   ├── HANDOFF.md               ← living "where we left off" doc — UPDATE AT END OF EVERY SESSION
│   ├── DECISIONS.md             ← running log of architecture/product calls
│   ├── adr/
│   │   └── ADR-001-online-only.md
│   └── schema/
│       └── canonical-schema.md  ← canonical Firestore shapes (fleshed out in Phase 1)
├── src/
│   ├── main.jsx, App.jsx, index.css
│   └── firebase/config.js
└── public/
```

## How sessions should start

1. Read this file.
2. Read `docs/HANDOFF.md` to see where we left off and what's next.
3. Read `docs/DECISIONS.md` if you're touching anything architectural.
4. Read the relevant task block in `docs/02_Action_Plan.md`.
5. Start work.

## How sessions should end

**Always** update `docs/HANDOFF.md` with: what was done, what's in-progress, what's blocked, what's next. This is the single most important habit for keeping context across sessions and across the Cowork ↔ Claude Code switch. Commit it.

## Things NOT to do in this project

- Don't add TypeScript without explicit approval (decided to stay JS to match analytics dashboard).
- Don't enable Firestore offline persistence (ADR-001).
- Don't write code that initiates actual payments (EFTPOS API calls, PayID API calls, bank transfers). The app records that those happened externally.
- Don't store player payment-card details. BSB/account number is the only stored bank reference, and it's role-restricted.
- Don't process Casinoware data import beyond the best-effort player dedupe in Phase 1.
- Don't expand v1 scope to cover cash games, packages, ID scanning, loyalty, or multi-venue — those are v1.5+ candidates and live in a separate backlog.

## Useful commands

```bash
npm install              # first time
npm run dev              # local dev server (Vite)
npm run lint             # eslint
npm run build            # production build
```

## Related projects on this machine

- `C:\Users\green\Documents\playlive-analytics` — analytics dashboard, READ from same Firestore. Lift utility code and visual styling from here.
- `C:\Users\green\Documents\PlayLiveApp\playlive_tournament_app` — Flutter player app. Reads tournaments and (in Phase 6) wallet balance. Coordinate schema changes.
