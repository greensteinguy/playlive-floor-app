import { describe, it, expect } from 'vitest'
import { offsetFromSample, medianOffset, shouldAdoptOffset } from './serverTime'

describe('offsetFromSample', () => {
  it('centers the truncated Date header and splits the round trip', () => {
    // local t0=1000, t1=1200 (rtt 200); server said 5000 (truncated second).
    // offset = 5000 + 500 + 100 - 1200 = 4400
    expect(offsetFromSample(1000, 1200, 5000)).toBe(4400)
  })

  it('is ~0 when clocks agree', () => {
    // server stamped mid-flight at local midpoint, header truncation aside
    expect(offsetFromSample(10_000, 10_200, 9_600)).toBe(0)
  })

  it('rejects unparsable header timestamps', () => {
    expect(offsetFromSample(1000, 1200, NaN)).toBeNull()
  })
})

describe('medianOffset', () => {
  it('takes the median and ignores failed samples', () => {
    expect(medianOffset([120, null, -3000, 80])).toBe(80)
    expect(medianOffset([50, 100])).toBe(75)
  })

  it('is null when every sample failed', () => {
    expect(medianOffset([null, null])).toBeNull()
    expect(medianOffset([])).toBeNull()
  })
})

describe('shouldAdoptOffset', () => {
  it('adopts a first estimate, keeps the current one under the noise threshold', () => {
    expect(shouldAdoptOffset(null, 200)).toBe(true)
    expect(shouldAdoptOffset(0, 200)).toBe(false)
    expect(shouldAdoptOffset(0, 1200)).toBe(true)
    expect(shouldAdoptOffset(0, null)).toBe(false)
  })
})
