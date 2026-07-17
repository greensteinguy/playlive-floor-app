// Unit tests for the wallet module's pure helpers in _shared.js.
//
// balanceDelta is load-bearing — every wallet operation derives the new player
// balance from the type/method combo it returns. Bugs here ripple through every
// money flow, so every branch gets coverage.

import { describe, it, expect } from 'vitest'
import { balanceDelta, ticketBalanceDelta, walletTxDelta } from './_shared'

describe('balanceDelta', () => {
  describe('credit types (+amount)', () => {
    it.each([
      ['deposit'],
      ['winCredit'],
      ['openingBalance'],
      ['managerCredit'],
    ])('%s returns +amount', (type) => {
      expect(balanceDelta({ type, amount: 1500 })).toBe(1500)
    })
  })

  describe('spend', () => {
    it('returns -amount when method=wallet', () => {
      expect(balanceDelta({ type: 'spend', amount: 2500, method: 'wallet' })).toBe(-2500)
    })

    it.each([['cash'], ['eftpos'], ['payid'], ['ticket']])(
      'returns 0 when method=%s (external payment — no wallet impact)',
      (method) => {
        expect(balanceDelta({ type: 'spend', amount: 2500, method })).toBe(0)
      }
    )
  })

  describe('debit types (-amount)', () => {
    it.each([
      ['withdrawalComplete'],
      ['managerDebit'],
    ])('%s returns -amount', (type) => {
      expect(balanceDelta({ type, amount: 800 })).toBe(-800)
    })
  })

  describe('no-op types (0)', () => {
    it.each([
      ['ticketUse'],
      ['withdrawalRequest'],
      ['withdrawalCancel'],
    ])('%s returns 0', (type) => {
      expect(balanceDelta({ type, amount: 999 })).toBe(0)
    })
  })

  describe('adjustment', () => {
    it('throws — caller must apply sign explicitly', () => {
      expect(() => balanceDelta({ type: 'adjustment', amount: 100 })).toThrow(
        /adjustment requires explicit sign/
      )
    })
  })

  describe('unknown type', () => {
    it('throws with the offending type in the message', () => {
      expect(() => balanceDelta({ type: 'someBogusType', amount: 100 })).toThrow(
        /unknown type "someBogusType"/
      )
    })
  })
})

describe('ticketBalanceDelta', () => {
  it('returns +faceValue when type=ticketIssued', () => {
    expect(ticketBalanceDelta({ type: 'ticketIssued', ticketFaceValue: 5000 })).toBe(5000)
  })

  it('returns -faceValue when type=ticketUse', () => {
    expect(ticketBalanceDelta({ type: 'ticketUse', ticketFaceValue: 5000 })).toBe(-5000)
  })

  it('returns 0 for any other type', () => {
    expect(ticketBalanceDelta({ type: 'deposit', ticketFaceValue: 5000 })).toBe(0)
    expect(ticketBalanceDelta({ type: 'spend' })).toBe(0)
  })

  it('defaults ticketFaceValue to 0 when not supplied', () => {
    expect(ticketBalanceDelta({ type: 'ticketIssued' })).toBe(0)
  })
})

describe('walletTxDelta — entryRefund', () => {
  it('credits the balance back only for wallet-method refunds', () => {
    expect(walletTxDelta({ type: 'entryRefund', amount: 80_00, method: 'wallet', direction: null })).toBe(80_00)
  })
  it.each([['cash'], ['eftpos'], ['ticket']])('is neutral for %s refunds (money moves externally / via ticketBalance)', (method) => {
    expect(walletTxDelta({ type: 'entryRefund', amount: 80_00, method, direction: null })).toBe(0)
  })
})
