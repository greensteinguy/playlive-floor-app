// Unit tests for the final-results derivations (task 4.10). Everything under
// test is pure — no Firestore mocks beyond the module-boundary stub needed to
// import through ./payouts (which pulls the firestore layer transitively).

import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  entryTypeCounts,
  guaranteeStatus,
  resultPaidState,
  RESULT_PAID_STATE_LABEL,
  RESULTS_GROUP_LABEL,
  buildResultsStandings,
  flattenStandings,
  latestDealFromAudit,
} from './results'

let entrySeq = 0
function makeEntry(overrides = {}) {
  entrySeq += 1
  return {
    id: `entry-${entrySeq}`,
    playerId: `player-${entrySeq}`,
    tournamentId: 't1',
    entryType: 'initial',
    entryNumber: 1,
    registeredAt: Timestamp.fromMillis(1_000_000 + entrySeq * 1000),
    voidedAt: null,
    bustedAt: null,
    bustedInSessionId: null,
    finishingPlace: null,
    cashWinnings: 0,
    ticketWinnings: 0,
    bountyEarnings: 0,
    winningsPaidAt: null,
    winningsWalletTransactionId: null,
    ...overrides,
  }
}
const busted = (ms, overrides = {}) =>
  makeEntry({ bustedAt: Timestamp.fromMillis(ms), bustedInSessionId: 's1', ...overrides })

// ── entryTypeCounts ──────────────────────────────────────────────────────────

describe('entryTypeCounts', () => {
  it('counts initial vs re-entry rows, voided excluded', () => {
    const entries = [
      makeEntry(),
      makeEntry({ entryType: 'reentry' }),
      makeEntry({ entryType: 'rebuy' }),
      makeEntry({ entryType: 'initial', voidedAt: Timestamp.now() }),
    ]
    expect(entryTypeCounts(entries)).toEqual({ total: 3, initial: 1, reentries: 2 })
  })

  it('handles empty/nullish input', () => {
    expect(entryTypeCounts([])).toEqual({ total: 0, initial: 0, reentries: 0 })
    expect(entryTypeCounts(null)).toEqual({ total: 0, initial: 0, reentries: 0 })
  })
})

// ── guaranteeStatus ──────────────────────────────────────────────────────────

describe('guaranteeStatus', () => {
  it('is null when there is no guarantee', () => {
    expect(guaranteeStatus({ guarantee: 0, totalPrizePool: 50_000 })).toBeNull()
    expect(guaranteeStatus(null)).toBeNull()
  })

  it('reports met when the pool covers the guarantee', () => {
    expect(guaranteeStatus({ guarantee: 100_000, totalPrizePool: 120_000 })).toEqual({
      guarantee: 100_000,
      prizePool: 120_000,
      met: true,
      shortfall: 0,
    })
  })

  it('reports the shortfall when missed (exactly met counts as met)', () => {
    expect(guaranteeStatus({ guarantee: 100_000, totalPrizePool: 80_000 })).toEqual({
      guarantee: 100_000,
      prizePool: 80_000,
      met: false,
      shortfall: 20_000,
    })
    expect(guaranteeStatus({ guarantee: 100_000, totalPrizePool: 100_000 }).met).toBe(true)
  })
})

// ── resultPaidState ──────────────────────────────────────────────────────────

describe('resultPaidState', () => {
  it('is null for zero-winnings rows (unmarked)', () => {
    expect(resultPaidState(makeEntry())).toBeNull()
  })

  it('is staged for winnings without winningsPaidAt', () => {
    expect(resultPaidState(makeEntry({ cashWinnings: 5000 }))).toBe('staged')
    expect(resultPaidState(makeEntry({ ticketWinnings: 5000 }))).toBe('staged')
    expect(resultPaidState(makeEntry({ bountyEarnings: 2500 }))).toBe('staged')
  })

  it('is paid once winningsPaidAt is stamped', () => {
    expect(resultPaidState(makeEntry({ cashWinnings: 5000, winningsPaidAt: Timestamp.now() }))).toBe('paid')
  })

  it('has labels for both marked states', () => {
    expect(RESULT_PAID_STATE_LABEL.paid).toBe('Paid')
    expect(RESULT_PAID_STATE_LABEL.staged).toBe('Awaiting cashier')
  })
})

// ── buildResultsStandings ────────────────────────────────────────────────────

describe('buildResultsStandings', () => {
  it('places the recorded winner first (place 1, alive) then bust-out places ascending', () => {
    const winner = makeEntry({ finishingPlace: 1, cashWinnings: 50_000 }) // alive — winners stay un-busted
    const second = busted(3000, { finishingPlace: 2 })
    const third = busted(2000, { finishingPlace: 3 })
    const { placed } = buildResultsStandings([third, winner, second])
    expect(placed.map((r) => r.place)).toEqual([1, 2, 3])
    expect(placed[0].entryId).toBe(winner.id)
    expect(placed[0].group).toBe('placed')
  })

  it('excludes voided entries from every group', () => {
    const v = makeEntry({ voidedAt: Timestamp.now(), finishingPlace: 2 })
    const s = buildResultsStandings([v])
    expect(flattenStandings(s)).toEqual([])
  })

  it('groups satellite milestone winners (null place, ticketWinnings > 0) separately, earliest milestone first', () => {
    const late = busted(9000, { ticketWinnings: 20_000 })
    const early = busted(4000, { ticketWinnings: 20_000 })
    const { ticketWinners, placed, unplaced } = buildResultsStandings([late, early])
    expect(ticketWinners.map((r) => r.entryId)).toEqual([early.id, late.id])
    expect(ticketWinners.every((r) => r.group === 'ticketWinners')).toBe(true)
    expect(placed).toEqual([])
    expect(unplaced).toEqual([])
  })

  it('keeps a PLACED entry with ticket winnings in the placed group (place wins over ticket)', () => {
    const e = busted(5000, { finishingPlace: 2, ticketWinnings: 10_000 })
    const s = buildResultsStandings([e])
    expect(s.placed.map((r) => r.entryId)).toEqual([e.id])
    expect(s.ticketWinners).toEqual([])
  })

  it('groups alive unplaced entries as still in play, registration order', () => {
    const a = makeEntry()
    const b = makeEntry()
    const { stillIn } = buildResultsStandings([b, a])
    expect(stillIn.map((r) => r.entryId)).toEqual([a.id, b.id])
    expect(stillIn.every((r) => r.place === null)).toBe(true)
  })

  it('groups busted-no-place entries as unplaced, earliest bust first', () => {
    const later = busted(8000)
    const earlier = busted(2000)
    const { unplaced } = buildResultsStandings([later, earlier])
    expect(unplaced.map((r) => r.entryId)).toEqual([earlier.id, later.id])
  })

  it('rows carry the money breakdown and paid marker', () => {
    const paidAt = Timestamp.now()
    const e = busted(1000, {
      finishingPlace: 2,
      cashWinnings: 30_000,
      bountyEarnings: 5_000,
      ticketWinnings: 0,
      winningsPaidAt: paidAt,
    })
    const [row] = buildResultsStandings([e]).placed
    expect(row).toMatchObject({
      place: 2,
      cash: 30_000,
      bounty: 5_000,
      ticket: 0,
      total: 35_000,
      paidState: 'paid',
      playerId: e.playerId,
    })
  })

  it('has a display label for every group it can emit', () => {
    for (const g of ['placed', 'ticketWinners', 'stillIn', 'unplaced']) {
      expect(RESULTS_GROUP_LABEL[g]).toBeTruthy()
    }
  })
})

// ── flattenStandings ─────────────────────────────────────────────────────────

describe('flattenStandings', () => {
  it('concatenates groups in render order', () => {
    const winner = makeEntry({ finishingPlace: 1 })
    const ticket = busted(1000, { ticketWinnings: 20_000 })
    const alive = makeEntry()
    const noPlace = busted(2000)
    const flat = flattenStandings(buildResultsStandings([noPlace, alive, ticket, winner]))
    expect(flat.map((r) => r.group)).toEqual(['placed', 'ticketWinners', 'stillIn', 'unplaced'])
  })

  it('handles nullish input', () => {
    expect(flattenStandings(null)).toEqual([])
  })
})

// ── latestDealFromAudit ──────────────────────────────────────────────────────

describe('latestDealFromAudit', () => {
  const dealRow = (ms, overrides = {}) => ({
    id: `audit-${ms}`,
    actionType: 'tournament.dealEntered',
    targetType: 'tournament',
    targetId: 't1',
    timestamp: Timestamp.fromMillis(ms),
    metadata: {
      payouts: [{ entryId: 'e1' }, { entryId: 'e2' }],
      notes: 'even chop',
      grandTotal: 100_000,
      prizePool: 100_000,
      delta: 0,
      override: false,
    },
    ...overrides,
  })

  it('returns null when no deal audit row exists', () => {
    expect(latestDealFromAudit([], 't1')).toBeNull()
    expect(latestDealFromAudit(null, 't1')).toBeNull()
    expect(
      latestDealFromAudit([dealRow(1000, { actionType: 'tournament.statusChanged' })], 't1')
    ).toBeNull()
  })

  it('ignores deals for other tournaments', () => {
    expect(latestDealFromAudit([dealRow(1000, { targetId: 't2' })], 't1')).toBeNull()
  })

  it('surfaces the newest deal with its totals and notes', () => {
    const old = dealRow(1000, { metadata: { grandTotal: 90_000, prizePool: 100_000, delta: -10_000, notes: 'v1', payouts: [], override: true } })
    const latest = dealRow(5000)
    const note = latestDealFromAudit([old, latest], 't1')
    expect(note).toMatchObject({
      grandTotal: 100_000,
      prizePool: 100_000,
      delta: 0,
      notes: 'even chop',
      override: false,
      playerCount: 2,
    })
    expect(note.timestamp.toMillis()).toBe(5000)
  })

  it('tolerates missing metadata fields', () => {
    const bare = { actionType: 'tournament.dealEntered', targetId: 't1', timestamp: Timestamp.fromMillis(1) }
    expect(latestDealFromAudit([bare], 't1')).toEqual({
      timestamp: bare.timestamp,
      grandTotal: null,
      prizePool: null,
      delta: null,
      notes: null,
      override: false,
      playerCount: null,
    })
  })
})
