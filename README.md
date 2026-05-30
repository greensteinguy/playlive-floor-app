# PlayLive Floor App

Custom tournament management web app for PlayLive Melbourne. Replaces Casinoware.

This is the **operator / floor-staff tool** — one of three apps in the PlayLive software stack:

- **Floor App** (this repo) — operations: tournaments, clock, seating, payouts, player wallet.
- **Player App** — discovery + registration, mobile-first (Flutter).
- **Analytics Dashboard** — owner/management reporting.

All three share one Firestore database.

## Quick start

```bash
npm install
cp .env.example .env.local        # then fill in staging Firebase values
npm run dev
```

Visit `http://localhost:5173`. The venue display lives at `/display`.

## Project status

**Phase 2 (Tournament Setup & Clock) — in progress**, within a 12-week build phase followed by a separate Rollout phase (UAT, training, cutover). Phase 1 (Foundations: auth, role-based security rules, schema + Zod validators, wallet ledger, app shell) is complete. Phase 2 has delivered tournament templates, create/list/detail, the payout-structure editor, the multi-day/multi-flight sessions model, the live clock + TD control screen, and floor (status-transition) controls. See `docs/HANDOFF.md` for the live state and `docs/02_Action_Plan.md` for the full plan.

## Auth

The Floor App uses Firebase Auth (email + password) with four roles: `manager`, `td`, `cashier`, `readonly`. There is no signup screen — staff accounts are provisioned by the venue operator. See `docs/operator/initial-admin-setup.md` for how to create the first user and set roles.

For local UI iteration without a Firebase project, set `VITE_USE_MOCK_DATA=true` in `.env.local` — the app signs you in as a fake user.

## Where to find things

- **Scope & plan:** `docs/01_Scope_of_Work.md`, `docs/02_Action_Plan.md`, `docs/03_Timeline.md`
- **Current state for the AI collaborator:** `docs/HANDOFF.md`
- **Architecture decisions:** `docs/DECISIONS.md` and `docs/adr/`
- **Project context for Claude Code:** `CLAUDE.md`

## Stack

React 19 + Vite + Tailwind CSS, JavaScript. Firebase Firestore + Auth + Hosting. Zod for runtime validation.

## Owner

Guy Greenstein. Built collaboratively with Claude (Anthropic).
