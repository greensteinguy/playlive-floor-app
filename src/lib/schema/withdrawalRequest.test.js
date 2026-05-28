import { describe, it, expect } from 'vitest'
import { WithdrawalRequest } from './withdrawalRequest'
import { buildWithdrawalRequest, ts } from './_fixtures'

describe('WithdrawalRequest', () => {
  it('accepts a minimal pending request', () => {
    expect(() => WithdrawalRequest.parse(buildWithdrawalRequest())).not.toThrow()
  })

  describe('state=pending', () => {
    it.each([
      ['completedBy', 'manager-1'],
      ['completedAt', ts()],
      ['walletTransactionId', 'tx-1'],
      ['cancelledBy', 'cashier-1'],
      ['cancelledAt', ts()],
    ])('rejects stray %s when state=pending', (field, value) => {
      const result = WithdrawalRequest.safeParse(buildWithdrawalRequest({ [field]: value }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })

  describe('state=completed', () => {
    function completed(overrides = {}) {
      return buildWithdrawalRequest({
        state: 'completed',
        completedBy: 'manager-1',
        completedAt: ts(),
        externalReference: 'EFTPOS-123',
        walletTransactionId: 'tx-1',
        ...overrides,
      })
    }

    it('accepts when all completed-* fields are set', () => {
      expect(() => WithdrawalRequest.parse(completed())).not.toThrow()
    })

    it.each([
      ['completedBy'],
      ['completedAt'],
      ['walletTransactionId'],
    ])('rejects when %s is null', (field) => {
      const result = WithdrawalRequest.safeParse(completed({ [field]: null }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })

  describe('state=cancelled', () => {
    function cancelled(overrides = {}) {
      return buildWithdrawalRequest({
        state: 'cancelled',
        cancelledBy: 'cashier-1',
        cancelledAt: ts(),
        cancelReason: 'player changed mind',
        ...overrides,
      })
    }

    it('accepts when cancelled-* fields are set', () => {
      expect(() => WithdrawalRequest.parse(cancelled())).not.toThrow()
    })

    it.each([['cancelledBy'], ['cancelledAt']])('rejects when %s is null', (field) => {
      const result = WithdrawalRequest.safeParse(cancelled({ [field]: null }))
      expect(result.success).toBe(false)
    })
  })

  it('rejects amount <= 0', () => {
    expect(WithdrawalRequest.safeParse(buildWithdrawalRequest({ amount: 0 })).success).toBe(false)
    expect(WithdrawalRequest.safeParse(buildWithdrawalRequest({ amount: -1 })).success).toBe(false)
  })
})
