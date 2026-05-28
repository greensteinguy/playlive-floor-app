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
import { recordManagerCredit, recordManagerDebit } from './managerAdjustment'
import { InsufficientWalletBalanceError, RoleNotAuthorizedError } from './errors'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
})

describe('recordManagerCredit', () => {
  it('happy path: adds to walletBalance, writes managerCredit row, audits', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 50_00 }))

    const result = await recordManagerCredit({
      playerId: 'player-1',
      amount: 25_00,
      reason: 'comp for chip miscount',
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    expect(result.newBalance).toBe(75_00)

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'managerCredit',
      amount: 25_00,
      actorRole: 'manager',
      method: null,
      notes: 'comp for chip miscount',
    })

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'wallet.managerCredit',
        metadata: expect.objectContaining({ reason: 'comp for chip miscount' }),
      })
    )
  })

  it('rejects non-manager actorRole', async () => {
    await expect(
      recordManagerCredit({
        playerId: 'p',
        amount: 100,
        reason: 'r',
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(RoleNotAuthorizedError)
  })

  it.each([[0], [-1]])('rejects amount %s', async (amount) => {
    await expect(
      recordManagerCredit({
        playerId: 'p',
        amount,
        reason: 'r',
        actorId: 'a',
        actorRole: 'manager',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })

  it('rejects empty reason', async () => {
    await expect(
      recordManagerCredit({
        playerId: 'p',
        amount: 100,
        reason: '',
        actorId: 'a',
        actorRole: 'manager',
      })
    ).rejects.toThrow(/reason is required/)
  })
})

describe('recordManagerDebit', () => {
  it('happy path: subtracts from walletBalance, writes managerDebit row', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 50_00 }))

    const result = await recordManagerDebit({
      playerId: 'player-1',
      amount: 25_00,
      reason: 'recouping over-credit from yesterday',
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    expect(result.newBalance).toBe(25_00)

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'managerDebit',
      amount: 25_00,
      actorRole: 'manager',
      notes: 'recouping over-credit from yesterday',
    })
  })

  it('rejects non-manager actorRole', async () => {
    await expect(
      recordManagerDebit({
        playerId: 'p',
        amount: 100,
        reason: 'r',
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(RoleNotAuthorizedError)
  })

  it('HARD: rejects debit that would push balance negative — no override', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: 10_00 }))

    await expect(
      recordManagerDebit({
        playerId: 'player-1',
        amount: 25_00,
        reason: 'r',
        actorId: 'manager-1',
        actorRole: 'manager',
      })
    ).rejects.toThrow(InsufficientWalletBalanceError)
  })

  it('rejects empty reason', async () => {
    await expect(
      recordManagerDebit({
        playerId: 'p',
        amount: 100,
        reason: '',
        actorId: 'a',
        actorRole: 'manager',
      })
    ).rejects.toThrow(/reason is required/)
  })
})
