import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'
import { buildTournament, buildEntry, buildTable } from '../schema/_fixtures'
import { Entry } from '../schema'

let mockState

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  runValidatedBatch: vi.fn(),
  validatedSet: vi.fn(),
  tables: { listTables: vi.fn() },
  entries: { listEntries: vi.fn() },
  generateId: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    tablePath: (tid, id) => ['tournaments', tid, 'tables', id],
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
  },
}))

vi.mock('../players', () => ({
  playerDisplayName: (p) => p.displayName ?? `${p.firstName} ${p.lastName}`.trim(),
}))

// reachSatelliteMilestone recounts the tournament counters via registration;
// stub just the recount so these tests stay focused on the seat/entry writes
// (the pure computeEntryCounters stays real — it's asserted against below).
vi.mock('./registration', async (importOriginal) => ({
  ...(await importOriginal()),
  recountTournamentEntries: vi.fn().mockResolvedValue({ remainingPlayerCount: 0 }),
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import { recountTournamentEntries, computeEntryCounters } from './registration'
import { isSeatable, nextFinishingPlace, AlreadyBustedError, EntryNotSeatableError } from './seating'
import {
  isSatellite,
  satelliteMilestoneThreshold,
  isMilestoneWinner,
  milestoneWinners,
  reachSatelliteMilestone,
  SatelliteError,
  NotSatelliteError,
} from './satellite'

const tablePath = (tid, id) => ['tournaments', tid, 'tables', id]
const entryPath = (tid, eid) => ['tournaments', tid, 'entries', eid]

// $100 satellite, 10k stack, $1,000 ticket → milestone at 100k chips.
function makeSatTournament(overrides = {}) {
  return buildTournament({
    id: 't1',
    gameType: 'satellite',
    buyIn: 100_00,
    startingStack: 10_000,
    satelliteConfig: { ticketReward: 1000_00 },
    ...overrides,
  })
}

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('isSatellite', () => {
  it('requires the satellite gameType AND a satellite config', () => {
    expect(isSatellite(makeSatTournament())).toBe(true)
    expect(isSatellite(buildTournament({ gameType: 'nlh' }))).toBe(false)
    expect(isSatellite({ gameType: 'satellite', satelliteConfig: null })).toBe(false)
    expect(isSatellite(null)).toBe(false)
  })
})

describe('satelliteMilestoneThreshold', () => {
  it('derives (ticketReward / buyIn) × startingStack', () => {
    expect(satelliteMilestoneThreshold(makeSatTournament())).toBe(100_000)
    expect(
      satelliteMilestoneThreshold(
        makeSatTournament({ buyIn: 80_00, satelliteConfig: { ticketReward: 200_00 }, startingStack: 20_000 })
      )
    ).toBe(50_000)
  })

  it('is null for non-satellites and zero buy-ins', () => {
    expect(satelliteMilestoneThreshold(buildTournament({ gameType: 'nlh' }))).toBeNull()
    expect(satelliteMilestoneThreshold(makeSatTournament({ buyIn: 0 }))).toBeNull()
    expect(satelliteMilestoneThreshold(null)).toBeNull()
  })
})

describe('isMilestoneWinner / milestoneWinners', () => {
  it('a milestone winner is out of the field WITH a recorded ticket win', () => {
    const winner = buildEntry({ id: 'w', bustedAt: Timestamp.now(), bustedInSessionId: 's1', ticketWinnings: 1000_00 })
    const busted = buildEntry({ id: 'b', bustedAt: Timestamp.now(), bustedInSessionId: 's1' })
    const alive = buildEntry({ id: 'a' })
    const voided = buildEntry({
      id: 'v',
      bustedAt: Timestamp.now(),
      bustedInSessionId: 's1',
      ticketWinnings: 1000_00,
      voidedAt: Timestamp.now(),
      voidedBy: 'm-1',
      voidReason: 'dupe',
    })
    expect(isMilestoneWinner(winner)).toBe(true)
    expect(isMilestoneWinner(busted)).toBe(false)
    expect(isMilestoneWinner(alive)).toBe(false)
    expect(isMilestoneWinner(voided)).toBe(false)
    expect(milestoneWinners([winner, busted, alive, voided]).map((e) => e.id)).toEqual(['w'])
    expect(milestoneWinners(null)).toEqual([])
  })
})

// ── reachSatelliteMilestone op ──────────────────────────────────────────────

describe('reachSatelliteMilestone', () => {
  const tournament = makeSatTournament()

  beforeEach(() => {
    mockState = makeMockStore()
    runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
    auditLog.writeAuditLogSafe.mockClear()
    recountTournamentEntries.mockClear()
  })

  it('frees the seat, marks the entry out with ticketWinnings, recounts, audits', async () => {
    const seats = buildTable().seats.map((s) => (s.seatNumber === 2 ? { ...s, entryId: 'e1' } : s))
    mockState.seed(tablePath('t1', 'table-1'), buildTable({ id: 'table-1', tournamentId: 't1', seats }))
    const entry = buildEntry({ id: 'e1', tournamentId: 't1', currentTableId: 'table-1', currentSeatNumber: 2 })
    mockState.seed(entryPath('t1', 'e1'), entry)

    const res = await reachSatelliteMilestone({
      tournament,
      entry,
      sessionId: 'session-1',
      actorId: 'td-1',
      actorRole: 'td',
    })

    expect(res).toEqual({ ok: true, ticketReward: 1000_00 })

    // seat freed on the table
    const tableWrite = mockState.calls.set.find((c) => c.path[2] === 'tables')
    expect(tableWrite.data.seats.find((s) => s.seatNumber === 2).entryId).toBeNull()

    // entry rewritten in full: out of the field, ticket win recorded, NO finishing place
    const entryWrite = mockState.calls.set.find((c) => c.path[2] === 'entries' && c.path[3] === 'e1')
    expect(entryWrite.data).toMatchObject({
      currentTableId: null,
      currentSeatNumber: null,
      bustedInSessionId: 'session-1',
      ticketWinnings: 1000_00,
      finishingPlace: null, // canonical §5.2: null for satellite ticket winners
    })
    expect(entryWrite.data.bustedAt).toBeTruthy()
    expect(Entry.safeParse(entryWrite.data).success).toBe(true)

    // The written doc satisfies every alive-count rule: no longer seatable, not
    // counted as remaining, and doesn't hold a place for the next bust.
    expect(isSeatable(entryWrite.data)).toBe(false)
    expect(isMilestoneWinner(entryWrite.data)).toBe(true)
    const counters = computeEntryCounters([entryWrite.data, buildEntry({ id: 'e2' })], tournament.buyIn)
    expect(counters.remainingPlayerCount).toBe(1)
    expect(nextFinishingPlace([entryWrite.data, buildEntry({ id: 'e2' })])).toBe(1)

    expect(recountTournamentEntries).toHaveBeenCalledWith({ tournamentId: 't1' })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'entry.satelliteMilestone',
        targetType: 'entry',
        targetId: 'e1',
        metadata: expect.objectContaining({ tournamentId: 't1', sessionId: 'session-1', ticketReward: 1000_00 }),
      })
    )
  })

  it('handles an unseated player with no table write', async () => {
    const entry = buildEntry({ id: 'e1', tournamentId: 't1' })
    mockState.seed(entryPath('t1', 'e1'), entry)

    const res = await reachSatelliteMilestone({ tournament, entry, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })

    expect(res.ok).toBe(true)
    expect(mockState.calls.set.filter((c) => c.path[2] === 'tables')).toHaveLength(0)
    const entryWrite = mockState.calls.set.find((c) => c.path[3] === 'e1')
    expect(entryWrite.data.ticketWinnings).toBe(1000_00)
  })

  it('works for the LAST player standing (a satellite can end with everyone milestoning out)', async () => {
    const entry = buildEntry({ id: 'sole', tournamentId: 't1' })
    mockState.seed(entryPath('t1', 'sole'), entry)
    const res = await reachSatelliteMilestone({ tournament, entry, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
    expect(res.ok).toBe(true)
  })

  it('refuses a non-satellite tournament', async () => {
    await expect(
      reachSatelliteMilestone({
        tournament: buildTournament({ gameType: 'nlh' }),
        entry: buildEntry(),
        sessionId: 'session-1',
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toBeInstanceOf(NotSatelliteError)
  })

  it('refuses an already-busted or voided entry (arg pre-check)', async () => {
    await expect(
      reachSatelliteMilestone({
        tournament,
        entry: buildEntry({ bustedAt: Timestamp.now(), bustedInSessionId: 's1' }),
        sessionId: 'session-1',
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toBeInstanceOf(AlreadyBustedError)
    await expect(
      reachSatelliteMilestone({
        tournament,
        entry: buildEntry({ voidedAt: Timestamp.now(), voidedBy: 'm', voidReason: 'x' }),
        sessionId: 'session-1',
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toBeInstanceOf(EntryNotSeatableError)
  })

  it('re-checks the FRESH entry inside the transaction (concurrent bust refused)', async () => {
    const argSnapshot = buildEntry({ id: 'e1', tournamentId: 't1' }) // caller believes alive…
    mockState.seed(entryPath('t1', 'e1'), buildEntry({ id: 'e1', bustedAt: Timestamp.now(), bustedInSessionId: 's1' }))
    await expect(
      reachSatelliteMilestone({ tournament, entry: argSnapshot, sessionId: 'session-1', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(AlreadyBustedError)
  })

  it('requires a session and an actor', async () => {
    await expect(
      reachSatelliteMilestone({ tournament, entry: buildEntry(), sessionId: '', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toBeInstanceOf(SatelliteError)
    await expect(
      reachSatelliteMilestone({ tournament, entry: buildEntry(), sessionId: 'session-1', actorId: '', actorRole: 'td' })
    ).rejects.toBeInstanceOf(SatelliteError)
  })

  it('refuses when the ticket reward is not configured to a positive value', async () => {
    await expect(
      reachSatelliteMilestone({
        tournament: makeSatTournament({ satelliteConfig: { ticketReward: 0 } }),
        entry: buildEntry(),
        sessionId: 'session-1',
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toBeInstanceOf(SatelliteError)
  })
})
