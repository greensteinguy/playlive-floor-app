import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'
import { Table } from '../schema'

let mockState
let nextId

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  runValidatedBatch: vi.fn(),
  tables: { listTables: vi.fn() },
  generateId: vi.fn(() => nextId()),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    tablePath: (tid, id) => ['tournaments', tid, 'tables', id],
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
  },
}))

vi.mock('../players', () => ({
  playerDisplayName: (p) => p.displayName ?? `${p.firstName} ${p.lastName}`.trim(),
}))

import { runValidatedTransaction, runValidatedBatch, tables as tablesApi, auditLog } from '../firestore'
import {
  isSeatable,
  seatableEntries,
  tableCountFor,
  distributeCounts,
  shuffle,
  planSeatDraw,
  occupiedSeatCount,
  buildSeatList,
  drawSeats,
  clearSeating,
  seatEntry,
  unseatEntry,
  DEFAULT_SEAT_COUNT,
  TablesExistError,
  NoSeatableEntriesError,
  SeatOccupiedError,
  SeatOutOfRangeError,
  EntryNotSeatableError,
} from './seating'

const tablePath = (tid, id) => ['tournaments', tid, 'tables', id]

function makeEntry(overrides = {}) {
  return {
    id: 'entry-1',
    playerId: 'player-1',
    originSessionId: 'session-1',
    voidedAt: null,
    bustedAt: null,
    currentTableId: null,
    currentSeatNumber: null,
    ...overrides,
  }
}

function emptySeats(seatCount) {
  return Array.from({ length: seatCount }, (_, i) => ({ seatNumber: i + 1, entryId: null }))
}

function makeTable(overrides = {}) {
  return {
    id: 'table-1',
    tournamentId: 't1',
    sessionId: 'session-1',
    tableNumber: 1,
    seatCount: 9,
    openedAt: null,
    closedAt: null,
    status: 'open',
    seats: emptySeats(9),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  }
}

const tournament = { id: 't1', name: 'Friday $80', startingStack: 10_000, scheduledStartTime: Timestamp.now() }

// ── Pure planners ───────────────────────────────────────────────────────────

describe('isSeatable / seatableEntries', () => {
  it('only alive (not busted, not voided) entries in the session are seatable', () => {
    const alive = makeEntry({ id: 'a' })
    const busted = makeEntry({ id: 'b', bustedAt: Timestamp.now() })
    const voided = makeEntry({ id: 'c', voidedAt: Timestamp.now() })
    const otherSession = makeEntry({ id: 'd', originSessionId: 'session-2' })
    expect(isSeatable(alive)).toBe(true)
    expect(isSeatable(busted)).toBe(false)
    expect(isSeatable(voided)).toBe(false)
    const pool = seatableEntries([alive, busted, voided, otherSession], 'session-1')
    expect(pool.map((e) => e.id)).toEqual(['a'])
  })
})

describe('tableCountFor', () => {
  it('is ceil(players / seatCount), min 1, 0 for none', () => {
    expect(tableCountFor(0)).toBe(0)
    expect(tableCountFor(1)).toBe(1)
    expect(tableCountFor(9)).toBe(1)
    expect(tableCountFor(10)).toBe(2)
    expect(tableCountFor(19)).toBe(3)
    expect(tableCountFor(8, 8)).toBe(1)
    expect(tableCountFor(9, 8)).toBe(2)
  })
})

describe('distributeCounts', () => {
  it('spreads players evenly, leading tables take the remainder', () => {
    expect(distributeCounts(19, 3)).toEqual([7, 6, 6])
    expect(distributeCounts(18, 2)).toEqual([9, 9])
    expect(distributeCounts(10, 2)).toEqual([5, 5])
    expect(distributeCounts(1, 1)).toEqual([1])
    expect(distributeCounts(5, 0)).toEqual([])
  })
})

describe('shuffle', () => {
  it('is a permutation (same multiset, new array) and deterministic for a given rng', () => {
    const input = [1, 2, 3, 4, 5]
    const rng = () => 0 // deterministic
    const a = shuffle(input, rng)
    const b = shuffle(input, rng)
    expect(a).not.toBe(input)
    expect(input).toEqual([1, 2, 3, 4, 5]) // input untouched
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5])
    expect(a).toEqual(b) // same rng → same result
  })
})

describe('planSeatDraw', () => {
  it('seats every entry exactly once across evenly-filled, schema-valid tables', () => {
    const entries = Array.from({ length: 19 }, (_, i) => makeEntry({ id: `e${i}` }))
    const { tables, assignments } = planSeatDraw({ entries, rng: () => 0.5 })

    expect(tables).toHaveLength(3)
    expect(tables.map((t) => occupiedSeatCount(t))).toEqual([7, 6, 6])
    expect(tables.map((t) => t.tableNumber)).toEqual([1, 2, 3])

    // every entry seated exactly once, no duplicates, no one dropped
    const seated = assignments.map((a) => a.entryId).sort()
    expect(seated).toEqual(entries.map((e) => e.id).sort())
    expect(assignments).toHaveLength(19)

    // each produced table is a valid Table doc once wrapped
    for (const t of tables) {
      const parsed = Table.safeParse({
        id: 'x',
        tournamentId: 't1',
        sessionId: 's1',
        tableNumber: t.tableNumber,
        seatCount: t.seatCount,
        openedAt: null,
        closedAt: null,
        status: 'open',
        seats: t.seats,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
      expect(parsed.success).toBe(true)
    }
  })

  it('honours a custom seatCount and table number start', () => {
    const entries = Array.from({ length: 12 }, (_, i) => makeEntry({ id: `e${i}` }))
    const { tables } = planSeatDraw({ entries, seatCount: 6, tableNumberStart: 5, rng: () => 0 })
    expect(tables).toHaveLength(2)
    expect(tables.every((t) => t.seatCount === 6 && t.seats.length === 6)).toBe(true)
    expect(tables.map((t) => t.tableNumber)).toEqual([5, 6])
  })

  it('never seats more than seatCount at a table', () => {
    for (const n of [1, 8, 9, 10, 17, 18, 19, 27, 28, 50, 100]) {
      const entries = Array.from({ length: n }, (_, i) => makeEntry({ id: `e${i}` }))
      const { tables } = planSeatDraw({ entries, rng: () => 0.3 })
      expect(tables.every((t) => occupiedSeatCount(t) <= DEFAULT_SEAT_COUNT)).toBe(true)
      expect(tables.reduce((sum, t) => sum + occupiedSeatCount(t), 0)).toBe(n)
    }
  })
})

describe('buildSeatList', () => {
  it('emits one sorted row per occupied seat with the seat-card fields', () => {
    const tables = [
      makeTable({ id: 'tb2', tableNumber: 2, seats: [{ seatNumber: 1, entryId: 'e2' }, ...emptySeats(9).slice(1)] }),
      makeTable({ id: 'tb1', tableNumber: 1, seats: [{ seatNumber: 3, entryId: 'e1' }, ...emptySeats(9).filter((s) => s.seatNumber !== 3)] }),
    ]
    const entriesById = { e1: makeEntry({ id: 'e1', playerId: 'p1' }), e2: makeEntry({ id: 'e2', playerId: 'p2' }) }
    const playersById = {
      p1: { firstName: 'Ann', lastName: 'Lee', displayName: null },
      p2: { firstName: 'Bo', lastName: 'Ng', displayName: 'Boss' },
    }
    const rows = buildSeatList({ tables, entriesById, playersById, tournament })
    expect(rows).toHaveLength(2)
    // sorted by table number → table 1 first
    expect(rows[0]).toMatchObject({ tableNumber: 1, seatNumber: 3, playerName: 'Ann Lee', startingStack: 10_000, tournamentName: 'Friday $80' })
    expect(rows[1]).toMatchObject({ tableNumber: 2, seatNumber: 1, playerName: 'Boss' })
  })
})

// ── Impure ops ──────────────────────────────────────────────────────────────

describe('seating ops', () => {
  beforeEach(() => {
    mockState = makeMockStore()
    let counter = 0
    nextId = () => `table-${++counter}`
    runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
    runValidatedBatch.mockImplementation(async (fn) => fn(mockState.tx))
    tablesApi.listTables.mockResolvedValue([])
    auditLog.writeAuditLogSafe.mockClear()
  })

  describe('drawSeats', () => {
    it('creates the tables and seats every seatable entry, atomically', async () => {
      const entries = [
        ...Array.from({ length: 5 }, (_, i) => makeEntry({ id: `e${i}` })),
        makeEntry({ id: 'busted', bustedAt: Timestamp.now() }),
        makeEntry({ id: 'voided', voidedAt: Timestamp.now() }),
        makeEntry({ id: 'other', originSessionId: 'session-2' }),
      ]

      const res = await drawSeats({
        tournament,
        sessionId: 'session-1',
        entries,
        actorId: 'td-1',
        actorRole: 'td',
        rng: () => 0,
      })

      expect(res).toEqual({ tableCount: 1, seatedCount: 5 })

      const tableSets = mockState.calls.set.filter((c) => c.path[2] === 'tables')
      expect(tableSets).toHaveLength(1)
      expect(Table.safeParse({ ...tableSets[0].data, id: 'table-1' }).success).toBe(true)
      expect(occupiedSeatCount(tableSets[0].data)).toBe(5)

      // exactly the 5 alive entries got a seat, with both seat fields set
      const entryUpdates = mockState.calls.update.filter((c) => c.path[2] === 'entries')
      expect(entryUpdates).toHaveLength(5)
      expect(entryUpdates.map((c) => c.path[3]).sort()).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
      for (const u of entryUpdates) {
        expect(u.partial.currentTableId).toBe('table-1')
        expect(typeof u.partial.currentSeatNumber).toBe('number')
      }

      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'seating.drawn' })
      )
    })

    it('refuses to draw when tables already exist for the session', async () => {
      tablesApi.listTables.mockResolvedValue([makeTable({ sessionId: 'session-1' })])
      await expect(
        drawSeats({ tournament, sessionId: 'session-1', entries: [makeEntry()], actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(TablesExistError)
    })

    it('refuses to draw when there are no seatable entries', async () => {
      await expect(
        drawSeats({
          tournament,
          sessionId: 'session-1',
          entries: [makeEntry({ bustedAt: Timestamp.now() })],
          actorId: 'td-1',
          actorRole: 'td',
        })
      ).rejects.toBeInstanceOf(NoSeatableEntriesError)
    })
  })

  describe('seatEntry', () => {
    it('seats an unseated entry into an empty seat (table seat + entry both written)', async () => {
      mockState.seed(tablePath('t1', 'table-1'), makeTable({ id: 'table-1' }))
      const entry = makeEntry({ id: 'e1' })

      const res = await seatEntry({
        tournament,
        entry,
        targetTableId: 'table-1',
        targetSeatNumber: 3,
        actorId: 'td-1',
        actorRole: 'td',
      })

      expect(res).toEqual({ tableNumber: 1, seatNumber: 3 })
      const tableWrite = mockState.calls.set.find((c) => c.path[3] === 'table-1')
      expect(tableWrite.data.seats.find((s) => s.seatNumber === 3).entryId).toBe('e1')
      const entryWrite = mockState.calls.update.find((c) => c.path[3] === 'e1')
      expect(entryWrite.partial).toMatchObject({ currentTableId: 'table-1', currentSeatNumber: 3 })
      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'seating.seatAssigned' })
      )
    })

    it('rejects seating onto a seat held by another entry', async () => {
      mockState.seed(
        tablePath('t1', 'table-1'),
        makeTable({ id: 'table-1', seats: emptySeats(9).map((s) => (s.seatNumber === 3 ? { ...s, entryId: 'someone' } : s)) })
      )
      await expect(
        seatEntry({ tournament, entry: makeEntry({ id: 'e1' }), targetTableId: 'table-1', targetSeatNumber: 3, actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(SeatOccupiedError)
    })

    it('rejects a seat number that does not exist on the table', async () => {
      mockState.seed(tablePath('t1', 'table-1'), makeTable({ id: 'table-1' }))
      await expect(
        seatEntry({ tournament, entry: makeEntry({ id: 'e1' }), targetTableId: 'table-1', targetSeatNumber: 99, actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(SeatOutOfRangeError)
    })

    it('moving across tables frees the source seat and fills the target', async () => {
      mockState.seed(
        tablePath('t1', 'table-1'),
        makeTable({ id: 'table-1', tableNumber: 1, seats: emptySeats(9).map((s) => (s.seatNumber === 2 ? { ...s, entryId: 'e1' } : s)) })
      )
      mockState.seed(tablePath('t1', 'table-2'), makeTable({ id: 'table-2', tableNumber: 2 }))
      const entry = makeEntry({ id: 'e1', currentTableId: 'table-1', currentSeatNumber: 2 })

      await seatEntry({ tournament, entry, targetTableId: 'table-2', targetSeatNumber: 5, actorId: 'td-1', actorRole: 'td' })

      const source = mockState.calls.set.find((c) => c.path[3] === 'table-1')
      expect(source.data.seats.find((s) => s.seatNumber === 2).entryId).toBeNull()
      const target = mockState.calls.set.find((c) => c.path[3] === 'table-2')
      expect(target.data.seats.find((s) => s.seatNumber === 5).entryId).toBe('e1')
    })

    it('refuses to seat a busted entry', async () => {
      await expect(
        seatEntry({ tournament, entry: makeEntry({ bustedAt: Timestamp.now() }), targetTableId: 'table-1', targetSeatNumber: 1, actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(EntryNotSeatableError)
    })
  })

  describe('unseatEntry', () => {
    it('clears the table seat and the entry seat fields', async () => {
      mockState.seed(
        tablePath('t1', 'table-1'),
        makeTable({ id: 'table-1', seats: emptySeats(9).map((s) => (s.seatNumber === 4 ? { ...s, entryId: 'e1' } : s)) })
      )
      const entry = makeEntry({ id: 'e1', currentTableId: 'table-1', currentSeatNumber: 4 })

      await unseatEntry({ tournament, entry, actorId: 'td-1', actorRole: 'td' })

      const tableWrite = mockState.calls.set.find((c) => c.path[3] === 'table-1')
      expect(tableWrite.data.seats.find((s) => s.seatNumber === 4).entryId).toBeNull()
      const entryWrite = mockState.calls.update.find((c) => c.path[3] === 'e1')
      expect(entryWrite.partial).toMatchObject({ currentTableId: null, currentSeatNumber: null })
    })
  })

  describe('clearSeating', () => {
    it('deletes the session tables and unseats their entries', async () => {
      tablesApi.listTables.mockResolvedValue([
        makeTable({ id: 'table-1', sessionId: 'session-1', seats: emptySeats(9).map((s) => (s.seatNumber <= 2 ? { ...s, entryId: `e${s.seatNumber}` } : s)) }),
        makeTable({ id: 'table-2', sessionId: 'session-2' }), // different session — untouched
      ])

      const res = await clearSeating({ tournament, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })

      expect(res).toEqual({ tablesRemoved: 1, entriesUnseated: 2 })
      expect(mockState.calls.delete.map((c) => c.path[3])).toEqual(['table-1'])
      const cleared = mockState.calls.update.filter((c) => c.path[2] === 'entries')
      expect(cleared.map((c) => c.path[3]).sort()).toEqual(['e1', 'e2'])
      expect(cleared.every((c) => c.partial.currentTableId === null)).toBe(true)
    })
  })
})
