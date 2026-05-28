import { describe, it, expect } from 'vitest'
import { BountyDraw } from './bountyDraw'
import { buildBountyDraw } from './_fixtures'

describe('BountyDraw', () => {
  it('accepts a minimal valid draw', () => {
    expect(() => BountyDraw.parse(buildBountyDraw())).not.toThrow()
  })

  it('rejects knocker == knockedOut', () => {
    const result = BountyDraw.safeParse(
      buildBountyDraw({ knockedOutEntryId: 'entry-x', knockerEntryId: 'entry-x' })
    )
    expect(result.success).toBe(false)
    expect(result.error.issues.some((i) => i.path.includes('knockedOutEntryId'))).toBe(true)
  })

  it('rejects bountyValue <= 0', () => {
    expect(BountyDraw.safeParse(buildBountyDraw({ bountyValue: 0 })).success).toBe(false)
  })
})
