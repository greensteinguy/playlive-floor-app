import { describe, it, expect } from 'vitest'
import {
  shouldRefreshPayoutTable,
  engineInputsFromTournament,
  tableFromEngineResult,
  PAYOUT_REFRESH_MIN_INTERVAL_MS,
} from './payoutTable'
import { payoutTablePlaces, buildPayoutRows } from './payouts'
import { computeVenuePayouts } from '../payoutEngine'

const NOW = 1_800_000_000_000
const ts = (ms) => ({ toMillis: () => ms })

const baseTournament = (over = {}) => ({
  id: 't1',
  status: 'lateRegOpen',
  entryCount: 30,
  buyIn: 100_00,
  hospitalityCost: 50_00,
  guarantee: 0,
  maxSeatsPerTable: 9,
  reentryConfig: { hasAddOn: false, addOnCost: null },
  payoutConfig: {
    spotsRatio: 9,
    minCashMultiplier: 1.75,
    seriesEvent: false,
    addOnCount: 0,
    equityRefunds: 0,
  },
  payoutTable: null,
  ...over,
})

const storedTable = (over = {}) => ({
  computedAt: ts(NOW - 60_000),
  entryCountAtCompute: 30,
  placesPaid: 5,
  minCash: 262_50,
  adjPrizePool: 3000_00,
  tailRatio: 1.1,
  ratioFlag: 'ok',
  seriesEvent: false,
  warnings: [],
  rows: [{ fromPlace: 1, toPlace: 1, size: 1, amount: 3000_00, rowTotal: 3000_00, points: null }],
  ...over,
})

describe('shouldRefreshPayoutTable (throttle + freeze policy)', () => {
  it('computes when no table exists and there are entries', () => {
    expect(shouldRefreshPayoutTable(baseTournament(), NOW)).toBe(true)
  })

  it('never auto-computes with zero entries', () => {
    expect(shouldRefreshPayoutTable(baseTournament({ entryCount: 0 }), NOW)).toBe(false)
  })

  it('freezes once late reg closes (and after)', () => {
    for (const status of ['lateRegClosed', 'finished', 'cancelled']) {
      expect(
        shouldRefreshPayoutTable(baseTournament({ status, payoutTable: storedTable() }), NOW),
        status
      ).toBe(false)
    }
  })

  it('skips when the entry count has not changed', () => {
    const t = baseTournament({ payoutTable: storedTable({ entryCountAtCompute: 30 }) })
    expect(shouldRefreshPayoutTable(t, NOW)).toBe(false)
  })

  it('throttles to the 5-minute window when entries changed', () => {
    const recent = baseTournament({
      entryCount: 35,
      payoutTable: storedTable({ computedAt: ts(NOW - 60_000) }),
    })
    expect(shouldRefreshPayoutTable(recent, NOW)).toBe(false)

    const old = baseTournament({
      entryCount: 35,
      payoutTable: storedTable({ computedAt: ts(NOW - PAYOUT_REFRESH_MIN_INTERVAL_MS) }),
    })
    expect(shouldRefreshPayoutTable(old, NOW)).toBe(true)
  })
})

describe('engineInputsFromTournament', () => {
  it('maps tournament fields onto engine inputs', () => {
    const inputs = engineInputsFromTournament(
      baseTournament({
        entryCount: 72,
        guarantee: 5000_00,
        reentryConfig: { hasAddOn: true, addOnCost: 100_00 },
        payoutConfig: {
          spotsRatio: 8,
          minCashMultiplier: 2,
          seriesEvent: true,
          addOnCount: 12,
          equityRefunds: 300_00,
        },
      })
    )
    expect(inputs).toEqual({
      entries: 72,
      buyInCents: 100_00,
      hospitalityCents: 50_00,
      addOnCount: 12,
      addOnPriceCents: 100_00,
      handedness: '9handed',
      spotsRatio: 8,
      minCashMultiplier: 2,
      guaranteeCents: 5000_00,
      equityRefundsCents: 300_00,
      includePoints: true,
    })
  })

  it('derives 6-handed from short tables', () => {
    expect(engineInputsFromTournament(baseTournament({ maxSeatsPerTable: 6 })).handedness).toBe('6handed')
    expect(engineInputsFromTournament(baseTournament({ maxSeatsPerTable: 9 })).handedness).toBe('9handed')
  })
})

describe('tableFromEngineResult → stored shape', () => {
  it('carries the canonical fixture into a valid stored table', () => {
    const result = computeVenuePayouts({
      entries: 72,
      buyInCents: 100_00,
      hospitalityCents: 50_00,
      handedness: '9handed',
      spotsRatio: 9,
      minCashMultiplier: 1.75,
      includePoints: true,
    })
    const table = tableFromEngineResult(result, { entryCount: 72, seriesEvent: true })
    expect(table.placesPaid).toBe(10)
    expect(table.rows[0]).toMatchObject({ fromPlace: 1, toPlace: 1, size: 1, amount: 2150_00, rowTotal: 2150_00 })
    expect(table.rows.reduce((s, r) => s + r.rowTotal, 0)).toBe(7200_00)
    expect(table.seriesEvent).toBe(true)
    expect(Math.round(table.rows[0].points)).toBe(60)
  })
})

describe('payoutTablePlaces (band expansion for the confirm flow)', () => {
  it('expands bands into per-place rows', () => {
    const places = payoutTablePlaces(
      storedTable({
        rows: [
          { fromPlace: 1, toPlace: 1, size: 1, amount: 500_00, rowTotal: 500_00, points: null },
          { fromPlace: 2, toPlace: 2, size: 1, amount: 300_00, rowTotal: 300_00, points: null },
          { fromPlace: 3, toPlace: 5, size: 3, amount: 100_00, rowTotal: 300_00, points: null },
        ],
      })
    )
    expect(places).toEqual([
      { place: 1, amount: 500_00 },
      { place: 2, amount: 300_00 },
      { place: 3, amount: 100_00 },
      { place: 4, amount: 100_00 },
      { place: 5, amount: 100_00 },
    ])
  })

  it('handles null/empty', () => {
    expect(payoutTablePlaces(null)).toEqual([])
    expect(payoutTablePlaces({ rows: [] })).toEqual([])
  })

  it('buildPayoutRows prefers the stored table over the legacy payoutStructure', () => {
    const t = {
      payoutTable: storedTable({
        rows: [
          { fromPlace: 1, toPlace: 1, size: 1, amount: 700_00, rowTotal: 700_00, points: null },
          { fromPlace: 2, toPlace: 2, size: 1, amount: 300_00, rowTotal: 300_00, points: null },
        ],
      }),
      // a legacy structure that would say something different
      payoutStructure: {
        type: 'byPercent',
        rounding: 'none',
        positions: [{ position: 1, percentage: 1 }],
      },
      totalPrizePool: 1000_00,
    }
    const rows = buildPayoutRows({ tournament: t, entries: [] })
    expect(rows.map((r) => [r.place, r.calculatedAmount])).toEqual([
      [1, 700_00],
      [2, 300_00],
    ])
  })
})
