import { describe, it, expect } from 'vitest'
import { Table } from './table'
import { buildTable, ts } from './_fixtures'

describe('Table', () => {
  it('accepts a minimal table', () => {
    expect(() => Table.parse(buildTable())).not.toThrow()
  })

  describe('seats array invariants', () => {
    it('rejects seats.length !== seatCount', () => {
      const result = Table.safeParse(
        buildTable({
          seatCount: 9,
          seats: [
            { seatNumber: 1, entryId: null },
            { seatNumber: 2, entryId: null },
          ],
        })
      )
      expect(result.success).toBe(false)
    })

    it('rejects non-sequential seat numbers', () => {
      const result = Table.safeParse(
        buildTable({
          seatCount: 3,
          seats: [
            { seatNumber: 1, entryId: null },
            { seatNumber: 2, entryId: null },
            { seatNumber: 5, entryId: null }, // gap
          ],
        })
      )
      expect(result.success).toBe(false)
    })

    it('rejects duplicate seat numbers', () => {
      const result = Table.safeParse(
        buildTable({
          seatCount: 3,
          seats: [
            { seatNumber: 1, entryId: null },
            { seatNumber: 1, entryId: null },
            { seatNumber: 3, entryId: null },
          ],
        })
      )
      expect(result.success).toBe(false)
    })
  })

  describe('status / lifecycle invariants', () => {
    it('rejects status=broken with closedAt=null', () => {
      const result = Table.safeParse(
        buildTable({ status: 'broken', closedAt: null, openedAt: ts() })
      )
      expect(result.success).toBe(false)
    })

    it('rejects closedAt set without openedAt', () => {
      const result = Table.safeParse(
        buildTable({ status: 'broken', closedAt: ts(), openedAt: null })
      )
      expect(result.success).toBe(false)
    })

    it('accepts status=broken with both opened and closed timestamps', () => {
      expect(() =>
        Table.parse(buildTable({ status: 'broken', openedAt: ts(), closedAt: ts() }))
      ).not.toThrow()
    })
  })
})
