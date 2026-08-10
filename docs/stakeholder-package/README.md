# PlayLive Floor App — Stakeholder Package

**Prepared:** 16 July 2026 · **Project week:** 8 of 12 (build phase)

Welcome! This package is everything you need to understand where the PlayLive
Floor App is up to and to start using the live testing environment.

## What is the Floor App?

A custom tournament management system built for PlayLive Melbourne to replace
Casinoware. Floor staff use it to run tournaments live: the clock, seating and
table balancing, player registration, buy-ins by every payment method the venue
takes, a per-player wallet ledger, payouts, and end-of-day reconciliation.

It is one of three connected apps: the **Floor App** (this one — the
operational tool for staff), the **Player App** (player-facing mobile app,
separate project), and the **Analytics Dashboard** (management reporting,
separate project). All three share one database; the Floor App is the source
of truth that the other two read.

## Accessing the testing environment

The app is live on the internet — no installation, works in any browser on PC,
iPad, or phone:

- **Primary address:** https://admin.playlive.melbourne
- **Backup address (same app):** https://playlive-floor.web.app

### Logging in

Four test accounts exist, one per staff role. Use the one matching the role
you're testing — the app genuinely looks and behaves differently per role.

| Login email | Role | What you see |
|---|---|---|
| manager@playlive.melbourne | Manager | Everything |
| td@playlive.melbourne | Tournament Director | Floor tools: clock, tables, seating |
| cashier@playlive.melbourne | Cashier / Desk | Players, registration, deposits |
| readonly@playlive.melbourne | Read-only | View everything, change nothing |

**Passwords:** distributed separately by Guy — they are deliberately not
written in this document.

### Two ground rules

1. **This is a live shared database.** Anything you create should be obviously
   fake — prefix tournament and player names with **ZZTEST**. It all gets
   cleaned up before real use.
2. **No real money moves, ever.** The wallet records that money changed hands
   at the till / EFTPOS terminal / via PayID — the app never touches the money
   itself. Feel free to record deposits and buy-ins freely.

## What's in this package

| Document | What it is |
|---|---|
| **README** (this document) | Access instructions and orientation |
| **Progress Log** | Day-by-day record of what has been built, in plain language |
| **Action Plan — Status** | Every planned task marked done / in progress / pending |
| **Staging Test Script** | Step-by-step "what to try" per role — start here if you're testing |
| **Known Gaps** | What's intentionally not built yet, so it isn't reported as broken |
| **Scope of Work** | The original project scope document |
| **Timeline** | The original 12-week build plan + rollout outline |

## How to give feedback

Anything that made you pause, reread, mis-tap, or ask "why?" — write it down,
however small it feels. Format: **where you were → what you did → what you
expected → what happened.** Screenshots welcome. Send everything to Guy.
Feedback is triaged into a prioritized list and worked through, the same
process used for the floor-team feedback round in July (all six quick-win
items from that round shipped within the week).
