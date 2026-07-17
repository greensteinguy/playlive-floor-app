import { describe, it, expect } from 'vitest'
import { WalletTransaction } from './walletTransaction'
import { buildWalletTransaction } from './_fixtures'

describe('WalletTransaction', () => {
  it('accepts a minimal deposit row', () => {
    expect(() => WalletTransaction.parse(buildWalletTransaction())).not.toThrow()
  })

  describe('amount HARD invariant (always > 0)', () => {
    it.each([[0], [-1], [1.5]])('rejects amount=%s', (amount) => {
      expect(WalletTransaction.safeParse(buildWalletTransaction({ amount })).success).toBe(false)
    })
  })

  describe('method-vs-type enforcement', () => {
    const TYPES_NULL_METHOD = [
      'withdrawalRequest',
      'withdrawalComplete',
      'withdrawalCancel',
      'winCredit',
      'adjustment',
      'openingBalance',
      'managerCredit',
      'managerDebit',
    ]

    it.each(TYPES_NULL_METHOD.map((t) => [t]))(
      'rejects non-null method when type=%s',
      (type) => {
        const tx = buildWalletTransaction({
          type,
          method: 'cash',
          actorRole: type === 'openingBalance' ? 'system' : type.startsWith('manager') ? 'manager' : 'cashier',
          reference: type === 'openingBalance' ? 'opening_balance' : null,
          notes: type.startsWith('manager') ? 'reason' : null,
        })
        const result = WalletTransaction.safeParse(tx)
        expect(result.success).toBe(false)
        expect(result.error.issues.some((i) => i.path.includes('method'))).toBe(true)
      }
    )

    it.each([['deposit'], ['spend'], ['ticketUse']])(
      'requires non-null method when type=%s',
      (type) => {
        const tx = buildWalletTransaction({
          type,
          method: null,
          // ticketUse needs a relatedDocId so the non-null-method failure is what we exercise
          relatedDocId: type === 'ticketUse' ? 'ticket-1' : null,
        })
        const result = WalletTransaction.safeParse(tx)
        expect(result.success).toBe(false)
        expect(result.error.issues.some((i) => i.path.includes('method'))).toBe(true)
      }
    )
  })

  describe('ticketUse', () => {
    it('requires relatedDocId', () => {
      const tx = buildWalletTransaction({
        type: 'ticketUse',
        method: 'ticket',
        relatedDocId: null,
      })
      const result = WalletTransaction.safeParse(tx)
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('relatedDocId'))).toBe(true)
    })

    it('accepts when relatedDocId is set', () => {
      expect(() =>
        WalletTransaction.parse(
          buildWalletTransaction({
            type: 'ticketUse',
            method: 'ticket',
            relatedDocId: 'ticket-1',
          })
        )
      ).not.toThrow()
    })
  })

  describe('openingBalance', () => {
    function opening(overrides = {}) {
      return buildWalletTransaction({
        type: 'openingBalance',
        method: null,
        actorRole: 'system',
        actorId: 'system',
        reference: 'opening_balance',
        ...overrides,
      })
    }

    it('accepts well-formed openingBalance', () => {
      expect(() => WalletTransaction.parse(opening())).not.toThrow()
    })

    it('rejects when actorRole !== "system"', () => {
      const result = WalletTransaction.safeParse(opening({ actorRole: 'cashier' }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('actorRole'))).toBe(true)
    })

    it('rejects when reference !== "opening_balance"', () => {
      const result = WalletTransaction.safeParse(opening({ reference: 'something_else' }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('reference'))).toBe(true)
    })
  })

  describe('direction (adjustment-only)', () => {
    function adjustment(overrides = {}) {
      return buildWalletTransaction({
        type: 'adjustment',
        method: null,
        direction: 'credit',
        notes: 'adjustment: credit — fix typo',
        ...overrides,
      })
    }

    it.each([['credit'], ['debit']])('accepts adjustment with direction=%s', (direction) => {
      expect(() => WalletTransaction.parse(adjustment({ direction }))).not.toThrow()
    })

    it('rejects adjustment with direction=null', () => {
      const result = WalletTransaction.safeParse(adjustment({ direction: null }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('direction'))).toBe(true)
    })

    it('rejects non-adjustment rows that carry a direction', () => {
      const result = WalletTransaction.safeParse(
        buildWalletTransaction({ type: 'deposit', method: 'cash', direction: 'credit' })
      )
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('direction'))).toBe(true)
    })

    it('defaults direction to null when omitted on a non-adjustment row', () => {
      const { direction: _omit, ...rest } = buildWalletTransaction()
      const parsed = WalletTransaction.parse(rest)
      expect(parsed.direction).toBe(null)
    })
  })

  describe('managerCredit / managerDebit', () => {
    function manager(type, overrides = {}) {
      return buildWalletTransaction({
        type,
        method: null,
        actorRole: 'manager',
        notes: 'goodwill comp for chip miscount',
        ...overrides,
      })
    }

    it.each([['managerCredit'], ['managerDebit']])(
      'accepts when actorRole=manager + non-empty notes (%s)',
      (type) => {
        expect(() => WalletTransaction.parse(manager(type))).not.toThrow()
      }
    )

    it.each([['managerCredit'], ['managerDebit']])(
      'rejects non-manager actorRole on %s',
      (type) => {
        const result = WalletTransaction.safeParse(manager(type, { actorRole: 'cashier' }))
        expect(result.success).toBe(false)
        expect(result.error.issues.some((i) => i.path.includes('actorRole'))).toBe(true)
      }
    )

    it.each([['managerCredit'], ['managerDebit']])(
      'rejects null/empty notes on %s',
      (type) => {
        const empty = WalletTransaction.safeParse(manager(type, { notes: '' }))
        expect(empty.success).toBe(false)
        const nullish = WalletTransaction.safeParse(manager(type, { notes: null }))
        expect(nullish.success).toBe(false)
      }
    )
  })

  describe('entryRefund (voided-entry payment reversal)', () => {
    function refund(overrides = {}) {
      return buildWalletTransaction({
        type: 'entryRefund',
        method: 'cash',
        relatedDocId: 'entry-1',
        notes: 'wrong player selected',
        ...overrides,
      })
    }

    it.each([['cash'], ['eftpos'], ['wallet'], ['ticket']])('accepts method=%s', (method) => {
      expect(WalletTransaction.safeParse(refund({ method })).success).toBe(true)
    })

    it('requires a method (the original payment channel)', () => {
      const r = WalletTransaction.safeParse(refund({ method: null }))
      expect(r.success).toBe(false)
      expect(r.error.issues.some((i) => i.path.includes('method'))).toBe(true)
    })

    it('requires relatedDocId (the voided entry)', () => {
      const r = WalletTransaction.safeParse(refund({ relatedDocId: null }))
      expect(r.success).toBe(false)
      expect(r.error.issues.some((i) => i.path.includes('relatedDocId'))).toBe(true)
    })

    it('requires notes (the void reason)', () => {
      const r = WalletTransaction.safeParse(refund({ notes: '  ' }))
      expect(r.success).toBe(false)
      expect(r.error.issues.some((i) => i.path.includes('notes'))).toBe(true)
    })
  })
})
