import { describe, it, expect } from 'vitest'
import { computeVenuePayouts, buildBands, bandLadder } from './payoutEngine'

// The canonical fixture: the venue workbook's own worked scenario (72 entries,
// $100 buy-in, $50 hospitality, 1-in-9, 9-handed, 1.75x min-cash), which the
// CSV export and the DO NOT TOUCH sheet both produce. THE SHEET IS GOSPEL
// (Guy, 10 Aug 2026) — these numbers may not drift.
const FIXTURE = {
  entries: 72,
  buyInCents: 100_00,
  hospitalityCents: 50_00,
  handedness: '9handed',
  spotsRatio: 9,
  minCashMultiplier: 1.75,
  includePoints: true,
}

describe('canonical 72-entry fixture', () => {
  const result = computeVenuePayouts(FIXTURE)

  it('reproduces pool, places, and min-cash', () => {
    expect(result.prizePoolCents).toBe(7200_00)
    expect(result.adjPrizePoolCents).toBe(7200_00)
    expect(result.placesPaid).toBe(10)
    expect(result.minCashCents).toBe(262_50)
    expect(result.ok).toBe(true)
  })

  it('reproduces the exact payout table', () => {
    expect(result.rows.map((r) => r.amountCents)).toEqual([
      2150_00, 1340_00, 830_00, 600_00, 520_00, 450_00, 400_00, 350_00, 300_00, 260_00,
    ])
    expect(result.rows.map((r) => [r.fromPlace, r.toPlace])).toEqual([
      [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10],
    ])
  })

  it('table sums exactly to the pool', () => {
    expect(result.rows.reduce((s, r) => s + r.rowTotalCents, 0)).toBe(7200_00)
  })

  it('reproduces the points column (60 down to 6, step 6)', () => {
    const points = result.rows.map((r) => r.points)
    expect(points.map((p) => Math.round(p * 1000) / 1000)).toEqual([
      60, 54, 48, 42, 36, 30, 24, 18, 12, 6,
    ])
  })

  it('passes the 1st/2nd sanity gate', () => {
    expect(result.firstToSecondRatio).toBeCloseTo(2150 / 1340, 10)
    expect(result.ratioFlag).toBe('ok')
  })
})

describe('points toggle', () => {
  it('emits null points when the series toggle is off', () => {
    const r = computeVenuePayouts({ ...FIXTURE, includePoints: false })
    expect(r.rows.every((row) => row.points === null)).toBe(true)
    // and the money is unchanged
    expect(r.rows.map((x) => x.amountCents)[0]).toBe(2150_00)
  })
})

describe('places-paid rule: round(adjEntries / spotsRatio + 2)', () => {
  const places = (entries, over = {}) =>
    computeVenuePayouts({ ...FIXTURE, entries, includePoints: false, ...over }).placesPaid

  it('72/9 + 2 = 10', () => expect(places(72)).toBe(10))
  it('rounds (63/9 + 2 = 9)', () => expect(places(63)).toBe(9))
  it('small field (20/9 + 2 ≈ 4)', () => expect(places(20)).toBe(4))
  it('large field (180/9 + 2 = 22)', () => expect(places(180)).toBe(22))
})

describe('guarantee and equity refunds', () => {
  it('guarantee floors the pool and inflates places via adjusted entries', () => {
    // 30 × $100 = $3,000 < $10,000 guarantee → pool = guarantee,
    // adjEntries = 100 → places = round(100/9 + 2) = 13.
    const r = computeVenuePayouts({
      ...FIXTURE,
      entries: 30,
      guaranteeCents: 10_000_00,
      includePoints: false,
    })
    expect(r.prizePoolCents).toBe(10_000_00)
    expect(r.placesPaid).toBe(13)
    expect(r.rows.reduce((s, x) => s + x.rowTotalCents, 0)).toBe(10_000_00)
  })

  it('a beaten guarantee uses the raw pool', () => {
    const r = computeVenuePayouts({ ...FIXTURE, guaranteeCents: 5_000_00, includePoints: false })
    expect(r.prizePoolCents).toBe(7200_00)
  })

  it('equity refunds come off the distributed pool', () => {
    const r = computeVenuePayouts({ ...FIXTURE, equityRefundsCents: 1200_00, includePoints: false })
    expect(r.adjPrizePoolCents).toBe(6000_00)
    expect(r.rows.reduce((s, x) => s + x.rowTotalCents, 0)).toBe(6000_00)
  })
})

describe('min-cash multiplier', () => {
  it('scales off the full ticket (buy-in + hospitality)', () => {
    const r15 = computeVenuePayouts({ ...FIXTURE, minCashMultiplier: 1.5, includePoints: false })
    expect(r15.minCashCents).toBe(225_00)
    const r2 = computeVenuePayouts({ ...FIXTURE, minCashMultiplier: 2, includePoints: false })
    expect(r2.minCashCents).toBe(300_00)
  })

  it('add-ons enter the average ticket and the pool', () => {
    const r = computeVenuePayouts({
      ...FIXTURE,
      addOnCount: 36,
      addOnPriceCents: 100_00,
      includePoints: false,
    })
    // pool = 72×100 + 36×100 = 10,800; avg ticket = (72×150 + 3600)/72 = 200
    expect(r.prizePoolCents).toBe(10_800_00)
    expect(r.minCashCents).toBe(350_00) // 200 × 1.75
    expect(r.rows.reduce((s, x) => s + x.rowTotalCents, 0)).toBe(10_800_00)
  })
})

describe('band construction', () => {
  it('ladders extend by the sheet recursions', () => {
    expect(bandLadder('9handed', 200).slice(-3)).toEqual([144, 189, 243])
    expect(bandLadder('6handed', 100).slice(-2)).toEqual([90, 120])
    expect(bandLadder('mixmax', 150).slice(-2)).toEqual([144, 189])
  })

  it('10 places, 9-handed: nine singles + a final single (the fixture shape)', () => {
    expect(buildBands('9handed', 10).map((b) => b.size)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('places sum is exact for a spread of field sizes and handedness', () => {
    for (const handedness of ['9handed', '6handed', 'mixmax']) {
      for (const places of [3, 4, 7, 9, 10, 13, 17, 22, 30, 47, 100, 224]) {
        const total = buildBands(handedness, places).reduce((s, b) => s + b.size, 0)
        expect(total, `${handedness}/${places}`).toBe(places)
      }
    }
  })
})

describe('balance property: every config pays out exactly the adjusted pool', () => {
  it('holds across entries × buy-in × multiplier sweeps', () => {
    for (const entries of [12, 27, 45, 72, 120, 250, 600, 2000]) {
      for (const buyInCents of [50_00, 100_00, 330_00]) {
        for (const minCashMultiplier of [1.5, 1.75, 2]) {
          const r = computeVenuePayouts({
            entries,
            buyInCents,
            hospitalityCents: 50_00,
            handedness: '9handed',
            spotsRatio: 9,
            minCashMultiplier,
            includePoints: false,
          })
          const paid = r.rows.reduce((s, x) => s + x.rowTotalCents, 0)
          expect(paid, `E${entries} B${buyInCents} M${minCashMultiplier}`).toBe(r.adjPrizePoolCents)
          expect(r.rows[r.rows.length - 1].toPlace).toBe(r.placesPaid)
        }
      }
    }
  })

  it('2000 entries computes fast (Guy Q2: no system slowdown)', () => {
    const t0 = performance.now()
    const r = computeVenuePayouts({
      entries: 2000,
      buyInCents: 100_00,
      hospitalityCents: 50_00,
      handedness: '9handed',
      spotsRatio: 9,
      minCashMultiplier: 1.75,
      includePoints: true,
    })
    const ms = performance.now() - t0
    expect(r.placesPaid).toBe(224)
    expect(ms).toBeLessThan(250)
  })
})

describe('degenerate inputs fail gracefully (sheet would spin)', () => {
  it('rejects invalid inputs', () => {
    expect(computeVenuePayouts({ entries: 0, buyInCents: 100_00 }).ok).toBe(false)
    expect(computeVenuePayouts({ entries: 10, buyInCents: 0 }).ok).toBe(false)
  })

  it('flags places exceeding entries instead of paying ghosts', () => {
    // 4 entries, huge guarantee → adjEntries balloons past the field size.
    const r = computeVenuePayouts({
      ...FIXTURE,
      entries: 4,
      guaranteeCents: 10_000_00,
      includePoints: false,
    })
    expect(r.ok).toBe(false)
    expect(r.warnings.join(' ')).toMatch(/exceeds entries/)
  })
})
