import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  makeMockStore,
  makePlayer,
  makeBountyDraw,
  playerPath,
  bountyDrawPath,
} from './_test-helpers'

let mockState
let nextId

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  validatedSet: vi.fn(),
  generateId: vi.fn(() => nextId()),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    playerPath: (id) => ['players', id],
    walletTransactionPath: (pid, tid) => ['players', pid, 'walletTransactions', tid],
    bountyDrawPath: (tid, did) => ['tournaments', tid, 'bountyDraws', did],
  },
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import { confirmWinCredit, confirmBountyWinCredit } from './winCredit'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
})

describe('confirmWinCredit', () => {
  it('happy path: credits walletBalance by amount, writes winCredit row', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 0 }))

    const result = await confirmWinCredit({
      playerId: 'player-1',
      amount: 200_00,
      relatedDocId: 'entry-99',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.newBalance).toBe(200_00)

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'winCredit',
      amount: 200_00,
      method: null,
      relatedDocId: 'entry-99',
    })

    const updateCall = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(updateCall.partial.walletBalance).toBe(200_00)
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(
      confirmWinCredit({
        playerId: 'p',
        amount,
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })
})

describe('confirmBountyWinCredit', () => {
  function seed({ walletTransactionId = null } = {}) {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 0 }))
    mockState.seed(
      bountyDrawPath('tournament-1', 'draw-1'),
      makeBountyDraw({ walletTransactionId })
    )
  }

  it('happy path: credits balance + links bountyDraw to walletTransaction', async () => {
    seed()

    const result = await confirmBountyWinCredit({
      tournamentId: 'tournament-1',
      drawId: 'draw-1',
      playerId: 'player-1',
      amount: 1_000_00,
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.newBalance).toBe(1_000_00)

    const drawUpdate = mockState.calls.update.find(
      (c) => c.path[0] === 'tournaments' && c.path[2] === 'bountyDraws'
    )
    expect(drawUpdate.partial).toMatchObject({ walletTransactionId: result.walletTransactionId })
  })

  it('rejects double-confirm (bountyDraw already has walletTransactionId)', async () => {
    seed({ walletTransactionId: 'prior-tx-id' })

    await expect(
      confirmBountyWinCredit({
        tournamentId: 'tournament-1',
        drawId: 'draw-1',
        playerId: 'player-1',
        amount: 1_000_00,
        actorId: 'cashier-1',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/already confirmed/)
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(
      confirmBountyWinCredit({
        tournamentId: 't',
        drawId: 'd',
        playerId: 'p',
        amount,
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })
})
