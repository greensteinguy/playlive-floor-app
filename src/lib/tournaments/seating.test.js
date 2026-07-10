import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'
import { Table } from '../schema'

let mockState
let nextId

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  runValidatedBatch: vi.fn(),
  validatedSet: vi.fn(),
  tables: { listTables: vi.fn() },
  entries: { listEntries: vi.fn() },
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

// eliminateEntry recounts the tournament counters via registration; stub it so the
// seating tests stay focused on the seat/entry writes (recount has its own tests).
vi.mock('./registration', () => ({
  recountTournamentEntries: vi.fn().mockResolvedValue({ remainingPlayerCount: 0 }),
}))

import { runValidatedTransaction, runValidatedBatch, validatedSet, tables as tablesApi, entries as entriesApi, auditLog } from '../firestore'
import { recountTournamentEntries } from './registration'
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
  eliminateEntry,
  revertElimination,
  nextFinishingPlace,
  finishingOrder,
  balanceTables,
  breakTable,
  seatNextAlternate,
  openTable,
  setTableActive,
  tableSizes,
  isBalanced,
  planBalance,
  planBreak,
  canBreakTable,
  waitlist,
  firstEmptySeat,
  randomEmptySeat,
  fillableTables,
  DEFAULT_SEAT_COUNT,
  SeatingError,
  TablesExistError,
  NoSeatableEntriesError,
  SeatOccupiedError,
  SeatOutOfRangeError,
  EntryNotSeatableError,
  AlreadyBustedError,
  NotBustedError,
  LastPlayerStandingError,
  RevertBlockedByPayoutError,
  CannotBreakTableError,
  NoAlternatesError,
  NoOpenSeatError,
} from './seating'

const tablePath = (tid, id) => ['tournaments', tid, 'tables', id]
const entryPath = (tid, eid) => ['tournaments', tid, 'entries', eid]

function makeEntry(overrides = {}) {
  return {
    id: 'entry-1',
    playerId: 'player-1',
    originSessionId: 'session-1',
    voidedAt: null,
    bustedAt: null,
    bustedInSessionId: null,
    finishingPlace: null,
    cashWinnings: 0,
    ticketWinnings: 0,
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

describe('nextFinishingPlace / finishingOrder (task 4.1)', () => {
  it('nextFinishingPlace = alive entries (voided never count, busted are out)', () => {
    const entries = [
      makeEntry({ id: 'a' }),
      makeEntry({ id: 'b' }),
      makeEntry({ id: 'c', bustedAt: Timestamp.now() }),
      makeEntry({ id: 'd', voidedAt: Timestamp.now() }),
    ]
    expect(nextFinishingPlace(entries)).toBe(2)
    expect(nextFinishingPlace([])).toBe(0)
    expect(nextFinishingPlace(null)).toBe(0)
  })

  it('finishingOrder lists busted (non-voided) entries deepest finish first; unplaced legacy busts last by bust time', () => {
    const busted = (id, place, ms) =>
      makeEntry({ id, bustedAt: Timestamp.fromMillis(ms), bustedInSessionId: 's1', finishingPlace: place })
    const entries = [
      makeEntry({ id: 'alive' }),
      busted('second', 2, 5000),
      busted('ninth', 9, 1000),
      busted('legacyLate', null, 4000),
      busted('legacyEarly', null, 2000),
      busted('fifth', 5, 3000),
      makeEntry({ id: 'void', voidedAt: Timestamp.now(), bustedAt: Timestamp.fromMillis(500) }),
    ]
    expect(finishingOrder(entries).map((e) => e.id)).toEqual([
      'ninth',
      'fifth',
      'second',
      'legacyEarly',
      'legacyLate',
    ])
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
    entriesApi.listEntries.mockResolvedValue([])
    auditLog.writeAuditLogSafe.mockClear()
    recountTournamentEntries.mockClear()
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

  describe('eliminateEntry', () => {
    // Mirror an entries subcollection: the outside list + the seeded docs the
    // transaction re-reads.
    const seedEntries = (list) => {
      entriesApi.listEntries.mockResolvedValue(list)
      for (const e of list) mockState.seed(entryPath('t1', e.id), e)
    }
    const entrySet = (id) => mockState.calls.set.find((c) => c.path[2] === 'entries' && c.path[3] === id)

    it('busts a seated entry: frees the seat, marks busted with the finishing place, recounts, audits', async () => {
      mockState.seed(
        tablePath('t1', 'table-1'),
        makeTable({ id: 'table-1', seats: emptySeats(9).map((s) => (s.seatNumber === 4 ? { ...s, entryId: 'e1' } : s)) })
      )
      const entry = makeEntry({ id: 'e1', currentTableId: 'table-1', currentSeatNumber: 4 })
      seedEntries([
        entry,
        makeEntry({ id: 'e2' }),
        makeEntry({ id: 'e3' }),
        makeEntry({ id: 'out', bustedAt: Timestamp.now(), bustedInSessionId: 'session-1', finishingPlace: 4 }),
        makeEntry({ id: 'void', voidedAt: Timestamp.now() }),
      ])

      const res = await eliminateEntry({ tournament, entry, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })

      // 3 alive (e1, e2, e3) at the moment of the bust → 3rd place
      expect(res).toEqual({ ok: true, finishingPlace: 3 })
      // seat freed on the table
      const tableWrite = mockState.calls.set.find((c) => c.path[3] === 'table-1')
      expect(tableWrite.data.seats.find((s) => s.seatNumber === 4).entryId).toBeNull()
      // entry marked busted, place assigned, seat fields cleared — one full-doc write
      const entryWrite = entrySet('e1')
      expect(entryWrite.data).toMatchObject({
        currentTableId: null,
        currentSeatNumber: null,
        bustedInSessionId: 'session-1',
        finishingPlace: 3,
      })
      expect(entryWrite.data.bustedAt).toBeTruthy()
      // counters refreshed + audited with the place
      expect(recountTournamentEntries).toHaveBeenCalledWith({ tournamentId: 't1' })
      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'entry.busted',
          targetId: 'e1',
          metadata: expect.objectContaining({ place: 3 }),
        })
      )
    })

    it('busts an unseated live entry with no table write', async () => {
      const entry = makeEntry({ id: 'e9', currentTableId: null, currentSeatNumber: null })
      seedEntries([entry, makeEntry({ id: 'e2' })])

      const res = await eliminateEntry({ tournament, entry, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })

      expect(res.finishingPlace).toBe(2)
      expect(mockState.calls.set.filter((c) => c.path[2] === 'tables')).toHaveLength(0)
      const entryWrite = entrySet('e9')
      expect(entryWrite.data.bustedAt).toBeTruthy()
      expect(entryWrite.data.bustedInSessionId).toBe('session-1')
      expect(recountTournamentEntries).toHaveBeenCalledTimes(1)
    })

    it('computes the place from FRESH reads, so back-to-back busts get descending places even with a stale list', async () => {
      const e1 = makeEntry({ id: 'e1' })
      const e2 = makeEntry({ id: 'e2' })
      const e3 = makeEntry({ id: 'e3' })
      seedEntries([e1, e2, e3])

      const first = await eliminateEntry({ tournament, entry: e1, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
      // listEntries still returns the pre-bust list (stale outside snapshot), but
      // the store copy of e1 is now busted — the fresh in-transaction reads see it.
      const second = await eliminateEntry({ tournament, entry: e2, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })

      expect(first.finishingPlace).toBe(3)
      expect(second.finishingPlace).toBe(2)
    })

    it('re-checks the entry inside the transaction: refuses if it was busted concurrently', async () => {
      const argSnapshot = makeEntry({ id: 'e1' }) // caller believes e1 is alive…
      entriesApi.listEntries.mockResolvedValue([argSnapshot, makeEntry({ id: 'e2' })])
      // …but the stored doc is already busted (someone else got there first).
      mockState.seed(entryPath('t1', 'e1'), makeEntry({ id: 'e1', bustedAt: Timestamp.now(), bustedInSessionId: 'session-1' }))
      mockState.seed(entryPath('t1', 'e2'), makeEntry({ id: 'e2' }))

      await expect(
        eliminateEntry({ tournament, entry: argSnapshot, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(AlreadyBustedError)
    })

    it('refuses to eliminate the last player standing (1st place is the payout flow, not a bust)', async () => {
      const sole = makeEntry({ id: 'e1' })
      seedEntries([sole, makeEntry({ id: 'out', bustedAt: Timestamp.now(), bustedInSessionId: 'session-1', finishingPlace: 2 })])
      await expect(
        eliminateEntry({ tournament, entry: sole, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(LastPlayerStandingError)
    })

    it('refuses to eliminate an already-busted entry', async () => {
      await expect(
        eliminateEntry({ tournament, entry: makeEntry({ bustedAt: Timestamp.now() }), sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(AlreadyBustedError)
    })

    it('refuses to eliminate a voided entry', async () => {
      await expect(
        eliminateEntry({ tournament, entry: makeEntry({ voidedAt: Timestamp.now() }), sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(EntryNotSeatableError)
    })
  })

  describe('revertElimination (task 4.1 undo)', () => {
    const bustedEntry = (id, ms, over = {}) =>
      makeEntry({
        id,
        bustedAt: Timestamp.fromMillis(ms),
        bustedInSessionId: 'session-1',
        ...over,
      })
    const seedEntries = (list) => {
      entriesApi.listEntries.mockResolvedValue(list)
      for (const e of list) mockState.seed(entryPath('t1', e.id), e)
    }

    it('clears the bust fields (player returns unseated), recounts, audits with the previous place', async () => {
      const entry = bustedEntry('e1', 1000, { finishingPlace: 4 })
      seedEntries([entry, makeEntry({ id: 'e2' }), bustedEntry('e3', 2000, { finishingPlace: 3 })])

      const res = await revertElimination({ tournament, entry, actorId: 'td-1', actorRole: 'td' })

      expect(res).toEqual({ ok: true, previousPlace: 4 })
      const entryWrite = mockState.calls.set.find((c) => c.path[2] === 'entries' && c.path[3] === 'e1')
      expect(entryWrite.data).toMatchObject({
        bustedAt: null,
        bustedInSessionId: null,
        finishingPlace: null,
        currentTableId: null,
        currentSeatNumber: null,
      })
      // v1: later finishers are NOT renumbered — e3 keeps 3rd (gap at 4th allowed)
      expect(mockState.calls.set.filter((c) => c.path[2] === 'entries')).toHaveLength(1)
      expect(recountTournamentEntries).toHaveBeenCalledWith({ tournamentId: 't1' })
      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'entry.bustReverted',
          targetId: 'e1',
          metadata: expect.objectContaining({ previousPlace: 4, sessionId: 'session-1' }),
        })
      )
    })

    it('refuses when the entry is not busted', async () => {
      await expect(
        revertElimination({ tournament, entry: makeEntry({ id: 'e1' }), actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(NotBustedError)
    })

    it('refuses when the entry is voided', async () => {
      await expect(
        revertElimination({
          tournament,
          entry: makeEntry({ id: 'e1', voidedAt: Timestamp.now(), bustedAt: Timestamp.now() }),
          actorId: 'td-1',
          actorRole: 'td',
        })
      ).rejects.toBeInstanceOf(EntryNotSeatableError)
    })

    it('re-checks inside the transaction: refuses if the bust was already reverted', async () => {
      const argSnapshot = bustedEntry('e1', 1000, { finishingPlace: 4 })
      entriesApi.listEntries.mockResolvedValue([argSnapshot])
      mockState.seed(entryPath('t1', 'e1'), makeEntry({ id: 'e1' })) // stored doc already alive
      await expect(
        revertElimination({ tournament, entry: argSnapshot, actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(NotBustedError)
    })

    it('refuses when a LATER-busted entry already has recorded winnings', async () => {
      const entry = bustedEntry('e1', 1000, { finishingPlace: 4 })
      seedEntries([entry, bustedEntry('paid', 2000, { finishingPlace: 3, cashWinnings: 100_00 })])
      await expect(revertElimination({ tournament, entry, actorId: 'td-1', actorRole: 'td' })).rejects.toBeInstanceOf(
        RevertBlockedByPayoutError
      )
    })

    it('refuses when the entry ITSELF has recorded winnings', async () => {
      const entry = bustedEntry('e1', 1000, { finishingPlace: 2, ticketWinnings: 50_00 })
      seedEntries([entry])
      await expect(revertElimination({ tournament, entry, actorId: 'td-1', actorRole: 'td' })).rejects.toBeInstanceOf(
        RevertBlockedByPayoutError
      )
    })

    it('allows the revert when only an EARLIER-busted entry has winnings', async () => {
      const entry = bustedEntry('e1', 2000, { finishingPlace: 3 })
      seedEntries([entry, bustedEntry('earlier', 1000, { finishingPlace: 5, cashWinnings: 20_00 })])
      const res = await revertElimination({ tournament, entry, actorId: 'td-1', actorRole: 'td' })
      expect(res.previousPlace).toBe(3)
    })

    it('reverts a legacy bust that never had a place (previousPlace null)', async () => {
      const entry = bustedEntry('e1', 1000) // finishingPlace null (pre-4.1 bust)
      seedEntries([entry])
      const res = await revertElimination({ tournament, entry, actorId: 'td-1', actorRole: 'td' })
      expect(res).toEqual({ ok: true, previousPlace: null })
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

describe('balancing (task 3.8)', () => {
  const tableWith = ({ id, tableNumber, seatCount = 9, occupied = [] }) => ({
    id,
    tournamentId: 't1',
    sessionId: 'session-1',
    tableNumber,
    seatCount,
    status: 'open',
    openedAt: null,
    closedAt: null,
    seats: Array.from({ length: seatCount }, (_, i) => {
      const seatNumber = i + 1
      return { seatNumber, entryId: occupied.includes(seatNumber) ? `e${tableNumber}-${seatNumber}` : null }
    }),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
  // Replay moves onto a {tableNumber: size} map to assert the resulting spread.
  const applySizes = (sizes, moves) => {
    const out = { ...sizes }
    for (const m of moves) {
      out[m.fromTableNumber]--
      out[m.toTableNumber]++
    }
    return out
  }

  describe('isBalanced / tableSizes', () => {
    it('is balanced within ±1 or with fewer than two tables', () => {
      expect(isBalanced([])).toBe(true)
      expect(isBalanced([tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3] })])).toBe(true)
      expect(
        isBalanced([
          tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3] }),
          tableWith({ id: 'b', tableNumber: 2, occupied: [1, 2] }),
        ])
      ).toBe(true)
      expect(
        isBalanced([
          tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3, 4, 5] }),
          tableWith({ id: 'b', tableNumber: 2, occupied: [1] }),
        ])
      ).toBe(false)
    })

    it('reports occupied sizes in table order', () => {
      const sizes = tableSizes([
        tableWith({ id: 'b', tableNumber: 2, occupied: [1, 2] }),
        tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3] }),
      ])
      expect(sizes.map((s) => [s.tableNumber, s.size])).toEqual([
        [1, 3],
        [2, 2],
      ])
    })
  })

  describe('planBalance', () => {
    it('returns no moves when already within ±1', () => {
      expect(
        planBalance([
          tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3] }),
          tableWith({ id: 'b', tableNumber: 2, occupied: [1, 2] }),
        ])
      ).toEqual([])
    })

    it('balances [5,1] in two moves, highest seat → lowest empty', () => {
      const moves = planBalance([
        tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3, 4, 5] }),
        tableWith({ id: 'b', tableNumber: 2, occupied: [1] }),
      ])
      expect(moves).toHaveLength(2)
      expect(moves[0]).toMatchObject({
        fromTableNumber: 1,
        fromSeatNumber: 5,
        toTableNumber: 2,
        toSeatNumber: 2,
        entryId: 'e1-5',
      })
      const final = applySizes({ 1: 5, 2: 1 }, moves)
      expect(Math.max(final[1], final[2]) - Math.min(final[1], final[2])).toBeLessThanOrEqual(1)
    })

    it('balances three uneven tables to ±1 without losing a player', () => {
      const moves = planBalance([
        tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3, 4, 5, 6] }),
        tableWith({ id: 'b', tableNumber: 2, occupied: [1, 2] }),
        tableWith({ id: 'c', tableNumber: 3, occupied: [1] }),
      ])
      const final = applySizes({ 1: 6, 2: 2, 3: 1 }, moves)
      const arr = [final[1], final[2], final[3]]
      expect(Math.max(...arr) - Math.min(...arr)).toBeLessThanOrEqual(1)
      expect(arr.reduce((a, b) => a + b, 0)).toBe(9)
    })
  })

  describe('balanceTables op', () => {
    beforeEach(() => {
      mockState = makeMockStore()
      let counter = 0
      nextId = () => `table-${++counter}`
      runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
      runValidatedBatch.mockImplementation(async (fn) => fn(mockState.tx))
      tablesApi.listTables.mockResolvedValue([])
      auditLog.writeAuditLogSafe.mockClear()
    })

    it('applies the balance atomically: frees the source seat, fills the target, repoints the entry', async () => {
      const tA = tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3, 4] })
      const tB = tableWith({ id: 'tB', tableNumber: 2, occupied: [1] })
      tablesApi.listTables.mockResolvedValue([tA, tB])
      mockState.seed(tablePath('t1', 'tA'), tA)
      mockState.seed(tablePath('t1', 'tB'), tB)

      const res = await balanceTables({ tournament, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })

      expect(res.moves).toHaveLength(1)
      const setA = mockState.calls.set.find((c) => c.path[3] === 'tA')
      expect(setA.data.seats.find((s) => s.seatNumber === 4).entryId).toBeNull()
      const setB = mockState.calls.set.find((c) => c.path[3] === 'tB')
      expect(setB.data.seats.find((s) => s.seatNumber === 2).entryId).toBe('e1-4')
      const eUpd = mockState.calls.update.find((c) => c.path[3] === 'e1-4')
      expect(eUpd.partial).toMatchObject({ currentTableId: 'tB', currentSeatNumber: 2 })
      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'seating.balanced' }))
    })

    it('does nothing (no writes, no audit) when already balanced', async () => {
      const tA = tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3] })
      const tB = tableWith({ id: 'tB', tableNumber: 2, occupied: [1, 2] })
      tablesApi.listTables.mockResolvedValue([tA, tB])
      mockState.seed(tablePath('t1', 'tA'), tA)
      mockState.seed(tablePath('t1', 'tB'), tB)

      const res = await balanceTables({ tournament, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })

      expect(res.moves).toEqual([])
      expect(mockState.calls.set).toHaveLength(0)
      expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
    })

    it('is a no-op with a single open table', async () => {
      tablesApi.listTables.mockResolvedValue([tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3] })])
      const res = await balanceTables({ tournament, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
      expect(res.moves).toEqual([])
    })
  })
})

describe('breaking (task 3.9)', () => {
  const tableWith = ({ id, tableNumber, seatCount = 9, occupied = [], status = 'open' }) => ({
    id,
    tournamentId: 't1',
    sessionId: 'session-1',
    tableNumber,
    seatCount,
    status,
    openedAt: null,
    closedAt: null,
    seats: Array.from({ length: seatCount }, (_, i) => {
      const seatNumber = i + 1
      return { seatNumber, entryId: occupied.includes(seatNumber) ? `e${tableNumber}-${seatNumber}` : null }
    }),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })

  describe('planBreak / canBreakTable', () => {
    it('redistributes the broken table players emptiest-first and keeps the room ±1', () => {
      const tables = [
        tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3, 4] }),
        tableWith({ id: 'tB', tableNumber: 2, occupied: [1, 2, 3, 4] }),
        tableWith({ id: 'tC', tableNumber: 3, occupied: [1, 2, 3] }),
      ]
      const moves = planBreak(tables, 'tC')
      expect(moves).toHaveLength(3)
      expect(moves.every((m) => m.fromTableId === 'tC')).toBe(true)
      const sizes = { tA: 4, tB: 4 }
      for (const m of moves) sizes[m.toTableId] += 1
      expect(Math.max(sizes.tA, sizes.tB) - Math.min(sizes.tA, sizes.tB)).toBeLessThanOrEqual(1)
      expect(canBreakTable(tables, 'tC')).toBe(true)
    })

    it('returns [] for an already-empty table (still breakable)', () => {
      const tables = [
        tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3] }),
        tableWith({ id: 'tB', tableNumber: 2, occupied: [] }),
      ]
      expect(planBreak(tables, 'tB')).toEqual([])
      expect(canBreakTable(tables, 'tB')).toBe(true)
    })

    it('returns null when the other tables cannot absorb the players', () => {
      const tables = [
        tableWith({ id: 'tA', tableNumber: 1, seatCount: 4, occupied: [1, 2, 3, 4] }),
        tableWith({ id: 'tB', tableNumber: 2, seatCount: 4, occupied: [1, 2, 3] }),
      ]
      expect(planBreak(tables, 'tB')).toBeNull()
      expect(canBreakTable(tables, 'tB')).toBe(false)
    })

    it('returns null for an unknown / non-open table id', () => {
      const tables = [tableWith({ id: 'tA', tableNumber: 1, occupied: [1] })]
      expect(planBreak(tables, 'nope')).toBeNull()
    })
  })

  describe('breakTable op', () => {
    beforeEach(() => {
      mockState = makeMockStore()
      let counter = 0
      nextId = () => `table-${++counter}`
      runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
      runValidatedBatch.mockImplementation(async (fn) => fn(mockState.tx))
      tablesApi.listTables.mockResolvedValue([])
      auditLog.writeAuditLogSafe.mockClear()
    })

    it('moves the players, closes the table (broken + closedAt, seats cleared), repoints entries', async () => {
      const tA = tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3, 4] })
      const tB = tableWith({ id: 'tB', tableNumber: 2, occupied: [1, 2] })
      tablesApi.listTables.mockResolvedValue([tA, tB])
      mockState.seed(tablePath('t1', 'tA'), tA)
      mockState.seed(tablePath('t1', 'tB'), tB)

      const res = await breakTable({ tournament, sessionId: 'session-1', tableId: 'tB', actorId: 'td-1', actorRole: 'td' })

      expect(res.brokenTableNumber).toBe(2)
      expect(res.moves).toHaveLength(2)
      const setA = mockState.calls.set.find((c) => c.path[3] === 'tA')
      expect(setA.data.seats.filter((s) => s.entryId !== null)).toHaveLength(6)
      const setB = mockState.calls.set.find((c) => c.path[3] === 'tB')
      expect(setB.data.status).toBe('broken')
      expect(setB.data.closedAt).not.toBeNull()
      expect(setB.data.openedAt).not.toBeNull()
      expect(setB.data.seats.every((s) => s.entryId === null)).toBe(true)
      const moved = mockState.calls.update.filter((c) => c.path[2] === 'entries')
      expect(moved).toHaveLength(2)
      expect(moved.every((c) => c.partial.currentTableId === 'tA')).toBe(true)
      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'seating.tableBroken' })
      )
    })

    it('refuses to close an occupied table with nowhere to move the players', async () => {
      const tA = tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2] })
      tablesApi.listTables.mockResolvedValue([tA])
      mockState.seed(tablePath('t1', 'tA'), tA)
      await expect(
        breakTable({ tournament, sessionId: 'session-1', tableId: 'tA', actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(CannotBreakTableError)
    })

    it('closes an empty table even if it is the only one', async () => {
      const tA = tableWith({ id: 'tA', tableNumber: 1, occupied: [] })
      tablesApi.listTables.mockResolvedValue([tA])
      mockState.seed(tablePath('t1', 'tA'), tA)
      const res = await breakTable({ tournament, sessionId: 'session-1', tableId: 'tA', actorId: 'td-1', actorRole: 'td' })
      expect(res.moves).toEqual([])
      const setA = mockState.calls.set.find((c) => c.path[3] === 'tA')
      expect(setA.data.status).toBe('broken')
      expect(setA.data.closedAt).not.toBeNull()
    })

    it('refuses (CannotBreakTableError) when the others cannot absorb the players', async () => {
      const tA = tableWith({ id: 'tA', tableNumber: 1, seatCount: 4, occupied: [1, 2, 3, 4] })
      const tB = tableWith({ id: 'tB', tableNumber: 2, seatCount: 4, occupied: [1, 2, 3] })
      tablesApi.listTables.mockResolvedValue([tA, tB])
      mockState.seed(tablePath('t1', 'tA'), tA)
      mockState.seed(tablePath('t1', 'tB'), tB)
      await expect(
        breakTable({ tournament, sessionId: 'session-1', tableId: 'tB', actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(CannotBreakTableError)
    })
  })
})

describe('alternates (task 3.10)', () => {
  const altEntry = (id, ms, over = {}) => ({
    id,
    playerId: `p-${id}`,
    originSessionId: 'session-1',
    voidedAt: null,
    bustedAt: null,
    currentTableId: null,
    currentSeatNumber: null,
    registeredAt: Timestamp.fromMillis(ms),
    ...over,
  })
  const tableWith = ({ id, tableNumber, seatCount = 9, occupied = [], status = 'open' }) => ({
    id,
    tournamentId: 't1',
    sessionId: 'session-1',
    tableNumber,
    seatCount,
    status,
    openedAt: null,
    closedAt: null,
    seats: Array.from({ length: seatCount }, (_, i) => ({
      seatNumber: i + 1,
      entryId: occupied.includes(i + 1) ? `e${tableNumber}-${i + 1}` : null,
    })),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })

  describe('waitlist', () => {
    it('orders seatable-but-unseated entries FIFO by registration; excludes seated/busted/voided/other-session', () => {
      const entries = [
        altEntry('late', 300),
        altEntry('early', 100),
        altEntry('mid', 200),
        altEntry('seated', 50),
        altEntry('busted', 10, { bustedAt: Timestamp.now() }),
        altEntry('voided', 10, { voidedAt: Timestamp.now() }),
        altEntry('other', 10, { originSessionId: 'session-2' }),
      ]
      const q = waitlist(entries, 'session-1', new Set(['seated']))
      expect(q.map((e) => e.id)).toEqual(['early', 'mid', 'late'])
    })
  })

  describe('firstEmptySeat', () => {
    it('returns the emptiest open table’s lowest empty seat, ignoring broken tables', () => {
      const seat = firstEmptySeat([
        tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3, 4, 5] }),
        tableWith({ id: 'tB', tableNumber: 2, occupied: [1, 2] }),
        tableWith({ id: 'tC', tableNumber: 3, occupied: [1, 2, 3], status: 'broken' }),
      ])
      expect(seat).toEqual({ tableId: 'tB', tableNumber: 2, seatNumber: 3 })
    })
    it('returns null when every open table is full', () => {
      expect(firstEmptySeat([tableWith({ id: 'tA', tableNumber: 1, seatCount: 2, occupied: [1, 2] })])).toBeNull()
    })
  })

  describe('seatNextAlternate op', () => {
    beforeEach(() => {
      mockState = makeMockStore()
      let counter = 0
      nextId = () => `table-${++counter}`
      runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
      runValidatedBatch.mockImplementation(async (fn) => fn(mockState.tx))
      tablesApi.listTables.mockResolvedValue([])
      auditLog.writeAuditLogSafe.mockClear()
    })

    it('seats the head-of-queue alternate into a random active seat (atomic via seatEntry)', async () => {
      const tA = tableWith({ id: 'tA', tableNumber: 1, occupied: [1, 2, 3, 4, 5] })
      const tB = tableWith({ id: 'tB', tableNumber: 2, occupied: [1, 2] })
      mockState.seed(tablePath('t1', 'tA'), tA) // rng=0 → the first empty seat among the fillable tables (tA seat 6)
      const entries = [altEntry('early', 100), altEntry('late', 200)]

      const res = await seatNextAlternate({
        tournament,
        sessionId: 'session-1',
        entries,
        tables: [tA, tB],
        actorId: 'td-1',
        actorRole: 'td',
        rng: () => 0,
      })

      expect(res.entryId).toBe('early')
      const setA = mockState.calls.set.find((c) => c.path[3] === 'tA')
      expect(setA.data.seats.find((s) => s.seatNumber === 6).entryId).toBe('early')
      const eUpd = mockState.calls.update.find((c) => c.path[3] === 'early')
      expect(eUpd.partial).toMatchObject({ currentTableId: 'tA', currentSeatNumber: 6 })
    })

    it('throws NoAlternatesError when nobody is waiting', async () => {
      const tB = tableWith({ id: 'tB', tableNumber: 2, occupied: [1, 2] })
      await expect(
        seatNextAlternate({ tournament, sessionId: 'session-1', entries: [], tables: [tB], actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(NoAlternatesError)
    })

    it('throws NoOpenSeatError when every open table is full', async () => {
      const tFull = tableWith({ id: 'tA', tableNumber: 1, seatCount: 2, occupied: [1, 2] })
      await expect(
        seatNextAlternate({
          tournament,
          sessionId: 'session-1',
          entries: [altEntry('early', 100)],
          tables: [tFull],
          actorId: 'td-1',
          actorRole: 'td',
        })
      ).rejects.toBeInstanceOf(NoOpenSeatError)
    })
  })
})

describe('table lifecycle + random seating', () => {
  const tableWith = ({ id, tableNumber, seatCount = 9, occupied = [], status = 'open', active = true }) => ({
    id,
    tournamentId: 't1',
    sessionId: 'session-1',
    tableNumber,
    seatCount,
    status,
    active,
    openedAt: null,
    closedAt: null,
    seats: Array.from({ length: seatCount }, (_, i) => ({
      seatNumber: i + 1,
      entryId: occupied.includes(i + 1) ? `e${tableNumber}-${i + 1}` : null,
    })),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })

  describe('fillableTables / randomEmptySeat (active only)', () => {
    it('fillableTables = open AND active (a missing flag counts as active)', () => {
      const t = [
        tableWith({ id: 'a', tableNumber: 1 }),
        tableWith({ id: 'b', tableNumber: 2, active: false }),
        tableWith({ id: 'c', tableNumber: 3, status: 'broken' }),
        { ...tableWith({ id: 'd', tableNumber: 4 }), active: undefined },
      ]
      expect(fillableTables(t).map((x) => x.id).sort()).toEqual(['a', 'd'])
    })
    it('randomEmptySeat only picks from active tables', () => {
      const seat = randomEmptySeat(
        [
          tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3, 4, 5, 6, 7, 8, 9] }),
          tableWith({ id: 'b', tableNumber: 2, active: false, occupied: [] }),
          tableWith({ id: 'c', tableNumber: 3, occupied: [1, 2] }),
        ],
        () => 0
      )
      expect(seat.tableId).toBe('c')
    })
    it('randomEmptySeat returns null when no active table has room', () => {
      expect(randomEmptySeat([tableWith({ id: 'b', tableNumber: 1, active: false })], () => 0)).toBeNull()
    })
  })

  describe('planBalance / firstEmptySeat skip deactivated tables', () => {
    it('planBalance never moves a player onto a deactivated table', () => {
      const moves = planBalance([
        tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3, 4, 5] }),
        tableWith({ id: 'b', tableNumber: 2, occupied: [1] }),
        tableWith({ id: 'c', tableNumber: 3, active: false, occupied: [] }),
      ])
      expect(moves.every((m) => m.toTableId !== 'c')).toBe(true)
    })
    it('firstEmptySeat ignores deactivated tables', () => {
      const seat = firstEmptySeat([
        tableWith({ id: 'a', tableNumber: 1, occupied: [1, 2, 3] }),
        tableWith({ id: 'b', tableNumber: 2, active: false, occupied: [] }),
      ])
      expect(seat.tableId).toBe('a')
    })
  })

  describe('openTable op', () => {
    beforeEach(() => {
      mockState = makeMockStore()
      let counter = 0
      nextId = () => `new-${++counter}`
      runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
      tablesApi.listTables.mockResolvedValue([])
      auditLog.writeAuditLogSafe.mockClear()
      validatedSet.mockClear()
    })

    it('opens a DEACTIVATED table with the next number and the tournament seat count', async () => {
      tablesApi.listTables.mockResolvedValue([tableWith({ id: 'x', tableNumber: 2 })])
      const res = await openTable({
        tournament: { id: 't1', maxSeatsPerTable: 8 },
        sessionId: 'session-1',
        actorId: 'td-1',
        actorRole: 'td',
      })
      expect(res.tableNumber).toBe(3)
      const [path, , data] = validatedSet.mock.calls[0]
      expect(path).toEqual(['tournaments', 't1', 'tables', 'new-1'])
      expect(data).toMatchObject({ tableNumber: 3, seatCount: 8, status: 'open', active: false })
      expect(data.seats).toHaveLength(8)
      expect(data.seats.every((s) => s.entryId === null)).toBe(true)
      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'seating.tableOpened' }))
    })

    it('can open an active table', async () => {
      const res = await openTable({
        tournament: { id: 't1', maxSeatsPerTable: 9 },
        sessionId: 'session-1',
        active: true,
        actorId: 'td-1',
        actorRole: 'td',
      })
      expect(res.tableNumber).toBe(1)
      expect(validatedSet.mock.calls[0][2].active).toBe(true)
    })
  })

  describe('setTableActive op', () => {
    beforeEach(() => {
      mockState = makeMockStore()
      runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
      auditLog.writeAuditLogSafe.mockClear()
    })

    it('toggles active on an open table', async () => {
      mockState.seed(tablePath('t1', 'tA'), tableWith({ id: 'tA', tableNumber: 1, active: false }))
      const res = await setTableActive({ tournament, tableId: 'tA', active: true, actorId: 'td-1', actorRole: 'td' })
      expect(res.active).toBe(true)
      const setA = mockState.calls.set.find((c) => c.path[3] === 'tA')
      expect(setA.data.active).toBe(true)
      expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'seating.tableActivated' }))
    })

    it('refuses on a broken (closed) table', async () => {
      mockState.seed(tablePath('t1', 'tA'), tableWith({ id: 'tA', tableNumber: 1, status: 'broken' }))
      await expect(
        setTableActive({ tournament, tableId: 'tA', active: true, actorId: 'td-1', actorRole: 'td' })
      ).rejects.toBeInstanceOf(SeatingError)
    })
  })
})
