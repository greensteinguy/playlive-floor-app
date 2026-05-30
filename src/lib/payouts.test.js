import { describe, it, expect } from 'vitest'
import { paidPlaceCount, payoutCurve, applyRounding } from './payouts'
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
