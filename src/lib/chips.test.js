import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHIP_DENOMINATIONS,
  normaliseChips,
  smallestChipByIndex,
  isPostable,
  autoBlindsFor,
  followsAutoBlinds,
} from './chips'

const lvl = (bb, extra = {}) => ({ type: 'level', bigBlind: bb, smallBlind: bb / 2, ante: bb, ...extra })
const brk = (isColorUp) => ({ type: 'break', durationMinutes: 10, label: null, isColorUp })

describe('normaliseChips', () => {
  it('dedupes, sorts, and drops junk', () => {
    expect(normaliseChips([500, 100, 100, 0, -5, 2.5, 25])).toEqual([25, 100, 500])
    expect(normaliseChips(null)).toEqual([])
  })
  it('default set is already normal', () => {
    expect(normaliseChips(DEFAULT_CHIP_DENOMINATIONS)).toEqual(DEFAULT_CHIP_DENOMINATIONS)
  })
})

describe('smallestChipByIndex', () => {
  const chips = [10, 50, 100, 500, 1000, 5000]

  it('is all null without a smallest chip', () => {
    expect(smallestChipByIndex([lvl(200), brk(true)], chips, null)).toEqual([null, null])
  })

  it('starts at the named chip, ignoring smaller ones, and steps up after each colour-up', () => {
    const s = [lvl(200), brk(false), lvl(400), brk(true), lvl(1000), brk(true), lvl(4000)]
    expect(smallestChipByIndex(s, chips, 100)).toEqual([100, 100, 100, 100, 500, 500, 1000])
  })

  it('treats a starting chip missing from the settings list as in play', () => {
    expect(smallestChipByIndex([lvl(50), brk(true), lvl(200)], [100, 500], 25)).toEqual([25, 25, 100])
  })

  it('stays on the largest chip once every chip is coloured up', () => {
    expect(smallestChipByIndex([brk(true), brk(true), lvl(10000)], [100, 500], 100)).toEqual([100, 500, 500])
  })
})

describe('isPostable', () => {
  it("flags the 1500/750 case once only 100s remain", () => {
    expect(isPostable(750, 100)).toBe(false)
    expect(isPostable(1500, 100)).toBe(true)
  })
  it('passes zero and unchecked levels', () => {
    expect(isPostable(0, 500)).toBe(true)
    expect(isPostable(750, null)).toBe(true)
  })
})

describe('auto blinds', () => {
  it('halves the small blind and matches the ante', () => {
    expect(autoBlindsFor(1500)).toEqual({ smallBlind: 750, ante: 1500 })
  })
  it('recognises a structure already on the rule', () => {
    expect(followsAutoBlinds([lvl(200), brk(false), lvl(400)])).toBe(true)
    expect(followsAutoBlinds([lvl(200, { ante: 0 })])).toBe(false)
    expect(followsAutoBlinds([])).toBe(false)
  })
})
