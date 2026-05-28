import { describe, it, expect } from 'vitest'
import { Player } from './player'
import { buildPlayer, ts } from './_fixtures'

describe('Player', () => {
  it('accepts a minimal valid player', () => {
    expect(() => Player.parse(buildPlayer())).not.toThrow()
  })

  describe('walletBalance HARD invariant', () => {
    it('rejects negative walletBalance', () => {
      // Money is z.number().int().nonnegative(), so the field-level rule fires first.
      const result = Player.safeParse(buildPlayer({ walletBalance: -1 }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('walletBalance'))).toBe(true)
    })

    it('rejects non-integer walletBalance', () => {
      const result = Player.safeParse(buildPlayer({ walletBalance: 1.5 }))
      expect(result.success).toBe(false)
    })

    it('accepts walletBalance = 0', () => {
      expect(() => Player.parse(buildPlayer({ walletBalance: 0 }))).not.toThrow()
    })
  })

  describe('merge state consistency', () => {
    it('accepts isMerged=true with both mergedIntoId and mergedAt set', () => {
      expect(() =>
        Player.parse(
          buildPlayer({ isMerged: true, mergedIntoId: 'player-other', mergedAt: ts() })
        )
      ).not.toThrow()
    })

    it('rejects isMerged=true with mergedIntoId null', () => {
      const result = Player.safeParse(
        buildPlayer({ isMerged: true, mergedIntoId: null, mergedAt: ts() })
      )
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('mergedIntoId'))).toBe(true)
    })

    it('rejects isMerged=true with mergedAt null', () => {
      const result = Player.safeParse(
        buildPlayer({ isMerged: true, mergedIntoId: 'player-other', mergedAt: null })
      )
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('mergedAt'))).toBe(true)
    })

    it('rejects isMerged=false with mergedIntoId set', () => {
      const result = Player.safeParse(
        buildPlayer({ isMerged: false, mergedIntoId: 'player-other', mergedAt: null })
      )
      expect(result.success).toBe(false)
    })

    it('rejects isMerged=false with mergedAt set', () => {
      const result = Player.safeParse(
        buildPlayer({ isMerged: false, mergedIntoId: null, mergedAt: ts() })
      )
      expect(result.success).toBe(false)
    })
  })

  it('rejects an invalid country code shape', () => {
    expect(Player.safeParse(buildPlayer({ countryCode: 'aus' })).success).toBe(false)
    expect(Player.safeParse(buildPlayer({ countryCode: 'au' })).success).toBe(false) // lowercase
    expect(Player.safeParse(buildPlayer({ countryCode: 'AU' })).success).toBe(true)
  })
})
