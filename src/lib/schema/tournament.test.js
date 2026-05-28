import { describe, it, expect } from 'vitest'
import { Tournament } from './tournament'
import { buildTournament } from './_fixtures'

describe('Tournament', () => {
  it('accepts a minimal valid tournament', () => {
    expect(() => Tournament.parse(buildTournament())).not.toThrow()
  })

  describe('multi-day / multi-flight invariant', () => {
    it('rejects isMultiFlight=true with isMultiDay=false', () => {
      const result = Tournament.safeParse(
        buildTournament({ isMultiFlight: true, isMultiDay: false })
      )
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('isMultiFlight'))).toBe(true)
    })

    it('accepts isMultiFlight=true with isMultiDay=true', () => {
      expect(() =>
        Tournament.parse(buildTournament({ isMultiFlight: true, isMultiDay: true }))
      ).not.toThrow()
    })

    it('accepts multi-day without multi-flight (single-flight per day is fine)', () => {
      expect(() =>
        Tournament.parse(buildTournament({ isMultiDay: true, isMultiFlight: false }))
      ).not.toThrow()
    })
  })

  describe('satelliteConfig invariant', () => {
    it('rejects gameType=satellite without satelliteConfig', () => {
      const result = Tournament.safeParse(
        buildTournament({ gameType: 'satellite', satelliteConfig: null })
      )
      expect(result.success).toBe(false)
    })

    it('rejects non-satellite gameType WITH satelliteConfig set', () => {
      const result = Tournament.safeParse(
        buildTournament({ gameType: 'nlh', satelliteConfig: { ticketReward: 50_00 } })
      )
      expect(result.success).toBe(false)
    })

    it('accepts gameType=satellite WITH satelliteConfig set', () => {
      expect(() =>
        Tournament.parse(
          buildTournament({ gameType: 'satellite', satelliteConfig: { ticketReward: 50_00 } })
        )
      ).not.toThrow()
    })
  })

  describe('bountyPoolConfig invariant', () => {
    it('rejects gameType=mysteryBounty without bountyPoolConfig', () => {
      const result = Tournament.safeParse(
        buildTournament({ gameType: 'mysteryBounty', bountyPoolConfig: null })
      )
      expect(result.success).toBe(false)
    })

    it('rejects non-mysteryBounty gameType WITH bountyPoolConfig set', () => {
      const result = Tournament.safeParse(
        buildTournament({
          gameType: 'nlh',
          bountyPoolConfig: { totalPool: 100_00, bountyValues: [100_00] },
        })
      )
      expect(result.success).toBe(false)
    })

    it('accepts mysteryBounty WITH bountyPoolConfig set', () => {
      expect(() =>
        Tournament.parse(
          buildTournament({
            gameType: 'mysteryBounty',
            bountyPoolConfig: { totalPool: 300_00, bountyValues: [100_00, 200_00] },
          })
        )
      ).not.toThrow()
    })

    it('rejects bountyPoolConfig when bountyValues do not sum to totalPool', () => {
      const result = Tournament.safeParse(
        buildTournament({
          gameType: 'mysteryBounty',
          bountyPoolConfig: { totalPool: 500_00, bountyValues: [100_00, 200_00] },
        })
      )
      expect(result.success).toBe(false)
    })
  })

  describe('currentStructureIndex bounds', () => {
    it('rejects when out of bounds', () => {
      // The default fixture's structure has length 4 (3 levels + 1 break).
      const result = Tournament.safeParse(buildTournament({ currentStructureIndex: 4 }))
      expect(result.success).toBe(false)
      expect(
        result.error.issues.some((i) => i.path.includes('currentStructureIndex'))
      ).toBe(true)
    })

    it('accepts when within bounds (incl. landing on a break entry)', () => {
      // index 2 is the break entry in the fixture structure
      expect(() => Tournament.parse(buildTournament({ currentStructureIndex: 2 }))).not.toThrow()
    })

    it('accepts null', () => {
      expect(() => Tournament.parse(buildTournament({ currentStructureIndex: null }))).not.toThrow()
    })
  })

  describe('structure (embedded discriminated union)', () => {
    it('rejects non-sequential blindNumber', () => {
      const result = Tournament.safeParse(
        buildTournament({
          structure: [
            { type: 'level', blindNumber: 1, smallBlind: 25, bigBlind: 50, ante: 0, bringIn: 0, durationMinutes: 20 },
            { type: 'level', blindNumber: 3, smallBlind: 50, bigBlind: 100, ante: 0, bringIn: 0, durationMinutes: 20 },
          ],
        })
      )
      expect(result.success).toBe(false)
    })

    it('accepts levels around a break with blindNumber unaffected', () => {
      // break does not advance blindNumber
      expect(() =>
        Tournament.parse(
          buildTournament({
            structure: [
              { type: 'level', blindNumber: 1, smallBlind: 25, bigBlind: 50, ante: 0, bringIn: 0, durationMinutes: 20 },
              { type: 'break', durationMinutes: 10, label: null, isColorUp: false },
              { type: 'level', blindNumber: 2, smallBlind: 50, bigBlind: 100, ante: 0, bringIn: 0, durationMinutes: 20 },
            ],
          })
        )
      ).not.toThrow()
    })
  })

  it('rejects unknown fields (strict mode)', () => {
    const result = Tournament.safeParse({ ...buildTournament(), somethingExtra: 'nope' })
    expect(result.success).toBe(false)
  })
})
