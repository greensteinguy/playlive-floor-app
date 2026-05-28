import { describe, it, expect, vi, beforeEach } from 'vitest'
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

import { runValidatedTransaction, auditLog } from '../firestore'
import { writeAdjustment } from './adjustment'
import { InsufficientWalletBalanceError } from './errors'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
})

describe('writeAdjustment', () => {
  it('credit happy path: adds to walletBalance', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 100_00 }))

    const result = await writeAdjustment({
      playerId: 'player-1',
      amount: 25_00,
      direction: 'credit',
      reason: 'compensating for prior duplicate spend',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.newBalance).toBe(125_00)

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'adjustment',
      amount: 25_00,
      method: null,
      direction: 'credit',
    })
    expect(wtxCall.data.notes).toMatch(/adjustment: credit/)

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'wallet.adjustment',
        metadata: expect.objectContaining({ direction: 'credit' }),
      })
    )
  })

  it('debit happy path: subtracts from walletBalance', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 100_00 }))

    const result = await writeAdjustment({
      playerId: 'player-1',
      amount: 25_00,
      direction: 'debit',
      reason: 'over-credited yesterday',
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    expect(result.newBalance).toBe(75_00)
    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data.direction).toBe('debit')
    expect(wtxCall.data.notes).toMatch(/adjustment: debit/)
  })

  it('HARD: rejects debit that would push balance negative', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 10_00 }))

    await expect(
      writeAdjustment({
        playerId: 'player-1',
        amount: 25_00,
        direction: 'debit',
        reason: 'oops',
        actorId: 'manager-1',
        actorRole: 'manager',
      })
    ).rejects.toThrow(InsufficientWalletBalanceError)
  })

  it('rejects invalid direction', async () => {
    await expect(
      writeAdjustment({
        playerId: 'p',
        amount: 100,
        direction: 'sideways',
        reason: 'r',
        actorId: 'a',
        actorRole: 'manager',
      })
    ).rejects.toThrow(/direction must be 'credit' or 'debit'/)
  })

  it('rejects empty reason', async () => {
    await expect(
      writeAdjustment({
        playerId: 'p',
        amount: 100,
        direction: 'credit',
        reason: '',
        actorId: 'a',
        actorRole: 'manager',
      })
    ).rejects.toThrow(/reason is required/)
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(
      writeAdjustment({
        playerId: 'p',
        amount,
        direction: 'credit',
        reason: 'r',
        actorId: 'a',
        actorRole: 'manager',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })
})
