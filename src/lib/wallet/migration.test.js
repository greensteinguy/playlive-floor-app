import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore, makePlayer, playerPath } from './_test-helpers'

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
  },
}))

import { runValidatedTransaction } from '../firestore'
import { recordOpeningBalance } from './migration'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
})

describe('recordOpeningBalance', () => {
  it('happy path: writes openingBalance row + updates player balance', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 0, totalDeposited: 0 }))

    const result = await recordOpeningBalance({
      playerId: 'player-1',
      amount: 250_00,
    })

    expect(result.walletTransactionId).toBe('id-1')

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'openingBalance',
      amount: 250_00,
      method: null,
      actorRole: 'system',
      actorId: 'system',
      reference: 'opening_balance',
    })

    const playerUpdate = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(playerUpdate.partial).toMatchObject({ walletBalance: 250_00, totalDeposited: 250_00 })
  })

  it('accepts a custom actorId for the migration script', async () => {
    mockState.seed(playerPath('player-1'), makePlayer())

    await recordOpeningBalance({
      playerId: 'player-1',
      amount: 100,
      actorId: 'migration-script-v1',
    })

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data.actorId).toBe('migration-script-v1')
    // actorRole is forced to 'system' regardless of actorId
    expect(wtxCall.data.actorRole).toBe('system')
  })

  it('uses provided timestamp when given', async () => {
    mockState.seed(playerPath('player-1'), makePlayer())
    const custom = Timestamp.fromMillis(1_500_000_000_000)

    await recordOpeningBalance({
      playerId: 'player-1',
      amount: 100,
      timestamp: custom,
    })

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data.timestamp).toBe(custom)
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(recordOpeningBalance({ playerId: 'p', amount })).rejects.toThrow(
      /amount must be > 0/
    )
  })
})
