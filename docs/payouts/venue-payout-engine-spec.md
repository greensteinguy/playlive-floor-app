# Venue Payout Engine — reverse-engineered spec

**Source:** `Payout Calculator.xlsx` (Guy, 10 Aug 2026) — sheets `PAYOUT CALCULATOR` (front end) + `DO NOT TOUCH` (engine). Formulas extracted cell-by-cell; the worked scenario (72 entries, $100 buy-in, $50 hospitality) reproduces the CSV exactly and is the canonical test fixture.

**Architecture directive (Guy, 10 Aug):** the calculation runs **once per tournament** (re-run on entry events while registration is open), its output is **stored on the tournament**, and **every screen reads the stored table**. No per-screen on-demand derivation — this replaces the current `materializePayouts`-at-render pattern used by the payouts screen and the TV display.

---

## Inputs

| Input | Sheet cell | Notes |
|---|---|---|
| entries | C5 | live entry count |
| buyIn | C8 | prize-pool contribution per entry ($100) |
| hospitality | C10 | per-entry hospitality ($50); ticket = buyIn + hospitality |
| addOnCount, addOnPrice | C6, C9 | add-on economics (0 in fixture) |
| handedness | C7 | `9 Handed` \| `6 Handed` \| `Mix Max` |
| spotsRatio ("1 in X paid") | C15 | 9 in fixture |
| minCashMultiplier | via C9-front | `1.5x` \| `1.75x` \| `2x` of the full ticket |
| guarantee | C22 | optional |
| equityRefunds | C12 | optional deduction (multi-day equity payouts) |
| manual per-place extras | column G | per-row manual adjustment, subtracted from pool before distribution (probably out of v1 scope) |

## Algorithm

1. **Pools.** `ticket = buyIn + hospitality`. `rawPool = entries×buyIn + addOnCount×addOnPrice`. `pool = rawPool > guarantee ? rawPool : guarantee` (house overlays the difference). `adjPool = pool − equityRefunds − Σ(manual extras)`.
2. **Places paid.** `adjEntries = adjPool / buyIn` (so a guarantee-inflated pool pays more places); `placesPaid = round(adjEntries / spotsRatio + 2)`. Fixture: round(72/9 + 2) = 10. ← this is the "+2" that turned 8 into 10.
3. **Min-cash.** `minCash = ticket × multiplier`. Fixture: 150 × 1.75 = $262.50.
4. **Bands.** A handedness-specific boundary ladder marks where paid places group into "x to y" rows:
   - 9-Handed: 1,2,3,4,5,6,7,8,9,12,15,18,27,36,45,…
   - 6-Handed: 1,2,3,4,5,6,9,12,18,24,30,36,(36+12)…
   - Mix Max: 1,2,4,8,12,18,24,30,36,45,54,63,81,108,…
   Boundaries ≥ placesPaid drop; the last surviving band extends to placesPaid; then the LARGEST band's size is smoothed by the sheet's T-column rule (split into ~thirds: `ROUNDDOWN((s_next+s)/3)` / `ROUND((s+s_prev)/3)` / remainder) so the tail doesn't end in one huge lump.
5. **Share curve** (X column), from the bottom row up: bottom = 1 share (= min-cash). Each row up multiplies by the solved tail ratio **Y**; the 3rd-place row instead multiplies by `(Y+φ)/2` and the 2nd and 1st rows by **φ = (1+√5)/2** (golden ratio — the sheet literally encodes `(1+SQRT(5))/2`). Result: ~1.15× steps through the tail, ~1.6× jumps at the top.
6. **Solve Y** so shares exhaust the pool: target `Σ(share_row × bandSize_row) = adjPool / minCash`. The sheet does this with a circular hill-climb (`C20`: +0.001 / −0.00001 until the residual `C19` is within ±entries/2000). **We implement bisection to the same tolerance** — deterministic, no iteration-order dependence. Fixture solves Y ≈ 1.14707.
7. **Amounts.** `amount_row = round(share × minCash)` with tiered rounding: nearest $10; nearest $100 above $5,000; nearest $1,000 above $100,000. Then **1st place = adjPool − Σ(all other rows' totals)** — the residue, unrounded (fixture: $2,150).
8. **Sanity gate** (front sheet I2): flag the table when `1st/2nd < 1.59` (❌) or `> 1.7` (blank); ✅ inside [1.59, 1.7]. Fixture: 2150/1340 = 1.604 ✅. Surface this as a warning, not a hard failure.
9. **POINTS** (series toggle — Guy 10 Aug: series-time only, must be toggleable). `topPoints = √(entries × hospitality)` — fixture √(72×50) = √3600 = 60 exactly. Per paid **row** (band members share the value), linear from `topPoints` at 1st down to `topPoints/10` at the last row: `top×0.1 + (top×0.9/(rows−1))×(rows−row)`. Fixture: 60,54,48,…,12,6 (step 6).

## Canonical fixture (must-pass test)

entries 72, buyIn $100, hospitality $50, spots 9, 9-Handed, minCash 1.75x, no guarantee/refunds/add-ons →
pool $7,200 · places 10 · minCash $262.50 → payouts **2150, 1340, 830, 600, 520, 450, 400, 350, 300, 260** (sum = pool) · ratio gate ✅ (1.604) · points **60, 54, 48, 42, 36, 30, 24, 18, 12, 6**.

## Integration design (per Guy's run-once directive)

- Pure engine in `src/lib/payoutEngine.js` (cents in/out, injected inputs, zero Firestore) + fixture tests.
- Stored output: `tournament.payoutTable` (rows: fromPlace/toPlace/amount/points), plus computedAt + an inputs snapshot for audit. Zod schema addition → **shared-schema change: canonical-schema update + analytics heads-up.**
- Recompute policy (proposed, needs Guy's ratification): auto-recompute inside/after entry-affecting ops (register, void) while reg is open; **freeze at lateRegClosed**; manager-only manual recompute after that. Screens (payouts, results, `/display` prizes slide) read ONLY the stored table.

## Open questions for Guy

1. **Points = √(entries × hospitality)** — confirm this is intended (points scale with hospitality $; a $0-hospitality event gets 0 points). Is hospitality effectively the "event tier" knob?
2. Recompute/freeze policy above OK? ("once per tournament, perhaps additionally for each entry" — proposed reading: every entry event until lateRegClosed, frozen after.)
3. Where do the new knobs live — per tournament with template defaults? (spotsRatio default 9, minCash default 1.75x, handedness; hospitality already exists.)
4. Add-ons and equity refunds: in v1 scope, or park? (Add-ons aren't modeled in the app at all today.)
5. The workbook's other machinery — GREENBACK CALCULATOR, BOUNTY CALCULATOR, PLAYER OF THE SERIES (incl. a fixed $50K series-prize split), TRANSFERS, DEALERS PAYROLL — treated as out of scope for the payout engine. Confirm.

## Sheet quirks deliberately NOT reproduced

- The circular-reference hill-climb (replaced by bisection to the same tolerance).
- The `C31` "COPY/PASTE if broken" repair cell and `DELETE ->` scratch cells.
- Excel float artifacts; we compute in integer cents where possible and only the share solve in floats.
