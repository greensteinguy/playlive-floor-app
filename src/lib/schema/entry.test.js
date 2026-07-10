import { describe, it, expect } from 'vitest'
import { Entry } from './entry'
import { buildEntry, ts } from './_fixtures'

describe('Entry', () => {
  it('accepts a minimal valid entry', () => {
    expect(() => Entry.parse(buildEntry())).not.toThrow()
  })

  describe('seat consistency', () => {
    it('rejects currentTableId set with currentSeatNumber null', () => {
      const result = Entry.safeParse(
        buildEntry({ currentTableId: 'table-1', currentSeatNumber: null })
      )
      expect(result.success).toBe(false)
    })

    it('rejects currentSeatNumber set with currentTableId null', () => {
      const result = Entry.safeParse(
        buildEntry({ currentTableId: null, currentSeatNumber: 4 })
      )
      expect(result.success).toBe(false)
    })

    it('accepts both set', () => {
      expect(() =>
        Entry.parse(buildEntry({ currentTableId: 'table-1', currentSeatNumber: 4 }))
      ).not.toThrow()
    })

    it('accepts both null', () => {
      expect(() =>
        Entry.parse(buildEntry({ currentTableId: null, currentSeatNumber: null }))
      ).not.toThrow()
    })
  })

  describe('bust consistency', () => {
    it('rejects bustedAt set with bustedInSessionId null', () => {
      const result = Entry.safeParse(
        buildEntry({ bustedAt: ts(), bustedInSessionId: null })
      )
      expect(result.success).toBe(false)
    })

    it('rejects bustedInSessionId set with bustedAt null', () => {
      const result = Entry.safeParse(
        buildEntry({ bustedAt: null, bustedInSessionId: 'session-1' })
      )
      expect(result.success).toBe(false)
    })

    it('rejects busted entry with currentTableId still set', () => {
      const result = Entry.safeParse(
        buildEntry({
          bustedAt: ts(),
          bustedInSessionId: 'session-1',
          currentTableId: 'table-1',
          currentSeatNumber: 4,
        })
      )
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('currentTableId'))).toBe(true)
    })

    it('accepts a properly busted entry (table cleared)', () => {
      expect(() =>
        Entry.parse(
          buildEntry({
            bustedAt: ts(),
            bustedInSessionId: 'session-1',
            currentTableId: null,
            currentSeatNumber: null,
            finishingPlace: 50,
          })
        )
      ).not.toThrow()
    })
  })

  describe('voided consistency (all three or none)', () => {
    it('rejects partial: voidedAt only', () => {
      const result = Entry.safeParse(buildEntry({ voidedAt: ts() }))
      expect(result.success).toBe(false)
    })

    it('rejects partial: voidedBy + voidReason but no voidedAt', () => {
      const result = Entry.safeParse(
        buildEntry({ voidedBy: 'manager-1', voidReason: 'data entry mistake' })
      )
      expect(result.success).toBe(false)
    })

    it('accepts all three set', () => {
      expect(() =>
        Entry.parse(
          buildEntry({
            voidedAt: ts(),
            voidedBy: 'manager-1',
            voidReason: 'data entry mistake',
          })
        )
      ).not.toThrow()
    })
  })

  describe('winnings paid state (task 4.7)', () => {
    it('defaults both paid-state fields to null when absent (pre-field docs stay readable)', () => {
      const parsed = Entry.parse(buildEntry()) // fixture predates the fields
      expect(parsed.winningsPaidAt).toBeNull()
      expect(parsed.winningsWalletTransactionId).toBeNull()
    })

    it('accepts a paid row (both set) and a staged row (cashWinnings only)', () => {
      expect(() =>
        Entry.parse(
          buildEntry({
            bustedAt: ts(),
            bustedInSessionId: 'session-1',
            finishingPlace: 2,
            cashWinnings: 300_00,
            winningsPaidAt: ts(),
            winningsWalletTransactionId: 'wtx-1',
          })
        )
      ).not.toThrow()
      expect(() => Entry.parse(buildEntry({ cashWinnings: 300_00 }))).not.toThrow()
    })

    it('accepts winningsPaidAt without a wallet-transaction link (future cash-at-till channel)', () => {
      expect(() => Entry.parse(buildEntry({ cashWinnings: 300_00, winningsPaidAt: ts() }))).not.toThrow()
    })

    it('rejects a wallet-transaction link on an unpaid row', () => {
      const result = Entry.safeParse(buildEntry({ winningsWalletTransactionId: 'wtx-1' }))
      expect(result.success).toBe(false)
    })
  })

  describe('satellite ticket issued state (task 4.7, ticket half)', () => {
    it('defaults both ticket-issued fields to null when absent (pre-field docs stay readable)', () => {
      const parsed = Entry.parse(buildEntry()) // fixture predates the fields
      expect(parsed.ticketIssuedAt).toBeNull()
      expect(parsed.issuedTicketId).toBeNull()
    })

    it('accepts an issued row (both set)', () => {
      expect(() =>
        Entry.parse(
          buildEntry({
            bustedAt: ts(),
            bustedInSessionId: 'session-1',
            ticketWinnings: 150_00,
            ticketIssuedAt: ts(),
            issuedTicketId: 'ticket-1',
          })
        )
      ).not.toThrow()
    })

    it('rejects ticketIssuedAt without issuedTicketId (both-or-neither)', () => {
      const result = Entry.safeParse(buildEntry({ ticketWinnings: 150_00, ticketIssuedAt: ts() }))
      expect(result.success).toBe(false)
    })

    it('rejects issuedTicketId without ticketIssuedAt (both-or-neither)', () => {
      const result = Entry.safeParse(buildEntry({ ticketWinnings: 150_00, issuedTicketId: 'ticket-1' }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('issuedTicketId'))).toBe(true)
    })
  })
})
