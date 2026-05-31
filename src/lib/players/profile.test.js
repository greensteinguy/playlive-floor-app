import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore, makePlayer } from '../wallet/_test-helpers'

// Only the data layer is mocked — the real Player schema is imported so the
// schema-conformance tests can assert the op assembles a document that actually
// validates (the mocked validatedSet / mock tx.set do NOT validate). createPlayer
// writes via the top-level validatedSet; updatePlayer read-modify-writes via
// runValidatedTransaction (driven by the shared mock tx).
vi.mock('../firestore', () => ({
  validatedSet: vi.fn(),
  runValidatedTransaction: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  generateId: vi.fn(),
  paths: {
    playerPath: (id) => ['players', id],
  },
}))

import { validatedSet, runValidatedTransaction, auditLog, generateId } from '../firestore'
import { Player } from '../schema'
import { createPlayer, updatePlayer } from './profile'
import { PlayerError } from './errors'

let mockState
// validatedSet calls recorded in order ({ path, data }).
let setCalls

// The document createPlayer handed to validatedSet.
function capturedDoc() {
  return setCalls[0]?.data
}
// The document updatePlayer handed to the transaction's tx.set, for player-1.
function updatedDoc() {
  return mockState.calls.set.find((c) => c.path[1] === 'player-1')?.data
}

function makeArgs(overrides = {}) {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '0400 123 456',
    actorId: 'cashier-1',
    actorRole: 'cashier',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState = makeMockStore()
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  setCalls = []
  // Mirror the real validatedSet: attach the id and echo the validated doc back.
  validatedSet.mockImplementation(async (pathParts, _schema, data) => {
    const id = pathParts[pathParts.length - 1]
    const validated = { ...data, id }
    setCalls.push({ path: pathParts, data: validated })
    return validated
  })
  generateId.mockReturnValue('player-generated')
})

// ── createPlayer — document assembly ──────────────────────────────────────────

describe('createPlayer — document assembly', () => {
  it('persists at the generated id and echoes the assembled document back', async () => {
    const created = await createPlayer(makeArgs())

    expect(validatedSet).toHaveBeenCalledTimes(1)
    expect(setCalls[0].path).toEqual(['players', 'player-generated'])
    expect(setCalls[0].data).toMatchObject({
      id: 'player-generated',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '0400 123 456',
      createdBy: 'cashier-1',
    })
    expect(created).toEqual(setCalls[0].data)
  })

  it('zeroes balances, clears merge flags, and fills the standard fields', async () => {
    await createPlayer(makeArgs())
    const doc = capturedDoc()

    expect(doc.legacyId).toBeNull()
    expect(doc.walletBalance).toBe(0)
    expect(doc.ticketBalance).toBe(0)
    expect(doc.totalDeposited).toBe(0)
    expect(doc.isMerged).toBe(false)
    expect(doc.mergedIntoId).toBeNull()
    expect(doc.mergedAt).toBeNull()
    expect(doc.archivedAt).toBeNull()
    expect(doc.createdBy).toBe('cashier-1')
    // createdAt and updatedAt come from a single now() — identical on create.
    expect(doc.createdAt).toBeInstanceOf(Timestamp)
    expect(doc.createdAt).toBe(doc.updatedAt)
  })

  it('collapses blank optional fields to null', async () => {
    await createPlayer(makeArgs({ displayName: '', email: '   ', streetAddress: '', countryCode: '' }))
    const doc = capturedDoc()
    expect(doc.displayName).toBeNull()
    expect(doc.email).toBeNull()
    expect(doc.streetAddress).toBeNull()
    expect(doc.countryCode).toBeNull()
  })

  it('trims provided name and contact fields', async () => {
    await createPlayer(
      makeArgs({ firstName: '  Jane ', lastName: ' Doe  ', displayName: ' Ace ', email: ' a@b.com ' })
    )
    const doc = capturedDoc()
    expect(doc.firstName).toBe('Jane')
    expect(doc.lastName).toBe('Doe')
    expect(doc.displayName).toBe('Ace')
    expect(doc.email).toBe('a@b.com')
  })
})

// ── createPlayer — schema conformance ─────────────────────────────────────────

describe('createPlayer — schema conformance', () => {
  it('assembles a document that passes the real Player schema (minimal)', async () => {
    await createPlayer(makeArgs())
    const result = Player.safeParse(capturedDoc())
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('assembles a valid document with every optional field set', async () => {
    await createPlayer(
      makeArgs({
        displayName: 'Jane "Ace" Doe',
        email: 'jane@example.com',
        streetAddress: '1 Test St, Melbourne',
        countryCode: 'AU',
      })
    )
    const result = Player.safeParse(capturedDoc())
    expect(result.success, result.error?.toString()).toBe(true)
  })
})

// ── createPlayer — audit ──────────────────────────────────────────────────────

describe('createPlayer — audit', () => {
  it('writes a player.created audit row after the write', async () => {
    await createPlayer(makeArgs())
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'cashier-1',
        actorRole: 'cashier',
        actionType: 'player.created',
        targetType: 'player',
        targetId: 'player-generated',
        metadata: { firstName: 'Jane', lastName: 'Doe', phone: '0400 123 456' },
      })
    )
  })
})

// ── createPlayer — rejections ─────────────────────────────────────────────────

describe('createPlayer — rejections', () => {
  it('rejects a blank actorId before writing', async () => {
    await expect(createPlayer(makeArgs({ actorId: '' }))).rejects.toThrow(PlayerError)
    expect(validatedSet).not.toHaveBeenCalled()
  })

  it('rejects a blank firstName before writing', async () => {
    await expect(createPlayer(makeArgs({ firstName: '   ' }))).rejects.toThrow(PlayerError)
    expect(validatedSet).not.toHaveBeenCalled()
  })

  it('rejects a blank lastName before writing', async () => {
    await expect(createPlayer(makeArgs({ lastName: '' }))).rejects.toThrow(PlayerError)
    expect(validatedSet).not.toHaveBeenCalled()
  })

  it('rejects a blank phone before writing', async () => {
    await expect(createPlayer(makeArgs({ phone: '' }))).rejects.toThrow(PlayerError)
    expect(validatedSet).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// updatePlayer — read-modify-write profile edit
// ════════════════════════════════════════════════════════════════════════════

describe('updatePlayer — merge semantics', () => {
  it('merges the patch, preserves untouched fields, and bumps updatedAt', async () => {
    const existing = makePlayer({ id: 'player-1' })
    mockState.seed(['players', 'player-1'], existing)

    const updated = await updatePlayer({
      id: 'player-1',
      patch: { firstName: 'Janet', email: 'janet@example.com' },
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })

    const doc = updatedDoc()
    expect(doc.firstName).toBe('Janet')
    expect(doc.email).toBe('janet@example.com')
    expect(doc.lastName).toBe(existing.lastName) // untouched
    expect(doc.phone).toBe(existing.phone) // untouched
    expect(doc.createdAt).toBe(existing.createdAt) // untouched
    expect(doc.updatedAt).not.toBe(existing.updatedAt) // bumped
    expect(doc.updatedAt).toBeInstanceOf(Timestamp)
    expect(updated.firstName).toBe('Janet')
  })

  it('re-reads inside a transaction so the full shape is re-validated', async () => {
    mockState.seed(['players', 'player-1'], makePlayer({ id: 'player-1' }))
    await updatePlayer({ id: 'player-1', patch: { firstName: 'x' }, actorId: 'cashier-1', actorRole: 'cashier' })
    expect(runValidatedTransaction).toHaveBeenCalledTimes(1)
    expect(mockState.calls.get.find((c) => c.path[1] === 'player-1')).toBeDefined()
  })

  it('collapses a blanked optional field in the patch to null', async () => {
    mockState.seed(['players', 'player-1'], makePlayer({ id: 'player-1', email: 'old@example.com' }))
    await updatePlayer({ id: 'player-1', patch: { email: '' }, actorId: 'cashier-1', actorRole: 'cashier' })
    expect(updatedDoc().email).toBeNull()
  })
})

describe('updatePlayer — protected fields', () => {
  it('rejects a patch that names a balance field before running the transaction', async () => {
    await expect(
      updatePlayer({ id: 'player-1', patch: { walletBalance: 999 }, actorId: 'cashier-1', actorRole: 'cashier' })
    ).rejects.toThrow(PlayerError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })

  it('rejects a patch that names merge or identity fields', async () => {
    await expect(
      updatePlayer({ id: 'player-1', patch: { isMerged: true }, actorId: 'cashier-1', actorRole: 'cashier' })
    ).rejects.toThrow(PlayerError)
    await expect(
      updatePlayer({ id: 'player-1', patch: { id: 'other' }, actorId: 'cashier-1', actorRole: 'cashier' })
    ).rejects.toThrow(PlayerError)
    await expect(
      updatePlayer({ id: 'player-1', patch: { createdAt: Timestamp.now() }, actorId: 'cashier-1', actorRole: 'cashier' })
    ).rejects.toThrow(PlayerError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })
})

describe('updatePlayer — schema conformance', () => {
  it('produces a merged document that passes the real Player schema', async () => {
    mockState.seed(['players', 'player-1'], makePlayer({ id: 'player-1' }))
    await updatePlayer({
      id: 'player-1',
      patch: { firstName: 'Renamed', email: 'renamed@example.com', streetAddress: '2 New Rd' },
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })
    const result = Player.safeParse(updatedDoc())
    expect(result.success, result.error?.toString()).toBe(true)
  })

  it('a malformed email yields a doc the real schema rejects (caught by the real tx.set in prod)', async () => {
    mockState.seed(['players', 'player-1'], makePlayer({ id: 'player-1' }))
    await updatePlayer({ id: 'player-1', patch: { email: 'not-an-email' }, actorId: 'cashier-1', actorRole: 'cashier' })
    expect(Player.safeParse(updatedDoc()).success).toBe(false)
  })
})

describe('updatePlayer — audit', () => {
  it('writes a player.updated row recording the changed fields', async () => {
    mockState.seed(['players', 'player-1'], makePlayer({ id: 'player-1' }))
    await updatePlayer({
      id: 'player-1',
      patch: { firstName: 'x', streetAddress: '3 A St' },
      actorId: 'cashier-1',
      actorRole: 'cashier',
    })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'cashier-1',
        actorRole: 'cashier',
        actionType: 'player.updated',
        targetType: 'player',
        targetId: 'player-1',
        metadata: { changedFields: ['firstName', 'streetAddress'] },
      })
    )
  })
})

describe('updatePlayer — rejections', () => {
  it('rejects a blank actorId before running the transaction', async () => {
    await expect(
      updatePlayer({ id: 'player-1', patch: { firstName: 'x' }, actorId: '', actorRole: 'cashier' })
    ).rejects.toThrow(PlayerError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })

  it('rejects a blank id before running the transaction', async () => {
    await expect(
      updatePlayer({ id: '  ', patch: { firstName: 'x' }, actorId: 'cashier-1', actorRole: 'cashier' })
    ).rejects.toThrow(PlayerError)
    expect(runValidatedTransaction).not.toHaveBeenCalled()
  })

  it('propagates NotFoundError and skips the audit when the player does not exist', async () => {
    await expect(
      updatePlayer({ id: 'missing', patch: { firstName: 'x' }, actorId: 'cashier-1', actorRole: 'cashier' })
    ).rejects.toThrow()
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })
})
