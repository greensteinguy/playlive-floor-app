import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Timestamp } from 'firebase/firestore'

// Only the data layer is mocked. The mock tx does NOT validate, so the
// conformance tests below run the REAL Session / Tournament schemas on the
// captured set() payloads to prove the merged docs the ops write are valid.
vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    sessionPath: (tid, sid) => ['tournaments', tid, 'sessions', sid],
    tournamentPath: (tid) => ['tournaments', tid],
  },
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import { Session, Tournament } from '../schema'
import { buildTournament, buildSession } from '../schema/_fixtures'
import {
  startClock,
  pauseClock,
  resumeClock,
  advanceLevel,
  rewindLevel,
  gotoLevel,
  finishClock,
} from './clock'
import { TournamentError } from './errors'
import { makeMockStore } from '../wallet/_test-helpers'
import { deriveClock } from '../clock'

const TID = 'tournament-1'
const SID = 'session-1'
const MIN = 60_000
// buildStructure(): 0 level 20m | 1 level 20m | 2 break 10m | 3 level 20m

let mock

// Seed the store with a tournament + session and wire the transaction mock.
function seed({ session = {}, tournament = {} } = {}) {
  mock = makeMockStore()
  mock.seed(['tournaments', TID], buildTournament(tournament))
  mock.seed(['tournaments', TID, 'sessions', SID], buildSession({ id: SID, tournamentId: TID, ...session }))
  runValidatedTransaction.mockImplementation(async (fn) => fn(mock.tx))
}

// A session already running/paused at a given index, valid for the schema
// (actualStartIndex set, status inProgress). startedAgoMs sets how long ago the
// current segment was anchored (drives the derived current index).
function running({ index = 0, startedAgoMs = 2 * MIN, paused = false, ...rest } = {}) {
  const startedMs = Date.now() - startedAgoMs
  return {
    status: 'inProgress',
    actualStartIndex: 0,
    actualStartTime: Timestamp.fromMillis(startedMs),
    clockStartIndex: index,
    clockStartedAt: Timestamp.fromMillis(startedMs),
    clockPausedAt: paused ? Timestamp.fromMillis(Date.now()) : null,
    currentStructureIndex: index,
    ...rest,
  }
}

const sessionSet = () => mock.calls.set.find((c) => c.path.length === 4)?.data
const tournamentSet = () => mock.calls.set.find((c) => c.path.length === 2)?.data
const actor = { actorId: 'td-1', actorRole: 'td' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('startClock', () => {
  it('anchors at the slice start, moves to inProgress, and writes valid docs', async () => {
    seed()
    const { session, tournament } = await startClock({ tournamentId: TID, sessionId: SID, ...actor })

    expect(session.status).toBe('inProgress')
    expect(session.clockStartIndex).toBe(0)
    expect(session.clockStartedAt).toBeInstanceOf(Timestamp)
    expect(session.clockPausedAt).toBeNull()
    expect(session.actualStartIndex).toBe(0)
    expect(session.actualStartTime).toBeInstanceOf(Timestamp)
    expect(session.currentStructureIndex).toBe(0)
    // Denormalized onto the tournament.
    expect(tournament.currentStructureIndex).toBe(0)
    expect(tournament.pausedAt).toBeNull()
    expect(tournament.isOnBreak).toBe(false) // index 0 is a level

    expect(Session.safeParse(sessionSet()).success, Session.safeParse(sessionSet()).error?.toString()).toBe(true)
    expect(Tournament.safeParse(tournamentSet()).success, Tournament.safeParse(tournamentSet()).error?.toString()).toBe(true)
  })

  it('writes a tournament.clockStarted audit row', async () => {
    seed()
    await startClock({ tournamentId: TID, sessionId: SID, ...actor })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledTimes(1)
    expect(auditLog.writeAuditLogSafe.mock.calls[0][0]).toMatchObject({
      actionType: 'tournament.clockStarted',
      targetType: 'tournament',
      targetId: TID,
      metadata: { sessionId: SID, startIndex: 0 },
    })
  })

  it('rejects when the clock is already started, without writing', async () => {
    seed({ session: running() })
    await expect(startClock({ tournamentId: TID, sessionId: SID, ...actor })).rejects.toThrow(TournamentError)
    expect(mock.calls.set).toHaveLength(0)
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })

  it('rejects starting a finished session', async () => {
    seed({ session: { status: 'finished' } })
    await expect(startClock({ tournamentId: TID, sessionId: SID, ...actor })).rejects.toThrow(TournamentError)
  })
})

describe('pauseClock', () => {
  it('freezes a running clock and stamps pausedAt on both docs', async () => {
    seed({ session: running({ startedAgoMs: 5 * MIN }) })
    const { session, tournament } = await pauseClock({ tournamentId: TID, sessionId: SID, ...actor })
    expect(session.clockPausedAt).toBeInstanceOf(Timestamp)
    expect(session.currentStructureIndex).toBe(0) // 5 min into level 0
    expect(tournament.pausedAt).toBeInstanceOf(Timestamp)
    expect(Session.safeParse(sessionSet()).success).toBe(true)
    expect(Tournament.safeParse(tournamentSet()).success).toBe(true)
    expect(auditLog.writeAuditLogSafe.mock.calls[0][0].actionType).toBe('tournament.paused')
  })

  it('rejects when the clock is not running', async () => {
    seed() // stopped
    await expect(pauseClock({ tournamentId: TID, sessionId: SID, ...actor })).rejects.toThrow(TournamentError)
    expect(mock.calls.set).toHaveLength(0)
  })

  it('rejects when already paused', async () => {
    seed({ session: running({ paused: true }) })
    await expect(pauseClock({ tournamentId: TID, sessionId: SID, ...actor })).rejects.toThrow(TournamentError)
  })
})

describe('resumeClock', () => {
  it('re-anchors so paused time does not count, preserving remaining time exactly', async () => {
    const base = Date.now() - 30 * MIN
    seed({
      session: {
        status: 'inProgress',
        actualStartIndex: 0,
        actualStartTime: Timestamp.fromMillis(base),
        clockStartIndex: 0,
        clockStartedAt: Timestamp.fromMillis(base),
        clockPausedAt: Timestamp.fromMillis(base + 5 * MIN), // paused 5 min into level 0
        currentStructureIndex: 0,
      },
    })
    const { session } = await resumeClock({ tournamentId: TID, sessionId: SID, ...actor })
    expect(session.clockPausedAt).toBeNull()
    expect(session.clockStartedAt).toBeInstanceOf(Timestamp)
    // Re-derive at "now": 5 min were elapsed at pause, so 15 min remain in the 20-min level 0.
    const derived = deriveClock(session, buildTournament().structure, Date.now())
    expect(derived.currentIndex).toBe(0)
    expect(derived.remainingMs).toBe(15 * MIN)
    expect(Session.safeParse(sessionSet()).success).toBe(true)
    expect(auditLog.writeAuditLogSafe.mock.calls[0][0].actionType).toBe('tournament.resumed')
  })

  it('rejects when the clock is not paused', async () => {
    seed({ session: running() })
    await expect(resumeClock({ tournamentId: TID, sessionId: SID, ...actor })).rejects.toThrow(TournamentError)
  })
})

describe('advanceLevel / rewindLevel', () => {
  it('advances to the next entry with a fresh full duration', async () => {
    seed({ session: running({ index: 0, startedAgoMs: 2 * MIN }) })
    const { session, tournament } = await advanceLevel({ tournamentId: TID, sessionId: SID, ...actor })
    expect(session.clockStartIndex).toBe(1)
    expect(session.currentStructureIndex).toBe(1)
    expect(session.clockPausedAt).toBeNull()
    expect(tournament.currentStructureIndex).toBe(1)
    expect(Session.safeParse(sessionSet()).success).toBe(true)
    expect(auditLog.writeAuditLogSafe.mock.calls[0][0]).toMatchObject({
      actionType: 'tournament.levelChanged',
      metadata: { direction: 'advance', fromIndex: 0, toIndex: 1 },
    })
  })

  it('flags isOnBreak when advancing onto a break entry', async () => {
    seed({ session: running({ index: 1 }) })
    const { tournament } = await advanceLevel({ tournamentId: TID, sessionId: SID, ...actor })
    expect(tournament.currentStructureIndex).toBe(2) // the break
    expect(tournament.isOnBreak).toBe(true)
  })

  it('clamps at the slice end (play-to-winner: last structure index)', async () => {
    seed({ session: running({ index: 3 }) })
    const { session } = await advanceLevel({ tournamentId: TID, sessionId: SID, ...actor })
    expect(session.clockStartIndex).toBe(3) // already at last; stays
  })

  it('respects a capped slice end (maximumEndIndex)', async () => {
    seed({ session: running({ index: 1, maximumEndIndex: 1 }) })
    const { session } = await advanceLevel({ tournamentId: TID, sessionId: SID, ...actor })
    expect(session.clockStartIndex).toBe(1) // cap is index 1
  })

  it('keeps the clock paused when advancing while paused', async () => {
    seed({ session: running({ index: 0, paused: true }) })
    const { session } = await advanceLevel({ tournamentId: TID, sessionId: SID, ...actor })
    expect(session.clockStartIndex).toBe(1)
    expect(session.clockPausedAt).toBeInstanceOf(Timestamp)
  })

  it('rewinds to the previous entry, clamped at the slice start', async () => {
    seed({ session: running({ index: 2 }) })
    const back = await rewindLevel({ tournamentId: TID, sessionId: SID, ...actor })
    expect(back.session.clockStartIndex).toBe(1)

    seed({ session: running({ index: 0 }) })
    const atStart = await rewindLevel({ tournamentId: TID, sessionId: SID, ...actor })
    expect(atStart.session.clockStartIndex).toBe(0) // clamped
  })

  it('rejects changing level on a stopped clock', async () => {
    seed() // stopped
    await expect(advanceLevel({ tournamentId: TID, sessionId: SID, ...actor })).rejects.toThrow(TournamentError)
    expect(mock.calls.set).toHaveLength(0)
  })
})

describe('gotoLevel', () => {
  it('jumps to an explicit index', async () => {
    seed({ session: running({ index: 0 }) })
    const { session } = await gotoLevel({ tournamentId: TID, sessionId: SID, targetIndex: 3, ...actor })
    expect(session.clockStartIndex).toBe(3)
  })

  it('clamps an out-of-range index to the slice', async () => {
    seed({ session: running({ index: 0 }) })
    const { session } = await gotoLevel({ tournamentId: TID, sessionId: SID, targetIndex: 99, ...actor })
    expect(session.clockStartIndex).toBe(3) // structure last index
  })

  it('rejects a non-integer targetIndex without touching the store', async () => {
    seed({ session: running() })
    await expect(
      gotoLevel({ tournamentId: TID, sessionId: SID, targetIndex: 1.5, ...actor }),
    ).rejects.toThrow(TournamentError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })
})

describe('finishClock', () => {
  it('finishes the session, records actualEndIndex, and stops the clock', async () => {
    // 25 min in: 20 min level 0 + 5 min into level 1 → derived current index 1
    seed({ session: running({ index: 0, startedAgoMs: 25 * MIN }) })
    const { session, tournament } = await finishClock({ tournamentId: TID, sessionId: SID, ...actor })
    expect(session.status).toBe('finished')
    expect(session.actualEndTime).toBeInstanceOf(Timestamp)
    expect(session.actualEndIndex).toBe(1)
    expect(session.currentStructureIndex).toBe(1)
    // Clock stopped.
    expect(session.clockStartIndex).toBeNull()
    expect(session.clockStartedAt).toBeNull()
    expect(session.clockPausedAt).toBeNull()
    expect(tournament.currentStructureIndex).toBe(1)
    expect(Session.safeParse(sessionSet()).success, Session.safeParse(sessionSet()).error?.toString()).toBe(true)
    expect(Tournament.safeParse(tournamentSet()).success).toBe(true)
    expect(auditLog.writeAuditLogSafe.mock.calls[0][0]).toMatchObject({
      actionType: 'tournament.clockFinished',
      metadata: { sessionId: SID, endIndex: 1 },
    })
  })

  it('rejects finishing a session that is not in progress', async () => {
    seed() // scheduled
    await expect(finishClock({ tournamentId: TID, sessionId: SID, ...actor })).rejects.toThrow(TournamentError)
    expect(mock.calls.set).toHaveLength(0)
  })
})

describe('input validation', () => {
  it('rejects a blank actorId before any read/write', async () => {
    seed({ session: running() })
    await expect(pauseClock({ tournamentId: TID, sessionId: SID, actorId: '', actorRole: 'td' })).rejects.toThrow(
      TournamentError,
    )
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })

  it('rejects a blank sessionId', async () => {
    seed({ session: running() })
    await expect(pauseClock({ tournamentId: TID, sessionId: '', ...actor })).rejects.toThrow(TournamentError)
  })
})
