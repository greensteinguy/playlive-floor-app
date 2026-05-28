import { describe, it, expect } from 'vitest'
import { Ticket } from './ticket'
import { buildTicket, ts } from './_fixtures'

describe('Ticket', () => {
  it('accepts an unused ticket with all used-* fields null', () => {
    expect(() => Ticket.parse(buildTicket())).not.toThrow()
  })

  it('accepts a used ticket with all three used-* fields set', () => {
    expect(() =>
      Ticket.parse(
        buildTicket({
          state: 'used',
          usedAt: ts(),
          usedOnEntryId: 'entry-1',
          usedOnTournamentId: 'tournament-1',
        })
      )
    ).not.toThrow()
  })

  describe('used state requires all used-* fields', () => {
    it.each([
      ['usedAt', null],
      ['usedOnEntryId', null],
      ['usedOnTournamentId', null],
    ])('rejects used ticket with %s = null', (field, value) => {
      const result = Ticket.safeParse(
        buildTicket({
          state: 'used',
          usedAt: ts(),
          usedOnEntryId: 'entry-1',
          usedOnTournamentId: 'tournament-1',
          [field]: value,
        })
      )
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })

  it('rejects unused ticket with stray used-* field', () => {
    const result = Ticket.safeParse(
      buildTicket({ state: 'unused', usedAt: ts() })
    )
    expect(result.success).toBe(false)
  })

  it('rejects faceValue <= 0', () => {
    expect(Ticket.safeParse(buildTicket({ faceValue: 0 })).success).toBe(false)
    expect(Ticket.safeParse(buildTicket({ faceValue: -1 })).success).toBe(false)
  })
})
