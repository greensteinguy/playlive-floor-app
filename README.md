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

In Phase 0 (Discovery & Setup) of a 12-week build phase, followed by a separate Rollout phase (UAT, training, cutover).

## Where to find things

- **Scope & plan:** `docs/01_Scope_of_Work.md`, `docs/02_Action_Plan.md`, `docs/03_Timeline.md`
- **Current state for the AI collaborator:** `docs/HANDOFF.md`
- **Architecture decisions:** `docs/DECISIONS.md` and `docs/adr/`
- **Project context for Claude Code:** `CLAUDE.md`

## Stack

React 19 + Vite + Tailwind CSS, JavaScript. Firebase Firestore + Auth + Hosting. Zod for runtime validation.

## Owner

Guy Greenstein. Built collaboratively with Claude (Anthropic).
