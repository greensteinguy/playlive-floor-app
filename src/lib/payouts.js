// Payout-structure generation helpers for the payout editor (task 2.3).
//
// The venue currently fills payouts from a CSV that runs its own algorithm over
// (number of entries, total prize pool, percent of field paid). That exact
// algorithm will replace `payoutCurve` here once Guy supplies the CSV — until
// then this produces a sane, monotonic-descending placeholder curve so the
// editor is usable end-to-end. `paidPlaceCount` and `applyRounding` are the
// stable parts; the curve shape is the part that's a stand-in.
//
// Everything here is pure (no Firestore, no React) so it's trivially testable
// and safe to swap out.

/**
 * How many places get paid for a field of `entryCount`, paying `percentPaid`
 * (a fraction 0..1) of the field. round(entries × pct), floored at 1 — you
 * always pay at least first. Returns 0 when there are no entries yet (the editor
 * uses that to fall back to the current row count).
 *
 * @param {number} entryCount
 * @param {number} percentPaid  fraction in [0, 1]
 * @returns {number}
 */
export function paidPlaceCount(entryCount, percentPaid) {
  if (!Number.isFinite(entryCount) || entryCount <= 0) return 0
  if (!Number.isFinite(percentPaid) || percentPaid <= 0) return 0
  return Math.max(1, Math.round(entryCount * percentPaid))
}

/**
 * PLACEHOLDER payout curve. Returns `count` fractions in (0, 1] that sum to
 * exactly 1, strictly descending by place (place 1 heaviest). Uses simple
 * triangular rank weights (N, N-1, …, 1); the last place absorbs the rounding
 * remainder so the fractions sum to exactly 1 with no floating-point drift.
 *
 * This is deliberately simple and obviously a stand-in — the venue's CSV
 * algorithm (entries + prize pool + percent paid) replaces it later. Fractions
 * are quantised to 4 decimal places (0.01% granularity), which is finer than
 * the editor's one-decimal percent display.
 *
 * @param {number} count  number of paid places
 * @returns {number[]}    fractions summing to 1
 */
export function payoutCurve(count) {
  if (!Number.isFinite(count) || count <= 0) return []
  if (count === 1) return [1]

  let total = 0
  const weights = []
  for (let i = 0; i < count; i++) {
    const w = count - i // N, N-1, …, 1
    weights.push(w)
    total += w
  }

  const fractions = weights.map((w) => Math.round((w / total) * 10000) / 10000)
  // Last place takes whatever's left so the sum is exactly 1 despite rounding.
  const head = fractions.slice(0, -1).reduce((a, b) => a + b, 0)
  fractions[fractions.length - 1] = Math.round((1 - head) * 10000) / 10000
  return fractions
}

/**
 * Round a cash amount (integer or fractional cents) to the structure's rounding
 * rule. 'nearest5' / 'nearest10' round to the nearest $5 / $10 (poker payouts
 * round to whole-dollar steps, not cents); 'none' rounds to the nearest whole
 * cent. Used for the editor's live cash preview and, later, the end-of-tournament
 * cash conversion.
 *
 * @param {number} cents
 * @param {'nearest5'|'nearest10'|'none'} rounding
 * @returns {number}  integer cents
 */
export function applyRounding(cents, rounding) {
  if (rounding === 'nearest5') return Math.round(cents / 500) * 500
  if (rounding === 'nearest10') return Math.round(cents / 1000) * 1000
  return Math.round(cents)
}
