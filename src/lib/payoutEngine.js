// Venue payout engine — a faithful translation of the venue's spreadsheet
// (`Payout Calculator.xlsx`, hidden sheet "DO NOT TOUCH"; reverse-engineered
// cell-by-cell in docs/payouts/venue-payout-engine-spec.md). Guy's ruling
// (10 Aug 2026): THE SHEET IS GOSPEL — where this file deviates (each spot
// commented), it is only to make the sheet's behaviour deterministic or to
// fail gracefully where the sheet would sit unconverged.
//
// Pure module: money in integer CENTS at the boundary, the sheet's own
// dollar arithmetic internally. No Firestore, no React. The run-once/stored
// -table wiring (Guy's architecture directive) lives with the callers.
//
// Sheet cell references (C13, X7, …) in comments name the original formulas.

const PHI = (1 + Math.sqrt(5)) / 2 // the sheet literally encodes (1+SQRT(5))/2

export const HANDEDNESS_OPTIONS = ['9handed', '6handed', 'mixmax']

// ── Band-boundary ladders (column P) ────────────────────────────────────────
// Explicit heads straight from rows 5–24, then the sheet's recursive
// continuation (row 25+): 9-handed & mix-max P(n) = P(n-1) + P(n-6);
// 6-handed P(n) = P(n-1) + P(n-5) (its recursion starts at row 17).
const LADDER_HEADS = {
  '9handed': [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 18, 27, 36, 45, 54, 63, 81, 108, 144],
  '6handed': [1, 2, 3, 4, 5, 6, 9, 12, 18, 24, 30, 36],
  mixmax: [1, 2, 4, 8, 12, 18, 24, 30, 36, 45, 54, 63, 81, 108],
}
const LADDER_LAG = { '9handed': 6, '6handed': 5, mixmax: 6 }

export function bandLadder(handedness, upTo) {
  const ladder = [...LADDER_HEADS[handedness]]
  const lag = LADDER_LAG[handedness]
  while (ladder[ladder.length - 1] < upTo) {
    ladder.push(ladder[ladder.length - 1] + ladder[ladder.length - lag])
  }
  return ladder
}

// Excel ROUND (half away from zero) at a bucket size; Excel ROUNDDOWN = trunc.
function excelRound(x, bucket) {
  return Math.sign(x) * Math.round(Math.abs(x) / bucket) * bucket
}

// AB column: tiered rounding — nearest $10, $100 above $5,000, $1,000 above $100,000.
function tierRound(dollars) {
  const bucket = dollars > 100000 ? 1000 : dollars > 5000 ? 100 : 10
  return excelRound(dollars, bucket)
}

/**
 * Band construction — columns Q/R/S/T/U of the sheet.
 * Returns rows of { size } where size is the T-column value (places in the
 * row), in order, summing to placesPaid. The largest band and its
 * predecessor are redistributed into ~thirds across three rows (the sheet's
 * T-column smoothing), which is why a "spill" row can exist past the ladder.
 */
export function buildBands(handedness, placesPaid) {
  const ladder = bandLadder(handedness, placesPaid)
  // Q/R: boundaries strictly below placesPaid survive; the largest surviving
  // boundary's row is extended to placesPaid.
  const kept = ladder.filter((p) => p < placesPaid)
  if (kept.length === 0) return placesPaid >= 1 ? [{ size: 1 }] : []
  const R = kept.map((p, i) => (i === kept.length - 1 ? placesPaid : p))

  // S: band sizes. S(row 1) = 1 by the sheet's constant.
  const S = R.map((r, i) => (i === 0 ? 1 : r - R[i - 1]))
  const maxS = Math.max(...S)

  // T: the smoothing pass, translated verbatim (T row 1 is the sheet's
  // constant 1; blank cells become null). Evaluated top-down like the sheet.
  const T = []
  const sAt = (i) => (i >= 0 && i < S.length ? S[i] : null)
  const tAt = (i) => (i >= 0 && i < T.length ? T[i] : 0)
  const rowCount = S.length + 1 // the spill row after the ladder rows
  for (let i = 0; i < rowCount; i++) {
    if (i === 0) {
      T.push(1)
      continue
    }
    const s = sAt(i)
    const sNext = sAt(i + 1)
    const sPrev = sAt(i - 1)
    const sPrev2 = sAt(i - 2)
    if (sNext !== null && sNext === maxS) {
      T.push(Math.trunc((sNext + s) / 3)) // ROUNDDOWN((S_next+S)/3)
    } else if (s !== null && s === maxS) {
      T.push(excelRound((s + (sPrev ?? 0)) / 3, 1)) // ROUND((S+S_prev)/3)
    } else if (sPrev !== null && sPrev === maxS) {
      T.push(sPrev + (sPrev2 ?? 0) - tAt(i - 1) - tAt(i - 2)) // the remainder
    } else if (s !== null) {
      T.push(s)
    } else {
      break // blank T — the paid rows have ended
    }
  }

  // U: cumulative places. Rows keep only positive sizes (a 0-size row can
  // fall out of the thirds split for tiny bands — the sheet renders it as an
  // empty band; we drop it, keeping cumulative places identical).
  const rows = []
  let cum = 0
  for (const size of T) {
    if (cum >= placesPaid) break
    if (size > 0) {
      rows.push({ size })
      cum += size
    }
  }
  return rows
}

// Share curve (column X), top-down list for R rows and a given tail ratio y:
// bottom row = 1; going up ×y per row, except the 3rd-from-top row multiplies
// by (y+φ)/2 and the top two rows by φ (rows 5/6/7 of the sheet).
function shareCurve(rowCount, y) {
  const X = new Array(rowCount)
  for (let i = rowCount - 1; i >= 0; i--) {
    if (i === rowCount - 1) X[i] = 1
    else if (i === 0 || i === 1) X[i] = X[i + 1] * PHI
    else if (i === 2) X[i] = X[i + 1] * ((y + PHI) / 2)
    else X[i] = X[i + 1] * y
  }
  return X
}

/**
 * The sheet's iterative solve for the tail ratio (cell C20): step +0.001
 * while the share total is short of the target, step −0.00001 while it
 * overshoots, stop inside ±entries/2000 shares. The sheet's converged value
 * is path-dependent (it iterates from whatever was last saved); we make it
 * deterministic by always seeding at 1.0 — the fixture reproduces exactly.
 */
function solveTailRatio(rows, targetShares, entries) {
  const tol = entries / 2000
  const sizes = rows.map((r) => r.size)
  const total = (y) => {
    const X = shareCurve(sizes.length, y)
    return X.reduce((sum, x, i) => sum + x * sizes[i], 0)
  }
  let y = 1.0
  for (let i = 0; i < 500_000; i++) {
    const residual = targetShares - total(y)
    if (residual > -tol && residual < tol) return { y, converged: true }
    y += residual > 0 ? 0.001 : -0.00001
    if (y <= 0.5) return { y: 0.5, converged: false } // sheet would spin forever
  }
  return { y, converged: false }
}

/**
 * Compute the venue payout table. All money inputs/outputs in integer cents.
 *
 * @param {object} opts
 *   entries            — live entry count (> 0)
 *   buyInCents         — prize-pool contribution per entry (C8)
 *   hospitalityCents   — per-entry hospitality (C10)
 *   addOnCount         — number of add-ons sold (C6), default 0
 *   addOnPriceCents    — price per add-on (C9), default 0
 *   handedness         — '9handed' | '6handed' | 'mixmax' (C7)
 *   spotsRatio         — "1 in X paid" (C15), default 9
 *   minCashMultiplier  — 1.5 | 1.75 | 2 (front C9), default 1.75
 *   guaranteeCents     — advertised guarantee (C22), default 0
 *   equityRefundsCents — equity refunds deducted from the pool (C12), default 0
 *   includePoints      — series toggle (Guy 10 Aug): emit per-row points
 *
 * @returns {{
 *   ok: boolean, warnings: string[],
 *   prizePoolCents, adjPrizePoolCents, placesPaid, minCashCents,
 *   firstToSecondRatio: number|null, ratioFlag: 'ok'|'low'|'high'|null,
 *   tailRatio: number,
 *   rows: [{ fromPlace, toPlace, size, amountCents, rowTotalCents, points }],
 * }}
 */
export function computeVenuePayouts({
  entries,
  buyInCents,
  hospitalityCents = 0,
  addOnCount = 0,
  addOnPriceCents = 0,
  handedness = '9handed',
  spotsRatio = 9,
  minCashMultiplier = 1.75,
  guaranteeCents = 0,
  equityRefundsCents = 0,
  includePoints = false,
}) {
  const warnings = []
  if (!Number.isInteger(entries) || entries < 1 || !(buyInCents > 0) || !(spotsRatio > 0)) {
    return emptyResult('invalid inputs')
  }
  if (!LADDER_HEADS[handedness]) return emptyResult(`unknown handedness ${handedness}`)

  // The sheet works in dollars; so do we, converting back to cents at the end.
  const buyIn = buyInCents / 100
  const hospitality = hospitalityCents / 100
  const addOnPrice = addOnPriceCents / 100
  const guarantee = guaranteeCents / 100
  const equityRefunds = equityRefundsCents / 100

  // C23 / C11: pool = raw (incl. add-ons) when entries×buyIn beats the
  // guarantee, else the guarantee (house overlays).
  const rawFromEntries = entries * buyIn // C23 (deliberately excludes add-ons, per sheet)
  const rawPool = entries * buyIn + addOnCount * addOnPrice
  const prizePool = rawFromEntries > guarantee ? rawPool : guarantee
  // C13: adjusted pool (the sheet also subtracts manual column-G extras — out
  // of v1 scope, spec Q-list).
  const adjPool = prizePool - equityRefunds
  if (!(adjPool > 0)) return emptyResult('non-positive prize pool')

  // C14 / C16: places paid = ROUND(adjEntries / spotsRatio + 2).
  const adjEntries = adjPool / buyIn
  let placesPaid = excelRound(adjEntries / spotsRatio + 2, 1)
  if (placesPaid > entries) {
    // Sheet has no guard — flag it rather than silently pay ghosts.
    warnings.push(`places paid (${placesPaid}) exceeds entries (${entries})`)
  }

  // C34 / C17: min-cash = average full ticket × multiplier.
  const avgTicket = (entries * (buyIn + hospitality) + addOnCount * addOnPrice) / entries
  const minCash = avgTicket * minCashMultiplier

  // Bands + solved share curve.
  const rows = buildBands(handedness, placesPaid)
  const targetShares = adjPool / minCash // C18
  const solved = solveTailRatio(rows, targetShares, entries)
  if (!solved.converged) {
    warnings.push('share solve did not converge — check pool vs min-cash configuration')
  }
  const X = shareCurve(rows.length, solved.y)

  // AA/AB/AC: amounts. First row takes the pool residue unrounded (AC5).
  const amounts = X.map((x) => tierRound(x * minCash))
  let othersTotal = 0
  for (let i = 1; i < rows.length; i++) othersTotal += amounts[i] * rows[i].size
  if (rows.length > 0) amounts[0] = adjPool - othersTotal

  // Points (columns N/J): top = √(entries × hospitality dollars), linear down
  // to top/10 across the paid ROWS (band members share the row's value).
  const topPoints = Math.sqrt(entries * hospitality)
  const rowCount = rows.length
  const pointsFor = (i) =>
    i === rowCount - 1
      ? topPoints / 10
      : topPoints * 0.1 + ((topPoints * 0.9) / (rowCount - 1)) * (rowCount - 1 - i)

  let fromPlace = 1
  const outRows = rows.map((r, i) => {
    const row = {
      fromPlace,
      toPlace: fromPlace + r.size - 1,
      size: r.size,
      amountCents: Math.round(amounts[i] * 100),
      rowTotalCents: Math.round(amounts[i] * r.size * 100),
      points: includePoints ? pointsFor(i) : null,
    }
    fromPlace += r.size
    return row
  })

  // Front-sheet I2 sanity gate on the 1st/2nd ratio.
  let firstToSecondRatio = null
  let ratioFlag = null
  if (outRows.length >= 2 && outRows[1].amountCents > 0) {
    firstToSecondRatio = outRows[0].amountCents / outRows[1].amountCents
    ratioFlag = firstToSecondRatio > 1.7 ? 'high' : firstToSecondRatio > 1.59 ? 'ok' : 'low'
  }

  return {
    ok: warnings.length === 0,
    warnings,
    prizePoolCents: Math.round(prizePool * 100),
    adjPrizePoolCents: Math.round(adjPool * 100),
    placesPaid,
    minCashCents: Math.round(minCash * 100),
    firstToSecondRatio,
    ratioFlag,
    tailRatio: solved.y,
    rows: outRows,
  }

  function emptyResult(reason) {
    return {
      ok: false,
      warnings: [reason],
      prizePoolCents: 0,
      adjPrizePoolCents: 0,
      placesPaid: 0,
      minCashCents: 0,
      firstToSecondRatio: null,
      ratioFlag: null,
      tailRatio: 1,
      rows: [],
    }
  }
}
