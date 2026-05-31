import { describe, it, expect } from 'vitest'
import {
  paymentMethodLabel,
  entryTypeLabel,
  entryWinnings,
  ordinal,
  entryResultLabel,
  summarizeEntries,
} from './entryDisplay'

describe('labels', () => {
  it('maps payment methods and entry types, passing unknowns through', () => {
    expect(paymentMethodLabel('eftpos')).toBe('EFTPOS')
    expect(paymentMethodLabel('wallet')).toBe('Wallet')
    expect(paymentMethodLabel('mystery')).toBe('mystery')
    expect(entryTypeLabel('reentry')).toBe('Re-entry')
    expect(entryTypeLabel('addOn')).toBe('Add-on')
  })
})

describe('entryWinnings', () => {
  it('sums cash, ticket, and bounty', () => {
    expect(entryWinnings({ cashWinnings: 100_00, ticketWinnings: 50_00, bountyEarnings: 25_00 })).toBe(175_00)
  })
  it('treats missing fields as 0', () => {
    expect(entryWinnings({ cashWinnings: 100_00 })).toBe(100_00)
    expect(entryWinnings({})).toBe(0)
  })
})

describe('ordinal', () => {
  it('formats common cases', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(23)).toBe('23rd')
  })
  it('returns empty for null', () => {
    expect(ordinal(null)).toBe('')
  })
})

describe('entryResultLabel', () => {
  it('shows the finishing place when busted with one', () => {
    expect(entryResultLabel({ bustedAt: {}, finishingPlace: 3 })).toBe('Out — 3rd')
  })
  it('shows Busted when busted with no place', () => {
    expect(entryResultLabel({ bustedAt: {}, finishingPlace: null })).toBe('Busted')
  })
  it('shows Seated when seated and alive', () => {
    expect(entryResultLabel({ bustedAt: null, currentSeatNumber: 4 })).toBe('Seated')
  })
  it('shows In when alive but not seated', () => {
    expect(entryResultLabel({ bustedAt: null, currentSeatNumber: null })).toBe('In')
  })
  it('shows Voided regardless of other state', () => {
    expect(entryResultLabel({ voidedAt: {}, bustedAt: {}, finishingPlace: 2 })).toBe('Voided')
  })
})

describe('summarizeEntries', () => {
  it('counts played, total buy-ins, and total winnings (excluding voided)', () => {
    const entries = [
      { paymentAmount: 100_00, cashWinnings: 300_00, ticketWinnings: 0, bountyEarnings: 0, voidedAt: null },
      { paymentAmount: 100_00, cashWinnings: 0, ticketWinnings: 0, bountyEarnings: 50_00, voidedAt: null }, // re-entry
      { paymentAmount: 100_00, cashWinnings: 0, ticketWinnings: 0, bountyEarnings: 0, voidedAt: {} }, // voided — ignored
    ]
    expect(summarizeEntries(entries)).toEqual({
      played: 2,
      totalSpent: 200_00,
      totalWinnings: 350_00,
    })
  })

  it('is all-zero for no entries', () => {
    expect(summarizeEntries([])).toEqual({ played: 0, totalSpent: 0, totalWinnings: 0 })
  })
})
