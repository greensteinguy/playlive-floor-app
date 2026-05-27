# Handoff — current state

> This is the living "where we left off" doc. **Update it at the end of every Claude Code session and every Cowork planning session.** Commit alongside whatever else changed. It is how context survives between sessions and across tool switches.

Last updated: **27 May 2026** by Claude — Phase 0 fully complete; all design questions resolved; Phase 1 unblocked.

---

## Project phase

**Phase 0 — Discovery & Setup: COMPLETE. Ready for Phase 1.**

All Phase 0 walkthrough/shadowing/audit questions resolved. **SOW v0.6 is current.** Action Plan at **v0.5**. Decisions logged. v1.5+ backlog stood up. Staging Firebase project (0.4) skipped. Firestore audit (0.2) ran successfully. Migration sequencing decided (deferred to Rollout, not Phase 1).

The audit was the biggest source of new information in this session. Headline findings:
- Existing database has **only one top-level collection (`tournaments`)** with **1,695 documents**.
- Players, entries, payouts, and blind structures all live as **nested arrays inside tournament docs**.
- **The Firestore data is a live-stream snapshot, not the source of truth.** Per Guy: clean player records with stable IDs, balances, and any other reference data come from **Casinoware CSV exports** done manually as needed. Migration is a CSV ETL job, not a Firestore-to-Firestore transformation.
- Money is stored as plain dollar numbers, not integer cents; migration converts.
- A few legacy quirks (sparse-array-as-map pattern, `-1` sentinel for missing fields, UI styling baked into data) — all detailed and triaged in the audit doc.

## What's done

- SOW updated to **v0.5**. Changelog at the top of `docs/01_Scope_of_Work.md` lists every delta from v0.4.
- Action Plan updated to **v0.4**. Changelog at the top of `docs/02_Action_Plan.md` lists every task touched.
- Both walkthrough docs are **fully resolved** with Guy's answers:
  - `docs/casinoware-feature-inventory.md` — all 9 questions answered.
  - `docs/wallet-design.md` — all 7 questions answered.
- `docs/DECISIONS.md` — 11 new decision entries logged from this session.
- `docs/v1.5-plus-backlog.md` — ID scanning, packages, stats screen, ICM helper, cash games, Player App wallet, TS migration.
- `docs/adr/ADR-001-online-only.md` — accepted.
- Repo scaffolded; `npm install && npm run dev` verified by Guy. Placeholder UI contrast bug fixed.
- **Firestore audit (task 0.2) RUN.** Findings in `docs/schema/firestore-audit.md`. Audit script in `scripts/firestore-audit/`. Raw outputs in `scripts/firestore-audit/output/` (gitignored — contains PII).

## Key decisions from this session (full detail in DECISIONS.md)

- PayID is deposit-only; tournament-pay has four methods, not five.
- Wallet ledger uses always-positive `amount`; `type` determines direction.
- Wallet balance can never go negative; no manager override.
- Win credits require cashier confirmation (no auto-credit).
- Multi-day and multi-flight are distinct tournament structures.
- Templates are two-level (structure templates + tournament templates).
- Upper Deck / Main Deck split is the last-longer side bet — one concept, one toggle.
- Stats screen on venue display moved from v1 to v1.5+.
- Satellite milestone payout = auto-removal at a chip multiple (ticket-reward/buy-in ratio × starting stack).
- Existing player records and wallet balances are imported as part of migration; opening balances become `walletTransactions` rows.

## What's next (in priority order)

1. **Drop the legacy `tournaments` collection.** Per O1: 1,695 docs need deleting before the canonical schema can reuse the collection name. I'll write a small `drop-legacy-tournaments.js` companion to the audit script and run it once Guy gives an explicit go (destructive action — wants confirmation).
2. **Phase 1 kick-off — fully unblocked.** Recommended order:
   - **Task 1.3 (canonical schema)** is the natural starting point. Now that legacy doesn't constrain it, the schema can be designed for the new system's best case. Output is `docs/schema/canonical-schema.md` fully fleshed out.
   - **Task 1.1 (Auth)** runs in parallel — independent of schema work.
   - **Task 1.4 (Zod validators)** follows 1.3 immediately.
   - **Task 1.2 (Firestore rules)** — first proper rules deploy. Will start enforcing immediately on `playlive-25a17`; safe per the staging-skipped decision.
   - **Task 1.5 (App shell)**, **1.6 (Firestore data layer)**, **1.7 (wallet ledger module)**, **1.8 (player merge tool)**, **1.9 (audit log)**, **1.10 (iPad pass)** — order flexible after foundations land.
3. **Narrow SA role back down.** The audit script needed `Editor` (broader than originally planned). Audit is done; SA can be downgraded to `Cloud Datastore Viewer` or disabled. Not urgent — project isn't in production use.

## What's blocked

Nothing right now. Phase 1 is fully unblocked.

**Coordination risk to watch** (not a blocker today): if the analytics dashboard or Player App needs to come back online mid-build, the in-progress rules / schema state of `playlive-25a17` must not break them. Likely fine — Phase 6 was always going to handle the schema migration for the other two apps — but worth being explicit about.

## Open questions for Guy

None outstanding. Phase 1 is fully unblocked.

**Recently resolved (27 May 2026):**

- Opening-balance source = Casinoware export. Exact field mapping deferred to Phase 1 task 1.8a.
- Satellite milestone chips = removed from play entirely on auto-removal.
- Staging Firebase project (task 0.4) **skipped** — building directly on shared `playlive-25a17`. Rationale: analytics dashboard and Player App not in active use due to current tournament-system blockers. Logged in DECISIONS.md.
- Read-only service account delivered at `C:\Users\green\.config\playlive\audit-sa.json`. Currently has `Editor` role (needed to read populated collections — narrower roles produced an inexplicable PERMISSION_DENIED pattern). Can be narrowed back down now that the audit is done.
- **Firestore audit complete.** Findings curated in `docs/schema/firestore-audit.md`.
- **(O1)** Drop the legacy Firestore `tournaments` collection; reclaim the name for the canonical schema. Casinoware CSVs + local audit dump are the backup paths. See DECISIONS.md.
- **(O2)** `dealerMinutes` is dealer-time / table-utilisation tracking for analytics. Preserved on canonical schema. How it's populated is a Phase 2 / Phase 4 UI concern. See DECISIONS.md.
- **(O3)** Claude proposes enum mapping in Phase 1 task 1.3; Guy reviews. Permission to split single legacy enum fields into multiple canonical fields if cleaner. See DECISIONS.md.
- **(O4)** CSV import sequencing — schema first (uninfluenced by legacy), tournament creation second, then field mapping (Guy + Claude collaboration in R1.0a), then import script (R1.0b). Phase 1 task 1.8a removed. See DECISIONS.md and Action Plan v0.5 changelog.

## Sync notes / housekeeping

- **SOW .docx and Action Plan .docx are now behind the markdown.** SOW markdown is v0.5; .docx is v0.4. Action Plan markdown is v0.4; .docx is v0.3. When Guy next refreshes the team-facing versions, both .docx files need updating from the markdown changelogs.

## Cross-app coordination notes

- **Analytics dashboard** (`C:\Users\green\Documents\playlive-analytics`) reads from `playlive-25a17` today. Phase 6 will update it for the new canonical schema.
- **Player App** (`C:\Users\green\Documents\PlayLiveApp\playlive_tournament_app`, Flutter) reads tournaments from `playlive-25a17`. Phase 6 will add read-only wallet views.
- All three apps share `playlive-25a17` — this is why task 0.4 (separate staging project) matters before Phase 1.

## Convention reminders

- Update this file (HANDOFF.md) at the end of every session.
- Architectural calls go in `docs/DECISIONS.md` and get their own ADR if they're significant.
- New scope ideas go in `docs/v1.5-plus-backlog.md`, **not** the v1 SOW. Promoting a v1.5+ item back into v1 requires a Cowork conversation with Guy and a DECISIONS.md entry.
