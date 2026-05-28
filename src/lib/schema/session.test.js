import { describe, it, expect } from 'vitest'
import { Session } from './session'
import { buildSession } from './_fixtures'

describe('Session', () => {
  it('accepts a minimal final session (converges into null, no end cap)', () => {
    // Final session = convergesIntoSessionId is null. No termination criterion needed
    // because it plays to a winner.
    expect(() => Session.parse(buildSession())).not.toThrow()
  })

  describe('non-final sessions need a termination criterion', () => {
    it('rejects non-final session with neither maximumEndIndex nor playToPercentRemaining', () => {
      const result = Session.safeParse(
        buildSession({
          convergesIntoSessionId: 'next-session',
          maximumEndIndex: null,
          playToPercentRemaining: null,
        })
      )
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes('maximumEndIndex'))).toBe(true)
    })

    it('accepts non-final session with maximumEndIndex set', () => {
      expect(() =>
        Session.parse(
          buildSession({
            convergesIntoSessionId: 'next-session',
            maximumStartIndex: 0,
            maximumEndIndex: 5,
          })
        )
      ).not.toThrow()
    })

    it('accepts non-final session with playToPercentRemaining set', () => {
      expect(() =>
        Session.parse(
          buildSession({
            convergesIntoSessionId: 'next-session',
            playToPercentRemaining: 15,
          })
        )
      ).not.toThrow()
    })
  })

  describe('slice index invariants', () => {
    it('rejects maximumStartIndex > maximumEndIndex', () => {
      const result = Session.safeParse(
        buildSession({ maximumStartIndex: 5, maximumEndIndex: 3 })
      )
      expect(result.success).toBe(false)
    })

    it('rejects actualEndIndex < actualStartIndex', () => {
      const result = Session.safeParse(
        buildSession({
          maximumStartIndex: 0,
          maximumEndIndex: 10,
          actualStartIndex: 4,
          actualEndIndex: 2,
        })
      )
      expect(result.success).toBe(false)
    })

    it('rejects actualEndIndex > maximumEndIndex', () => {
      const result = Session.safeParse(
        buildSession({
          maximumStartIndex: 0,
          maximumEndIndex: 5,
          actualStartIndex: 0,
          actualEndIndex: 6,
        })
      )
      expect(result.success).toBe(false)
    })

    it('accepts actualEndIndex == maximumEndIndex', () => {
      expect(() =>
        Session.parse(
          buildSession({
            maximumStartIndex: 0,
            maximumEndIndex: 5,
            actualStartIndex: 0,
            actualEndIndex: 5,
          })
        )
      ).not.toThrow()
    })
  })

  describe('currentStructureIndex bounds', () => {
    it('rejects when below actualStartIndex', () => {
      const result = Session.safeParse(
        buildSession({
          maximumStartIndex: 2,
          maximumEndIndex: 10,
          actualStartIndex: 2,
          currentStructureIndex: 1,
        })
      )
      expect(result.success).toBe(false)
    })

    it('rejects when above actualEndIndex', () => {
      const result = Session.safeParse(
        buildSession({
          maximumStartIndex: 0,
          maximumEndIndex: 5,
          actualStartIndex: 0,
          actualEndIndex: 4,
          currentStructureIndex: 5,
        })
      )
      expect(result.success).toBe(false)
    })

    it('accepts when within bounds', () => {
      expect(() =>
        Session.parse(
          buildSession({
            maximumStartIndex: 0,
            maximumEndIndex: 5,
            actualStartIndex: 0,
            actualEndIndex: 5,
            currentStructureIndex: 3,
          })
        )
      ).not.toThrow()
    })
  })
})
