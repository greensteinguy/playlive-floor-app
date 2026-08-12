# CW TOURNAMENTS.csv ↔ prod reconciliation — findings

**Date:** 12 Aug 2026 · **Scripts:** `scripts/admin/reconcile-cw-csv*.cjs` (read-only; run with the admin service account) · **Inputs:** `CW TOURNAMENTS.csv` (1,667 rows, ATTID 6–1685, Apr 2025 → Aug 2026) vs prod `tournaments` (1,772 legacy docs, 2 canonical test docs).

## Headline findings

1. **`ATTID` is NOT the ingest's `ttid`.** Only 4 of 827 id-collisions share a tournament name; prod ttids run 537–3648. They are different Casinoware tables: the CSV is an **event-level** table, the ingest wrote **per-flight/per-day instance** docs. Any import keyed on ATTID must treat it as its own id namespace (do **not** write it into `legacyId` as if it were a ttid).

2. **Count semantics proven:** on clean name+date matches, `prod.totalPlayers = CSV "Number of Entries" + "Number of Re-Entries"` — exact in 239/261 cases. So for canonical mapping: `entryCount ← Entries + Re-Entries`, `uniquePlayerCount ≈ Entries`.

3. **The only workable join is name + start-date (±36h), and it's messy:** 353 clean 1:1, 600 ambiguous (multiple prod docs per CSV event — real flights AND zero-entry recurring-schedule clutter the ingest wrote; analytics hides those via its `totalPlayers > 0` filter), 714 CSV rows matching nothing.

4. **Two distinct gap eras in prod:**
   - **Apr–Jul 2025 (~278 CSV-only rows):** pre-ingest history — genuinely absent from Firestore. These are real gap-import candidates.
   - **Mar–Aug 2026 (~434 CSV-only rows):** the ingest-degradation era — consistent with the project's billing lapse killing `updateTournaments`, plus naming drift. June 2026 alone has 178 CSV-only rows *and* 88 prod-only docs, suggesting both missed syncs and name mismatches.

5. **286 prod-only docs**: post-export events (e.g. THE HYDRA flights, 12 Aug), flights whose event-level names differ, and scheduling clutter.

## Implications for the import plan

- The CSV **cannot** enrich existing prod docs (no money columns, no entries) and **cannot** be joined reliably enough to bulk-import beside them without creating duplicates for the ~600-ambiguous set.
- Its solid near-term value: **event-level skeletons for the pre-ingest era (Apr–Jul 2025)** where prod verifiably has nothing.
- Hole list at `../CW TOURNAMENTS`-adjacent `cw-reconciliation-holes.csv` is id-based and now superseded by the name+date analysis — regenerate on the name basis before any import.

## What to ask Casinoware for (the "richer extract" wishlist)

1. **The instance table keyed by TTID** (per flight/day), with started/finished, entries.
2. **The ATTID ↔ TTID link table** (event → its flights). This single table makes every join above deterministic and dissolves the ambiguity problem.
3. **Money per instance or event:** buy-in, fee/hospitality split, prize pool, guarantee.
4. **Per-entry rows:** ENID, player id + name, finishing place, winnings, play time — keyed to TTID.
5. Player master table (for dedupe against our `players`).

With (2) + (4), the full import → canonical shape becomes mechanical, the analytics supersede rule becomes the cutover mechanism, and the legacy-doc cull becomes safe.
