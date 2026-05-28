import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  makeMockStore,
  makePlayer,
  makeWithdrawalRequest,
  playerPath,
  withdrawalRequestPath,
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
    withdrawalRequestPath: (id) => ['withdrawalRequests', id],
  },
}))

import { runValidatedTransaction, validatedSet, auditLog } from '../firestore'
import {
  createWithdrawalRequest,
  completeWithdrawal,
  cancelWithdrawal,
} from './withdrawal'
import {
  InsufficientWalletBalanceError,
  RoleNotAuthorizedError,
  WithdrawalStateError,
} from './errors'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  validatedSet.mockReset()
  validatedSet.mockResolvedValue(undefined)
  auditLog.writeAuditLogSafe.mockClear()
})

describe('createWithdrawalRequest', () => {
  it('happy path: writes pending request, no wallet impact', async () => {
    const result = await createWithdrawalRequest({
      playerId: 'player-1',
      amount: 50_00,
      payoutMethod: 'cash',
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    expect(result.withdrawalRequestId).toBe('id-1')
    expect(validatedSet).toHaveBeenCalledWith(
      withdrawalRequestPath('id-1'),
      expect.anything(),
      expect.objectContaining({
        playerId: 'player-1',
        amount: 50_00,
        payoutMethod: 'cash',
        state: 'pending',
        requestedBy: 'cashier-1',
      })
    )
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'withdrawal.requested' })
    )
  })

  it('rejects non-cashier-or-manager actorRole', async () => {
    await expect(
      createWithdrawalRequest({
        playerId: 'p',
        amount: 50,
        payoutMethod: 'cash',
        actorId: 'a',
        actorRole: 'td',
      })
    ).rejects.toThrow(RoleNotAuthorizedError)
  })

  it('rejects amount <= 0', async () => {
    await expect(
      createWithdrawalRequest({
        playerId: 'p',
        amount: 0,
        payoutMethod: 'cash',
        actorId: 'a',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(/amount must be > 0/)
  })
})

describe('completeWithdrawal', () => {
  function seed({ state = 'pending', amount = 50_00, balance = 100_00 } = {}) {
    mockState.seed(playerPath('player-1'), makePlayer({ walletBalance: balance }))
    mockState.seed(
      withdrawalRequestPath('wr-1'),
      makeWithdrawalRequest({ state, amount })
    )
  }

  it('happy path: state -> completed, debits wallet, writes withdrawalComplete row', async () => {
    seed({ amount: 50_00, balance: 100_00 })

    const result = await completeWithdrawal({
      requestId: 'wr-1',
      actorId: 'manager-1',
      actorRole: 'manager',
      externalReference: 'BANK-XYZ',
    })

    expect(result.newBalance).toBe(50_00)

    const wtxCall = mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    expect(wtxCall.data).toMatchObject({
      type: 'withdrawalComplete',
      amount: 50_00,
      method: null,
      reference: 'BANK-XYZ',
      relatedDocId: 'wr-1',
    })

    const wrUpdate = mockState.calls.update.find((c) => c.path[0] === 'withdrawalRequests')
    expect(wrUpdate.partial).toMatchObject({
      state: 'completed',
      completedBy: 'manager-1',
      externalReference: 'BANK-XYZ',
    })

    const playerUpdate = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(playerUpdate.partial.walletBalance).toBe(50_00)
  })

  it('rejects non-manager actorRole', async () => {
    await expect(
      completeWithdrawal({
        requestId: 'wr-1',
        actorId: 'cashier-1',
        actorRole: 'cashier',
      })
    ).rejects.toThrow(RoleNotAuthorizedError)
  })

  it('rejects non-pending state', async () => {
    seed({ state: 'cancelled' })
    await expect(
      completeWithdrawal({
        requestId: 'wr-1',
        actorId: 'manager-1',
        actorRole: 'manager',
      })
    ).rejects.toThrow(WithdrawalStateError)
  })

  it('HARD: rejects when balance < withdrawal amount — no override', async () => {
    seed({ amount: 200_00, balance: 100_00 })
    await expect(
      completeWithdrawal({
        requestId: 'wr-1',
        actorId: 'manager-1',
        actorRole: 'manager',
      })
    ).rejects.toThrow(InsufficientWalletBalanceError)
  })
})

describe('cancelWithdrawal', () => {
  function seed({ state = 'pending' } = {}) {
    mockState.seed(withdrawalRequestPath('wr-1'), makeWithdrawalRequest({ state }))
  }

  it('happy path: state -> cancelled, no wallet impact', async () => {
    seed()
    await cancelWithdrawal({
      requestId: 'wr-1',
      actorId: 'cashier-1',
      actorRole: 'cashier',
      cancelReason: 'player changed mind',
    })

    const wrUpdate = mockState.calls.update.find((c) => c.path[0] === 'withdrawalRequests')
    expect(wrUpdate.partial).toMatchObject({
      state: 'cancelled',
      cancelledBy: 'cashier-1',
      cancelReason: 'player changed mind',
    })

    // No walletTransaction written
    expect(
      mockState.calls.set.find((c) => c.path[2] === 'walletTransactions')
    ).toBeUndefined()
  })

  it('rejects non-pending state', async () => {
    seed({ state: 'completed' })
    await expect(
      cancelWithdrawal({
        requestId: 'wr-1',
        actorId: 'cashier-1',
        actorRole: 'cashier',
        cancelReason: 'oops',
      })
    ).rejects.toThrow(WithdrawalStateError)
  })

  it('rejects empty cancelReason', async () => {
    await expect(
      cancelWithdrawal({
        requestId: 'wr-1',
        actorId: 'cashier-1',
        actorRole: 'cashier',
        cancelReason: '',
      })
    ).rejects.toThrow(/cancelReason is required/)
  })

  it('rejects unauthorized actorRole', async () => {
    await expect(
      cancelWithdrawal({
        requestId: 'wr-1',
        actorId: 'a',
        actorRole: 'td',
        cancelReason: 'oops',
      })
    ).rejects.toThrow(RoleNotAuthorizedError)
  })
})
