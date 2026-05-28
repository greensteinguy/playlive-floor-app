import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  makeMockStore,
  makePlayer,
  makeTicket,
  playerPath,
  ticketPath,
} from '../wallet/_test-helpers'

let mockState
let entriesResult
let withdrawalsResult
let ticketsResult

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  entries: { listEntriesByPlayer: vi.fn() },
  withdrawalRequests: { listWithdrawalRequests: vi.fn() },
  tickets: { listTickets: vi.fn() },
  paths: {
    playerPath: (id) => ['players', id],
    ticketPath: (pid, tid) => ['players', pid, 'tickets', tid],
  },
}))

import { runValidatedTransaction, auditLog, entries, withdrawalRequests, tickets } from '../firestore'
import { mergePlayer } from './merge'
import {
  AlreadyMergedError,
  SameSourceAndTargetError,
  ActiveEntriesError,
  PendingWithdrawalsError,
  PlayerMergeError,
} from './errors'

beforeEach(() => {
  mockState = makeMockStore()
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()

  entriesResult = []
  withdrawalsResult = []
  ticketsResult = []
  entries.listEntriesByPlayer.mockImplementation(async () => entriesResult)
  withdrawalRequests.listWithdrawalRequests.mockImplementation(async () => withdrawalsResult)
  tickets.listTickets.mockImplementation(async () => ticketsResult)
})

function seedTwoPlayers({ source = {}, target = {} } = {}) {
  mockState.seed(playerPath('src'), makePlayer({ id: 'src', ...source }))
  mockState.seed(playerPath('tgt'), makePlayer({ id: 'tgt', ...target }))
}

describe('mergePlayer — happy path', () => {
  it('transfers balances + marks source merged + emits audit', async () => {
    seedTwoPlayers({
      source: { walletBalance: 100_00, ticketBalance: 50_00, totalDeposited: 500_00 },
      target: { walletBalance: 200_00, ticketBalance: 0,     totalDeposited: 300_00 },
    })

    const result = await mergePlayer({
      sourceId: 'src',
      targetId: 'tgt',
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    expect(result.transferred).toEqual({
      walletBalance: 100_00,
      ticketBalance: 50_00,
      totalDeposited: 500_00,
      ticketsMoved: 0,
    })

    const targetUpdate = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[1] === 'tgt'
    )
    expect(targetUpdate.partial).toMatchObject({
      walletBalance:  300_00, // 200 + 100
      ticketBalance:  50_00,
      totalDeposited: 800_00, // 300 + 500
    })

    const sourceUpdate = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[1] === 'src'
    )
    expect(sourceUpdate.partial).toMatchObject({
      isMerged: true,
      mergedIntoId: 'tgt',
      walletBalance: 0,
      ticketBalance: 0,
    })
    expect(sourceUpdate.partial.mergedAt).toBeDefined()

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'player.merged',
        targetId: 'tgt',
        metadata: expect.objectContaining({ sourceId: 'src', mergedIntoId: 'tgt' }),
      })
    )
  })

  it('moves only unused tickets; re-keys playerId; deletes source copies', async () => {
    seedTwoPlayers({
      source: { ticketBalance: 100_00 },
      target: { ticketBalance: 0 },
    })

    // Pre-transaction list of source's tickets (one unused, one used).
    ticketsResult = [
      makeTicket({ id: 'tk-unused', playerId: 'src', state: 'unused', faceValue: 50_00 }),
      makeTicket({
        id: 'tk-used', playerId: 'src', state: 'used', faceValue: 50_00,
        usedAt: Timestamp.now(), usedOnEntryId: 'e', usedOnTournamentId: 't',
      }),
    ]
    // Inside the transaction, the unused ticket is still unused on re-read.
    mockState.seed(ticketPath('src', 'tk-unused'), ticketsResult[0])

    await mergePlayer({
      sourceId: 'src', targetId: 'tgt',
      actorId: 'manager-1', actorRole: 'manager',
    })

    // The unused ticket was set on the target with re-keyed playerId.
    const targetTicketSet = mockState.calls.set.find(
      (c) => c.path[1] === 'tgt' && c.path[2] === 'tickets' && c.path[3] === 'tk-unused'
    )
    expect(targetTicketSet).toBeDefined()
    expect(targetTicketSet.data.playerId).toBe('tgt')

    // And deleted from source.
    const sourceTicketDelete = mockState.calls.delete.find(
      (c) => c.path[1] === 'src' && c.path[3] === 'tk-unused'
    )
    expect(sourceTicketDelete).toBeDefined()

    // The used ticket was NOT touched.
    expect(
      mockState.calls.set.find((c) => c.path[3] === 'tk-used')
    ).toBeUndefined()
    expect(
      mockState.calls.delete.find((c) => c.path[3] === 'tk-used')
    ).toBeUndefined()
  })

  it('skips a ticket that was used between the pre-check and the transaction', async () => {
    seedTwoPlayers()

    ticketsResult = [
      makeTicket({ id: 'tk-1', playerId: 'src', state: 'unused', faceValue: 50_00 }),
    ]
    // Race: by the time the transaction reads, the ticket is used.
    mockState.seed(
      ticketPath('src', 'tk-1'),
      makeTicket({
        id: 'tk-1', playerId: 'src', state: 'used', faceValue: 50_00,
        usedAt: Timestamp.now(), usedOnEntryId: 'e', usedOnTournamentId: 't',
      })
    )

    const result = await mergePlayer({
      sourceId: 'src', targetId: 'tgt',
      actorId: 'manager-1', actorRole: 'manager',
    })

    expect(result.transferred.ticketsMoved).toBe(0)
    expect(mockState.calls.delete.find((c) => c.path[3] === 'tk-1')).toBeUndefined()
  })
})

describe('mergePlayer — rejections', () => {
  it('rejects empty sourceId or targetId', async () => {
    await expect(
      mergePlayer({ sourceId: '', targetId: 'tgt', actorId: 'm', actorRole: 'manager' })
    ).rejects.toThrow(PlayerMergeError)
    await expect(
      mergePlayer({ sourceId: 'src', targetId: '   ', actorId: 'm', actorRole: 'manager' })
    ).rejects.toThrow(PlayerMergeError)
  })

  it('rejects sourceId === targetId', async () => {
    await expect(
      mergePlayer({ sourceId: 'src', targetId: 'src', actorId: 'm', actorRole: 'manager' })
    ).rejects.toThrow(SameSourceAndTargetError)
  })

  it('rejects when source is already merged', async () => {
    seedTwoPlayers({
      source: {
        isMerged: true,
        mergedIntoId: 'other',
        mergedAt: Timestamp.now(),
      },
    })

    await expect(
      mergePlayer({ sourceId: 'src', targetId: 'tgt', actorId: 'm', actorRole: 'manager' })
    ).rejects.toThrow(AlreadyMergedError)
  })

  it('rejects when target is already merged', async () => {
    seedTwoPlayers({
      target: {
        isMerged: true,
        mergedIntoId: 'other',
        mergedAt: Timestamp.now(),
      },
    })

    await expect(
      mergePlayer({ sourceId: 'src', targetId: 'tgt', actorId: 'm', actorRole: 'manager' })
    ).rejects.toThrow(AlreadyMergedError)
  })

  it('rejects when source has active entries', async () => {
    entriesResult = [
      { id: 'e1', playerId: 'src', bustedAt: null, voidedAt: null },
      { id: 'e2', playerId: 'src', bustedAt: Timestamp.now(), voidedAt: null }, // resolved; ignored
    ]

    await expect(
      mergePlayer({ sourceId: 'src', targetId: 'tgt', actorId: 'm', actorRole: 'manager' })
    ).rejects.toThrow(ActiveEntriesError)
  })

  it('ignores busted/voided entries (those don\'t block the merge)', async () => {
    entriesResult = [
      { id: 'e1', playerId: 'src', bustedAt: Timestamp.now(), voidedAt: null },
      { id: 'e2', playerId: 'src', bustedAt: null, voidedAt: Timestamp.now() },
    ]
    seedTwoPlayers()

    const result = await mergePlayer({
      sourceId: 'src', targetId: 'tgt', actorId: 'm', actorRole: 'manager',
    })
    expect(result.transferred).toBeDefined()
  })

  it('rejects when source has a pending withdrawal request', async () => {
    withdrawalsResult = [
      { id: 'wr-1', playerId: 'src', state: 'pending' },
      { id: 'wr-2', playerId: 'src', state: 'completed' }, // resolved; ignored
      { id: 'wr-3', playerId: 'other-player', state: 'pending' }, // someone else; ignored
    ]

    await expect(
      mergePlayer({ sourceId: 'src', targetId: 'tgt', actorId: 'm', actorRole: 'manager' })
    ).rejects.toThrow(PendingWithdrawalsError)
  })

  it('ignores non-pending or other-player withdrawals (those don\'t block)', async () => {
    withdrawalsResult = [
      { id: 'wr-1', playerId: 'src', state: 'completed' },
      { id: 'wr-2', playerId: 'src', state: 'cancelled' },
      { id: 'wr-3', playerId: 'other', state: 'pending' },
    ]
    seedTwoPlayers()

    const result = await mergePlayer({
      sourceId: 'src', targetId: 'tgt', actorId: 'm', actorRole: 'manager',
    })
    expect(result.transferred).toBeDefined()
  })
})
