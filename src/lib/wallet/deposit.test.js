import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  makeMockStore,
  makePlayer,
  playerPath,
  walletTransactionPath,
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
  },
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import { recordDeposit } from './deposit'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `mock-id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
})

describe('recordDeposit', () => {
  it('happy path: credits walletBalance and totalDeposited by amount', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 5_000, totalDeposited: 5_000 }))

    const result = await recordDeposit({
      playerId: 'player-1',
      amount: 1_000,
      method: 'cash',
      reference: 'cash',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.newBalance).toBe(6_000)
    expect(result.walletTransactionId).toBe('mock-id-1')

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.path).toEqual(walletTransactionPath('player-1', 'mock-id-1'))
    expect(wtxCall.data).toMatchObject({
      playerId: 'player-1',
      type: 'deposit',
      amount: 1_000,
      method: 'cash',
      reference: 'cash',
      relatedDocId: null,
    })

    const updateCall = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(updateCall.partial).toMatchObject({ walletBalance: 6_000, totalDeposited: 6_000 })

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'wallet.deposit',
        targetType: 'player',
        targetId: 'player-1',
      })
    )
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(
      recordDeposit({
        playerId: 'player-1',
        amount,
        method: 'cash',
        reference: 'x',
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })

  it('rejects invalid method', async () => {
    await expect(
      recordDeposit({
        playerId: 'player-1',
        amount: 1_000,
        method: 'crypto',
        reference: 'x',
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/method must be one of cash\/eftpos\/payid/)
  })
})
