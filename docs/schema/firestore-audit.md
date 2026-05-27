# Firestore audit — `playlive-25a17`

> Phase 0 task 0.2. Status: **complete (27 May 2026).** Audit script lives at `scripts/firestore-audit/audit.js`; raw output (gitignored, contains PII) at `scripts/firestore-audit/output/`. This doc is the curated findings.

## Headline

The existing `playlive-25a17` Firestore has **one top-level collection (`tournaments`)** containing **1,695 documents** (Casinoware-style sequential numeric string IDs: `1000`, `1001`, …, ~`2694`). Players, entries, payouts, and blind structures all live as **nested arrays inside each tournament document**.

**Important context (added 27 May 2026 after Guy's correction):** the Firestore `tournaments` collection is **just what could be live-streamed out of Casinoware** — it's not the full source of truth. For everything else (clean player records with stable IDs, historical balances, anything else the venue tracks), Guy can **manually export CSVs from Casinoware directly**. This significantly de-risks the migration:

- Players don't have to be inferred via fuzzy-name dedup against `entries[]` — they come from a Casinoware CSV with stable IDs.
- Player balances for opening-balance import come from a Casinoware CSV, not derived.
- The Firestore `tournaments` collection is best treated as a **live-state snapshot**, not a migration source.

The canonical schema (Phase 1 task 1.3) is therefore a clean redesign. Migration (Phase 1 task 1.8a) becomes a **CSV ETL job**, not a Firestore-to-Firestore transformation. The legacy `tournaments` collection in Firestore can largely be left alone — analytics dashboard and Player App can keep reading it for historical view if needed, or we re-import historical tournaments from CSV into the canonical schema. That's open question O1 below.

## 1. Collections

| Name | Documents | Notes |
|---|---|---|
| `tournaments` | 1,695 | Only top-level collection. Every other "collection-shaped" concept (entries, payouts, levels, players-by-implication) lives inside tournament docs. |

Probe of common collection names that turned out to **not exist**: `players`, `entries`, `series`, `users`, `results`. None of these are top-level.

## 2. `tournaments` field shape

Sampled all 1,695 documents. Field presence and types:

| Field | Type | Presence | Meaning / notes |
|---|---|---|---|
| `ttid` | number | 100% | Casinoware tournament ID (numeric, matches doc id pattern). |
| `name` | string | 100% | Internal name. |
| `title` | string | 100% | Display title. Why both — unclear. |
| `shortDesc` | string | 100% | Short description. SOW v0.5 §3.1 expects this exact concept. |
| `gameType` | string | 100% | NLH / PLO / etc. Enum-as-string. |
| `buyIn` | number | 100% | **Stored as dollars, not cents.** Canonical schema = integer cents. |
| `fee` | number | 100% | Tournament fee. Same dollars-not-cents issue. |
| `guaranteed` | number | 100% | Guarantee amount. Dollars. |
| `prizepool` | number | 100% | Actual prize pool. Dollars. |
| `totalCost` | number | 100% | Probably buyIn + fee. Dollars. |
| `startingStack` | number | 100% | Chip count (not money). |
| `totalChips` | number | 100% | Chip count (not money). |
| `averageChips` | number | 100% | Chip count (not money). |
| `totalPlayers` | number | 100% | Cumulative entries. |
| `remainingPlayers` | number | 100% | Live count. |
| `currentLevel` | number | 100% | Live blind level index. |
| `lateReg` | number | 100% | Whether late-reg open or cutoff time (TBD by reading more samples). |
| `status` | number | 100% | Enum. Likely 0=scheduled, 1=running, 2=finished — needs reverse-engineering. |
| `published` | number | 100% | Enum. Booleanish but stored as number. |
| `isRegistered` | boolean | 100% | The only proper boolean in the schema. Per-tournament flag, meaning unclear. |
| `color` | string | 100% | UI styling baked into data, e.g. `"rgb(128,0,255)"`. Drop on migration. |
| `startUtc` | timestamp | 100% | Tournament start, UTC. Real Firestore Timestamp. |
| `startLocal` | timestamp | 100% | Tournament start, venue-local. Also a Timestamp, but redundant with `startUtc` given Firestore stores UTC + we render locally. |
| `regoEnds` | timestamp \| null | 100% | Late-reg cutoff. Nullable. |
| `finishedLocal` | timestamp \| null | 100% | Tournament end. Nullable while live. |
| `lastUpdated` | timestamp | 100% | Standard mtime. |
| `levelDuration` | number | 90% | Default minutes per level. |
| `breakDuration` | number | 90% | Default break minutes. |
| `totalStructureDuration` | number | 90% | Sum across levels. |
| `totalTournamentRunTime` | number | 90% | Computed at end? |
| `dealerMinutes` | number | 90% | Probably dealer-tip / dealer-time accounting. Investigate before mapping. |
| `payouts` | array | 100% | Nested payout structure. See §2.1. |
| `entries` | array | 100% | Nested entries. See §2.2. |
| `levels` | array | 100% | Nested blind structure. See §2.3. |

### 2.1 `payouts` (nested)

One array element per saved payout structure. In the sample, length 1.

```
payouts: [
  {
    PTID: 1,
    startentries: 2,
    curs: [0],                            // currency IDs, [0] = single-currency
    pos: [                                // one entry per paying position
      { POID: 1, place: 1, pvs: { "0": { ID: 0, value: 1080, percent: 0.4 } } },
      { POID: 2, place: 2, pvs: { "0": { ID: 0, value: 680,  percent: 0.2518... } } },
      ...
    ]
  }
]
```

Notes:
- `pvs` is a **map keyed by numeric string** (`"0"`, `"1"`, …), not an array. See §3.
- `value` is dollars.
- Five paying positions in this sample tournament.

### 2.2 `entries` (nested)

Sample tournament has 18 entries. Per-entry shape:

```
{
  ENID: 12670,                  // Casinoware entry ID
  dname: "Mathew, Kevin",       // display name, surname-first
  fname: "Kevin",               // first name
  lname: "Mathew",              // last name
  ensign: "AU",                 // country code, used for flag display
  address: -1,                  // sentinel for "no address". Negative one as null is a Casinoware idiom.
  place: 2,                     // finishing position
  ptime: 14132,                 // probably elapsed play time in seconds (≈3h55m, plausible)
  anonymous: 0,                 // 0/1 boolean
  bounties: { "0": { win: 200 } },        // sparse-array-as-map. See §3.
  winnings: { "0": { value: 1030 } }       // same.
}
```

**The migration-relevant pain point:** there is **no `playerId` or stable reference** to a player record. Entries only carry name fields. To build a top-level `players` collection, we have to fuzzy-match (fname + lname + maybe ensign) across all 1,695 tournaments' entries arrays.

Estimated unique players: tens of thousands of entries total → likely a few thousand unique players after dedup. Phase 1 task 1.8 (duplicate-player merge tool) becomes very important.

### 2.3 `levels` (nested)

Sample has 24 elements (blind levels). Shape:

```
{
  ID: 1,                  // sequential level number (gaps possible — sample jumps from ID:1 to ID:25 by the end, suggesting breaks or unused levels)
  ante: 200,
  bigblind: 200,
  smallblind: 100,
  bringin: 0,             // stud-variant bring-in
  duration: 15,           // minutes
  smallestchip: 0,        // chip denomination floor
  breakduration: 0,       // break after this level (0 = no break)
  colorupduration: 0      // color-up time after this level
}
```

Maps reasonably cleanly to the canonical blind-structure shape. The `ID` numbering and gaps need a closer look — possibly Casinoware reserves IDs for breaks even when removed.

## 3. The "sparse-array-as-map" pattern

Casinoware exports represent sparse or ordered collections as **objects keyed by numeric string** rather than as arrays:

```
bounties: { "0": { win: 200 }, "1": { win: 350 } }
```

Reads naturally as `bounties[0]`, `bounties[1]`, etc. but is stored as a JSON object. Three places this appears in the data:

- `entries[].bounties`
- `entries[].winnings`
- `payouts[].pos[].pvs`

The validator (Phase 1 task 1.4) and the migration (1.8a) should both detect and unwrap this into normal arrays. Trivial to do — just `Object.values()` ordered by numeric key.

## 4. Data quality findings

Going through what's actually in the database:

| Finding | Severity | What to do |
|---|---|---|
| **Money stored as plain dollar numbers**, not integer cents. Affects `buyIn`, `fee`, `guaranteed`, `prizepool`, `totalCost`, payout `value`, bounty `win`, winnings `value`. | High | Migration multiplies by 100, validator asserts integer cents on the new side. |
| **No stable player identity in Firestore.** Players are entry-string-only in the live-streamed data. | Low (was High) | Not actually a migration problem — clean player records with stable IDs come from a Casinoware CSV export, not from the Firestore `entries[]` arrays. Phase 1 task 1.8 (merge tool) is still needed for ongoing dedup of duplicates entered by floor staff, but isn't on the critical migration path. |
| **Sparse-array-as-map** in three nested locations. | Medium | Unwrap during migration. Validator should reject these in canonical schema. |
| **Sentinel `-1` for "missing address"** on entries. | Medium | Normalise to `null` in canonical schema. |
| **`color: "rgb(...)"`** baked into tournament docs. | Low | Drop during migration — display styling belongs in the app. |
| **Redundant `name` + `title`** (and `shortDesc`). | Low | Investigate before migration to confirm semantics, then map to a single `name` + the existing `shortDesc`. |
| **Redundant `startUtc` + `startLocal`.** | Low | Migration keeps `startUtc` only; UI renders local. |
| **Enum-as-number** for `status` and `published`. | Low | Reverse-engineer the enum values from samples, store as canonical string enums in the new schema. |
| **No wallet / ticket / withdrawal data at all.** | n/a | Expected — these collections are 100% new in v1. |
| **Document IDs are numeric strings**, not Firestore-style UUIDs. | Low | Keep the existing IDs on existing docs (don't break the analytics dashboard / Player App reads); new docs use UUIDs per canonical convention. |

## 5. Implications for the canonical schema and migration

Pulling the above together:

- **Phase 1 task 1.3 (canonical schema)** can largely proceed against the SOW shapes — none of the existing schema is worth preserving wholesale. The canonical shape is a real redesign, not a normalisation.
- **Phase 1 task 1.4 (Zod validators)** should reject the sparse-array-as-map and money-as-float patterns explicitly with clear errors. That way any leakage from legacy data during the migration window is loud.
- **Phase 1 task 1.7 (wallet ledger module)** is unaffected — wallet data is 100% net-new.
- **Phase 1 task 1.8 (duplicate-player merge tool)** becomes very important. The fuzzy-match heuristics need to be solid because the dedup has to work across thousands of tournaments and tens of thousands of entries.
- **Phase 1 task 1.8a (existing-record import)** is the heavy lift:
  1. Walk all 1,695 tournament docs.
  2. For each entry, build/reuse a player record (fuzzy-match against running set).
  3. Emit canonical `tournaments` (new shape, new collection? TBD — see §6), `entries`, `players`.
  4. Money fields → cents.
  5. Sparse maps → arrays.
  6. Log every import decision into `auditLog`.
  7. Existing wallet balances import as `walletTransactions` rows of type `deposit` with `reference = "opening_balance"` (per SOW v0.5 §7).

## 6. Decisions still pending (small, for Phase 1 design time)

These don't need answering today — they come up the moment Phase 1 task 1.3 starts. Flagging here so they're not forgotten.

1. **Same `tournaments` collection or a new one?** Two options:
   - (a) New canonical docs into the same `tournaments` collection alongside legacy docs (with a `schemaVersion` field discriminator). Risk: a consuming app that reads naively could mix the two.
   - (b) New canonical docs into a separate collection like `tournaments_v2`, with the analytics dashboard / Player App adaptors (Phase 6) routing reads appropriately during the transition window.
   - Lean: (b) is cleaner; (a) is faster.

2. **What to do with the `dealerMinutes` field.** Looks like dealer-tip accounting. May be venue-internal info that doesn't belong in the canonical tournament shape, or may be load-bearing. Confirm with Guy when we get to Phase 1.

3. **How `status` and `published` enum values map.** Need a small reverse-engineering pass once we read a wider sample of in-flight vs finished tournaments.

4. **Whether `lateReg` is a boolean-as-number, a cutoff time, or something else.** Unclear from one sample. Easy to clarify by sampling a few docs of different statuses.

## 7. How to re-run the audit

Read-only and idempotent — safe to re-run any time. From the repo root:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/c/Users/green/.config/playlive/audit-sa.json \
  node scripts/firestore-audit/audit.js
```

Outputs land in `scripts/firestore-audit/output/` (gitignored). To compare against a previous run, diff the `audit-report.json` files.

**Note on IAM:** the SA currently has `Editor` role at project level — broader than the originally-planned `Cloud Datastore Viewer`. The narrower roles were attempted but produced an inexplicable PERMISSION_DENIED pattern (empty collections accessible, populated `tournaments` denied) even after granting both `roles/viewer` and `roles/datastore.viewer`. Once the audit is no longer needed, the role can be narrowed back down or the SA disabled.
