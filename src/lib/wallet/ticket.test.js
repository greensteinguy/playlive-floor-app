import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  makeMockStore,
  makePlayer,
  playerPath,
  ticketPath,
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
    ticketPath: (pid, tid) => ['players', pid, 'tickets', tid],
  },
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import { issueTicket } from './ticket'

beforeEach(() => {
  mockState = makeMockStore()
  let counter = 0
  nextId = () => `id-${++counter}`
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  auditLog.writeAuditLogSafe.mockClear()
})

describe('issueTicket', () => {
  it('happy path: creates ticket + credits ticketBalance', async () => {
    mockState.seed(playerPath('player-1'), makePlayer({ ticketBalance: 30_00 }))

    const result = await issueTicket({
      playerId: 'player-1',
      faceValue: 50_00,
      issuedReason: 'satelliteWin',
      issuedFromTournamentId: 'satellite-1',
      actorId: 'td-1',
      actorRole: 'td',
    })

    expect(result.ticketId).toBe('id-1')
    expect(result.newTicketBalance).toBe(80_00)

    const ticketCall = mockState.calls.set.find((c) => c.path[2] === 'tickets')
    expect(ticketCall.path).toEqual(ticketPath('player-1', 'id-1'))
    expect(ticketCall.data).toMatchObject({
      faceValue: 50_00,
      state: 'unused',
      issuedReason: 'satelliteWin',
      issuedFromTournamentId: 'satellite-1',
      usedAt: null,
      usedOnEntryId: null,
      usedOnTournamentId: null,
    })

    const playerUpdate = mockState.calls.update.find(
      (c) => c.path.length === 2 && c.path[0] === 'players'
    )
    expect(playerUpdate.partial.ticketBalance).toBe(80_00)
  })

  it.each([[0], [-1]])('rejects faceValue %s', async (faceValue) => {
    await expect(
      issueTicket({
        playerId: 'p',
        faceValue,
        actorId: 'a',
        actorRole: 'td',
      })
    ).rejects.toThrow(/faceValue must be > 0/)
  })
})
