import { describe, it, expect } from 'vitest'
import { paidPlaceCount, payoutCurve, applyRounding, materializePayouts } from './payouts'
import { PayoutStructure } from './schema/payoutStructure'

describe('paidPlaceCount', () => {
  it('is round(entries × pct), floored at 1', () => {
    expect(paidPlaceCount(100, 0.15)).toBe(15)
    expect(paidPlaceCount(120, 0.15)).toBe(18)
    expect(paidPlaceCount(101, 0.15)).toBe(15) // round(15.15)
    expect(paidPlaceCount(10, 0.15)).toBe(2) // round(1.5) → 2
    expect(paidPlaceCount(3, 0.15)).toBe(1) // round(0.45) → 0, floored to 1
  })

  it('returns 0 when there are no entries or a non-positive percent', () => {
    expect(paidPlaceCount(0, 0.15)).toBe(0)
    expect(paidPlaceCount(100, 0)).toBe(0)
    expect(paidPlaceCount(100, -0.1)).toBe(0)
  })

  it('returns 0 for non-finite input', () => {
    expect(paidPlaceCount(NaN, 0.15)).toBe(0)
    expect(paidPlaceCount(100, NaN)).toBe(0)
  })
})

describe('payoutCurve', () => {
  it('handles the degenerate counts', () => {
    expect(payoutCurve(0)).toEqual([])
    expect(payoutCurve(-3)).toEqual([])
    expect(payoutCurve(1)).toEqual([1])
  })

  it('sums to exactly 1 across a wide range of counts', () => {
    for (let n = 1; n <= 50; n++) {
      const curve = payoutCurve(n)
      expect(curve).toHaveLength(n)
      const sum = curve.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 9)
    }
  })

  it('is strictly descending with every share positive', () => {
    const curve = payoutCurve(10)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeLessThan(curve[i - 1])
      expect(curve[i]).toBeGreaterThan(0)
    }
  })

  it('matches the triangular weights for a small field', () => {
    // weights [3,2,1] / 6 → [0.5, 0.3333, last absorbs remainder]
    const curve = payoutCurve(3)
    expect(curve[0]).toBeCloseTo(0.5, 4)
    expect(curve[1]).toBeCloseTo(0.3333, 4)
    expect(curve[2]).toBeCloseTo(0.1667, 4)
  })

  it('produces a schema-valid byPercent PayoutStructure (the seam the editor relies on)', () => {
    for (const n of [1, 2, 9, 27]) {
      const structure = {
        type: 'byPercent',
        rounding: 'nearest5',
        positions: payoutCurve(n).map((percent, i) => ({ place: i + 1, payout: 0, percent })),
      }
      expect(PayoutStructure.safeParse(structure).success).toBe(true)
    }
  })
})

describe('applyRounding', () => {
  it('rounds to the nearest $5', () => {
    expect(applyRounding(1834, 'nearest5')).toBe(2000) // $18.34 → $20
    expect(applyRounding(1200, 'nearest5')).toBe(1000) // $12 → $10
    expect(applyRounding(1300, 'nearest5')).toBe(1500) // $13 → $15
    expect(applyRounding(0, 'nearest5')).toBe(0)
  })

  it('rounds to the nearest $10', () => {
    expect(applyRounding(1834, 'nearest10')).toBe(2000) // $18.34 → $20
    expect(applyRounding(1400, 'nearest10')).toBe(1000) // $14 → $10
    expect(applyRounding(1600, 'nearest10')).toBe(2000) // $16 → $20
  })

  it("rounds to the nearest whole cent for 'none'", () => {
    expect(applyRounding(1834.6, 'none')).toBe(1835)
    expect(applyRounding(1834.4, 'none')).toBe(1834)
    expect(applyRounding(1834, 'none')).toBe(1834)
  })
})

describe('materializePayouts', () => {
  const byPercent = (positions, rounding = 'nearest5') => ({ type: 'byPercent', rounding, positions })
  const pos = (place, percent) => ({ place, payout: 0, percent })

  it('byPercent: rounds each place to the rounding step and dumps the residue on 1st', () => {
    // Pool $1,230 (24 × ~$51.25); 50/30/20 at nearest $5:
    //   raw 615.00 / 369.00 / 246.00 → rounded 615 / 370 / 245 = 1230 exactly here,
    // so use a pool that actually leaves a residue: $1,234.
    const rows = materializePayouts(byPercent([pos(1, 0.5), pos(2, 0.3), pos(3, 0.2)]), 123_400)
    // raw: 61700 / 37020 / 24680 → nearest5: 61500 / 37000 / 24500 (sum 123000, residue 400)
    expect(rows).toEqual([
      { place: 1, amount: 61_900 }, // 61500 + 400 residue
      { place: 2, amount: 37_000 },
      { place: 3, amount: 24_500 },
    ])
  })

  it('byPercent: total always equals the pool exactly (residue-to-1st convention)', () => {
    for (const pool of [0, 100, 123_456, 200_000, 999_999]) {
      for (const rounding of ['nearest5', 'nearest10', 'none']) {
        const positions = payoutCurve(7).map((percent, i) => pos(i + 1, percent))
        const rows = materializePayouts({ type: 'byPercent', rounding, positions }, pool)
        expect(rows.reduce((a, r) => a + r.amount, 0)).toBe(pool)
      }
    }
  })

  it('byPercent: non-first places sit exactly on the rounding step', () => {
    const positions = payoutCurve(9).map((percent, i) => pos(i + 1, percent))
    const rows = materializePayouts({ type: 'byPercent', rounding: 'nearest10', positions }, 987_654)
    for (const r of rows.slice(1)) {
      expect(r.amount % 1000).toBe(0)
    }
  })

  it('byPercent: amounts are integer cents and place-sorted even from unsorted positions', () => {
    const rows = materializePayouts(byPercent([pos(3, 0.2), pos(1, 0.5), pos(2, 0.3)], 'none'), 100_001)
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3])
    for (const r of rows) expect(Number.isInteger(r.amount)).toBe(true)
    expect(rows.reduce((a, r) => a + r.amount, 0)).toBe(100_001)
  })

  it('byPercent: a deliberately partial structure (percents well under 100%) keeps rounded amounts — no residue dump', () => {
    const rows = materializePayouts(byPercent([pos(1, 0.5), pos(2, 0.25)]), 100_000)
    expect(rows).toEqual([
      { place: 1, amount: 50_000 },
      { place: 2, amount: 25_000 },
    ])
  })

  it('byPercent: winner-takes-all (the create-form default) gives 1st the whole pool', () => {
    const rows = materializePayouts(byPercent([pos(1, 1)]), 80_000)
    expect(rows).toEqual([{ place: 1, amount: 80_000 }])
  })

  it('byPercent: zero / negative pool materializes to all-zero amounts', () => {
    const positions = payoutCurve(3).map((percent, i) => pos(i + 1, percent))
    expect(materializePayouts(byPercent(positions), 0)).toEqual([
      { place: 1, amount: 0 },
      { place: 2, amount: 0 },
      { place: 3, amount: 0 },
    ])
    expect(materializePayouts(byPercent(positions), -500).every((r) => r.amount === 0)).toBe(true)
  })

  it('byPlace: fixed amounts pass through unchanged regardless of the pool', () => {
    const structure = {
      type: 'byPlace',
      rounding: 'nearest5',
      positions: [
        { place: 2, payout: 30_000, percent: null },
        { place: 1, payout: 70_003, percent: null }, // off the $5 step on purpose — no rounding for byPlace
      ],
    }
    expect(materializePayouts(structure, 12_345)).toEqual([
      { place: 1, amount: 70_003 },
      { place: 2, amount: 30_000 },
    ])
  })

  it('degenerate inputs return an empty table', () => {
    expect(materializePayouts(null, 100_000)).toEqual([])
    expect(materializePayouts({ type: 'byPercent', rounding: 'none' }, 100_000)).toEqual([])
  })
})
