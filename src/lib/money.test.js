import { describe, it, expect } from 'vitest'
import { formatMoney, centsToStr, dollarsToCents, intOrNull, intOf } from './money'

describe('formatMoney', () => {
  it('formats cents as a dollar string with two decimals', () => {
    expect(formatMoney(0)).toBe('$0.00')
    expect(formatMoney(100)).toBe('$1.00')
    expect(formatMoney(10000)).toBe('$100.00')
    expect(formatMoney(12345)).toBe('$123.45')
  })
})

describe('centsToStr', () => {
  it('renders zero as an empty string (so the field shows its placeholder)', () => {
    expect(centsToStr(0)).toBe('')
  })
  it('renders non-zero cents as a dollar string', () => {
    expect(centsToStr(10000)).toBe('100')
    expect(centsToStr(12345)).toBe('123.45')
    expect(centsToStr(50)).toBe('0.5')
  })
})

describe('dollarsToCents', () => {
  it('converts whole and fractional dollars to integer cents', () => {
    expect(dollarsToCents('100')).toBe(10000)
    expect(dollarsToCents('1.5')).toBe(150)
    expect(dollarsToCents('0.01')).toBe(1)
  })
  it('rounds to the nearest cent rather than truncating', () => {
    expect(dollarsToCents('12.346')).toBe(1235) // 1234.6 → 1235
    expect(dollarsToCents('12.344')).toBe(1234) // 1234.4 → 1234
    expect(dollarsToCents('99.999')).toBe(10000)
  })
  it('treats blank or non-numeric input as zero', () => {
    expect(dollarsToCents('')).toBe(0)
    expect(dollarsToCents('abc')).toBe(0)
    expect(dollarsToCents(null)).toBe(0)
    expect(dollarsToCents(undefined)).toBe(0)
  })
})

describe('intOrNull', () => {
  it('returns null for blank/nullish input', () => {
    expect(intOrNull('')).toBeNull()
    expect(intOrNull(null)).toBeNull()
    expect(intOrNull(undefined)).toBeNull()
  })
  it('parses integers and returns null for garbage', () => {
    expect(intOrNull('3')).toBe(3)
    expect(intOrNull('0')).toBe(0)
    expect(intOrNull('unlimited')).toBeNull()
  })
})

describe('intOf', () => {
  it('parses integers, defaulting to 0 for blank/garbage', () => {
    expect(intOf('20000')).toBe(20000)
    expect(intOf('')).toBe(0)
    expect(intOf('abc')).toBe(0)
  })
})
