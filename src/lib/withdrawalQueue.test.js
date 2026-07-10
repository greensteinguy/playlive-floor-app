import { describe, it, expect } from 'vitest'
import {
  WITHDRAWAL_FILTERS,
  withdrawalFilterMatch,
  countWithdrawalsByFilter,
  sortWithdrawals,
  payoutMethodLabel,
  withdrawalStateLabel,
  buildWithdrawalCsvRows,
  WITHDRAWAL_CSV_COLUMNS,
} from './withdrawalQueue'

// Minimal Timestamp stand-in (matches the toMillis duck-typing the sort uses).
const ts = (millis) => ({ toMillis: () => millis })

const req = (over = {}) => ({
  id: 'w1',
  playerId: 'p1',
  amount: 5000,
  payoutMethod: 'cash',
  state: 'pending',
  requestedBy: 'staff-1',
  requestedAt: ts(1000),
  completedBy: null,
  completedAt: null,
  externalReference: null,
  walletTransactionId: null,
  cancelledBy: null,
  cancelledAt: null,
  cancelReason: null,
  ...over,
})

describe('withdrawalFilterMatch', () => {
  const byId = Object.fromEntries(WITHDRAWAL_FILTERS.map((f) => [f.id, f]))

  it('matches each state filter exactly', () => {
    expect(withdrawalFilterMatch(byId.pending, 'pending')).toBe(true)
    expect(withdrawalFilterMatch(byId.pending, 'completed')).toBe(false)
    expect(withdrawalFilterMatch(byId.completed, 'completed')).toBe(true)
    expect(withdrawalFilterMatch(byId.completed, 'cancelled')).toBe(false)
    expect(withdrawalFilterMatch(byId.cancelled, 'cancelled')).toBe(true)
    expect(withdrawalFilterMatch(byId.cancelled, 'pending')).toBe(false)
  })

  it('all matches every state', () => {
    for (const state of ['pending', 'completed', 'cancelled']) {
      expect(withdrawalFilterMatch(byId.all, state)).toBe(true)
    }
  })

  it('chip order is queue-first: Pending leads, All closes', () => {
    expect(WITHDRAWAL_FILTERS.map((f) => f.id)).toEqual([
      'pending',
      'completed',
      'cancelled',
      'all',
    ])
  })
})

describe('countWithdrawalsByFilter', () => {
  it('counts per chip, with all = total', () => {
    const rows = [
      req({ id: 'a', state: 'pending' }),
      req({ id: 'b', state: 'pending' }),
      req({ id: 'c', state: 'completed' }),
      req({ id: 'd', state: 'cancelled' }),
    ]
    expect(countWithdrawalsByFilter(rows)).toEqual({
      pending: 2,
      completed: 1,
      cancelled: 1,
      all: 4,
    })
  })

  it('handles an empty queue', () => {
    expect(countWithdrawalsByFilter([])).toEqual({
      pending: 0,
      completed: 0,
      cancelled: 0,
      all: 0,
    })
  })
})

describe('sortWithdrawals', () => {
  it('floats pending above resolved, newest-first within each group', () => {
    const rows = [
      req({ id: 'old-completed', state: 'completed', requestedAt: ts(500) }),
      req({ id: 'old-pending', state: 'pending', requestedAt: ts(100) }),
      req({ id: 'new-cancelled', state: 'cancelled', requestedAt: ts(900) }),
      req({ id: 'new-pending', state: 'pending', requestedAt: ts(800) }),
    ]
    expect(sortWithdrawals(rows).map((r) => r.id)).toEqual([
      'new-pending',
      'old-pending',
      'new-cancelled',
      'old-completed',
    ])
  })

  it('tolerates missing timestamps and does not mutate the input', () => {
    const rows = [
      req({ id: 'a', requestedAt: null }),
      req({ id: 'b', requestedAt: ts(100) }),
    ]
    const sorted = sortWithdrawals(rows)
    expect(sorted.map((r) => r.id)).toEqual(['b', 'a'])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']) // input untouched
  })

  it('accepts Date objects for requestedAt', () => {
    const rows = [
      req({ id: 'older', requestedAt: new Date(1000) }),
      req({ id: 'newer', requestedAt: new Date(2000) }),
    ]
    expect(sortWithdrawals(rows).map((r) => r.id)).toEqual(['newer', 'older'])
  })
})

describe('labels', () => {
  it('maps payout methods to floor-friendly labels', () => {
    expect(payoutMethodLabel('cash')).toBe('Cash')
    expect(payoutMethodLabel('eftposRefund')).toBe('EFTPOS refund')
    expect(payoutMethodLabel('bankTransfer')).toBe('Bank transfer')
  })

  it('falls back to the raw value for unknown inputs', () => {
    expect(payoutMethodLabel('carrierPigeon')).toBe('carrierPigeon')
    expect(withdrawalStateLabel('limbo')).toBe('limbo')
  })

  it('maps states to display labels', () => {
    expect(withdrawalStateLabel('pending')).toBe('Pending')
    expect(withdrawalStateLabel('completed')).toBe('Completed')
    expect(withdrawalStateLabel('cancelled')).toBe('Cancelled')
  })
})

describe('buildWithdrawalCsvRows', () => {
  const nameOf = (id) => ({ p1: 'Alice Adler' }[id] ?? '')

  it('shapes a completed request with resolved player name and formatted amount', () => {
    const rows = buildWithdrawalCsvRows(
      [
        req({
          id: 'w9',
          state: 'completed',
          amount: 12345,
          payoutMethod: 'bankTransfer',
          completedBy: 'mgr-1',
          completedAt: ts(2000),
          externalReference: 'TX-77',
          walletTransactionId: 'tx-1',
        }),
      ],
      nameOf
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'w9',
      player: 'Alice Adler',
      playerId: 'p1',
      amount: '$123.45',
      payoutMethod: 'Bank transfer',
      state: 'Completed',
      completedBy: 'mgr-1',
      externalReference: 'TX-77',
    })
  })

  it('falls back to the raw playerId when the name is unknown', () => {
    const rows = buildWithdrawalCsvRows([req({ playerId: 'ghost-1' })], nameOf)
    expect(rows[0].player).toBe('ghost-1')
  })

  it('every column key exists on the built rows', () => {
    const [row] = buildWithdrawalCsvRows([req()], nameOf)
    for (const col of WITHDRAWAL_CSV_COLUMNS) {
      expect(row).toHaveProperty(col.key)
    }
  })
})
