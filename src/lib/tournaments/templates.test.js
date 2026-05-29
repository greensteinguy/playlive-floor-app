import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore } from '../wallet/_test-helpers'

let mockState

vi.mock('../firestore', () => ({
  validatedSet: vi.fn(),
  runValidatedTransaction: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  generateId: vi.fn(),
  paths: {
    structureTemplatePath: (id) => ['structureTemplates', id],
    tournamentTemplatePath: (id) => ['tournamentTemplates', id],
  },
}))

import { validatedSet, runValidatedTransaction, auditLog, generateId } from '../firestore'
import {
  createStructureTemplate,
  updateStructureTemplate,
  archiveStructureTemplate,
  createTournamentTemplate,
  updateTournamentTemplate,
  archiveTournamentTemplate,
} from './templates'
import { TournamentError } from './errors'

// ── Fixtures ─────────────────────────────────────────────────────────────────
// The mocked data layer doesn't validate, so these only need representative
// shapes — enough to assert the document the module assembles and merges.

const LEVELS = [
  { type: 'level', blindNumber: 1, smallBlind: 100, bigBlind: 200, ante: 0, bringIn: 0, durationMinutes: 20 },
  { type: 'break', durationMinutes: 10, label: null, isColorUp: false },
  { type: 'level', blindNumber: 2, smallBlind: 200, bigBlind: 400, ante: 0, bringIn: 0, durationMinutes: 20 },
]

const CONFIG = {
  name: 'Friday NLH',
  shortDescription: '',
  isMultiDay: false,
  isMultiFlight: false,
  gameType: 'nlh',
  buyIn: 100_00,
  hospitalityCost: 0,
  guarantee: 0,
  houseConsumption: 0,
  structureTemplateId: null,
  startingStack: 20_000,
  reentryConfig: { type: 'freezeout', maxReentries: null, maxRebuys: null, hasAddOn: false },
  hasUpperDeckMainDeck: false,
  satelliteConfig: null,
  bountyPoolConfig: null,
}

function makeStructureTemplate(overrides = {}) {
  return {
    id: 'st-1',
    name: 'Standard Turbo',
    description: null,
    levels: LEVELS,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: 'manager-1',
    archivedAt: null,
    ...overrides,
  }
}

function makeTournamentTemplate(overrides = {}) {
  return {
    id: 'tt-1',
    name: 'Friday Night',
    description: null,
    config: CONFIG,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdBy: 'manager-1',
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState = makeMockStore()
  runValidatedTransaction.mockImplementation(async (fn) => fn(mockState.tx))
  // Real validatedSet returns the validated doc (id included); the data the
  // module passes already carries the id, so echo it back.
  validatedSet.mockImplementation(async (_pathParts, _schema, data) => data)
  generateId.mockReturnValue('tmpl-generated')
})

// ── Create ───────────────────────────────────────────────────────────────────

describe('createStructureTemplate', () => {
  it('assembles a full document (audit fields + archivedAt) and persists it', async () => {
    const created = await createStructureTemplate({
      name: 'Deepstack',
      description: 'Slow blinds',
      levels: LEVELS,
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    expect(validatedSet).toHaveBeenCalledTimes(1)
    const [pathParts, , doc] = validatedSet.mock.calls[0]
    expect(pathParts).toEqual(['structureTemplates', 'tmpl-generated'])
    expect(doc).toMatchObject({
      id: 'tmpl-generated',
      name: 'Deepstack',
      description: 'Slow blinds',
      levels: LEVELS,
      createdBy: 'manager-1',
      archivedAt: null,
    })
    // createdAt and updatedAt come from a single now() — identical on create.
    expect(doc.createdAt).toBe(doc.updatedAt)
    expect(created).toEqual(doc)
  })

  it('defaults description to null when omitted', async () => {
    await createStructureTemplate({
      name: 'No description',
      levels: LEVELS,
      actorId: 'manager-1',
      actorRole: 'manager',
    })
    expect(validatedSet.mock.calls[0][2].description).toBeNull()
  })

  it('writes a structureTemplate.created audit row after the write', async () => {
    await createStructureTemplate({
      name: 'Deepstack',
      levels: LEVELS,
      actorId: 'manager-1',
      actorRole: 'manager',
    })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'manager-1',
        actorRole: 'manager',
        actionType: 'structureTemplate.created',
        targetType: 'structureTemplate',
        targetId: 'tmpl-generated',
        metadata: { name: 'Deepstack', levelCount: 3 },
      })
    )
  })
})

describe('createTournamentTemplate', () => {
  it('assembles a full document and records gameType in the audit metadata', async () => {
    const created = await createTournamentTemplate({
      name: 'Friday Night',
      config: CONFIG,
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    const [pathParts, , doc] = validatedSet.mock.calls[0]
    expect(pathParts).toEqual(['tournamentTemplates', 'tmpl-generated'])
    expect(doc).toMatchObject({
      id: 'tmpl-generated',
      name: 'Friday Night',
      description: null,
      config: CONFIG,
      createdBy: 'manager-1',
      archivedAt: null,
    })
    expect(created).toEqual(doc)

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'tournamentTemplate.created',
        targetType: 'tournamentTemplate',
        targetId: 'tmpl-generated',
        metadata: { name: 'Friday Night', gameType: 'nlh' },
      })
    )
  })
})

// ── Update ───────────────────────────────────────────────────────────────────

describe('updateStructureTemplate', () => {
  it('merges the patch, preserves untouched fields, and bumps updatedAt', async () => {
    const existing = makeStructureTemplate({ id: 'st-1' })
    mockState.seed(['structureTemplates', 'st-1'], existing)

    const updated = await updateStructureTemplate({
      id: 'st-1',
      patch: { name: 'Renamed Turbo' },
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    const setCall = mockState.calls.set.find((c) => c.path[1] === 'st-1')
    expect(setCall.data.name).toBe('Renamed Turbo')
    expect(setCall.data.levels).toBe(existing.levels) // untouched
    expect(setCall.data.createdAt).toBe(existing.createdAt) // untouched
    expect(setCall.data.updatedAt).not.toBe(existing.updatedAt) // bumped
    expect(updated.name).toBe('Renamed Turbo')

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'structureTemplate.updated',
        targetId: 'st-1',
        metadata: { changedFields: ['name'] },
      })
    )
  })

  it('re-reads inside a transaction so the full shape is re-validated', async () => {
    mockState.seed(['structureTemplates', 'st-1'], makeStructureTemplate({ id: 'st-1' }))
    await updateStructureTemplate({
      id: 'st-1',
      patch: { levels: LEVELS },
      actorId: 'manager-1',
      actorRole: 'manager',
    })
    expect(runValidatedTransaction).toHaveBeenCalledTimes(1)
    expect(mockState.calls.get.find((c) => c.path[1] === 'st-1')).toBeDefined()
  })
})

describe('updateTournamentTemplate', () => {
  it('merges a config patch and audits the changed fields', async () => {
    mockState.seed(['tournamentTemplates', 'tt-1'], makeTournamentTemplate({ id: 'tt-1' }))

    const nextConfig = { ...CONFIG, buyIn: 200_00 }
    await updateTournamentTemplate({
      id: 'tt-1',
      patch: { config: nextConfig },
      actorId: 'manager-1',
      actorRole: 'manager',
    })

    const setCall = mockState.calls.set.find((c) => c.path[1] === 'tt-1')
    expect(setCall.data.config.buyIn).toBe(200_00)
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'tournamentTemplate.updated',
        targetId: 'tt-1',
        metadata: { changedFields: ['config'] },
      })
    )
  })
})

// ── Archive ──────────────────────────────────────────────────────────────────

describe('archiveStructureTemplate', () => {
  it('sets archivedAt and audits the archive', async () => {
    mockState.seed(['structureTemplates', 'st-1'], makeStructureTemplate({ id: 'st-1', archivedAt: null }))

    await archiveStructureTemplate({ id: 'st-1', actorId: 'manager-1', actorRole: 'manager' })

    const setCall = mockState.calls.set.find((c) => c.path[1] === 'st-1')
    expect(setCall.data.archivedAt).toBeInstanceOf(Timestamp)
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'structureTemplate.archived',
        targetId: 'st-1',
      })
    )
  })
})

describe('archiveTournamentTemplate', () => {
  it('sets archivedAt and audits the archive', async () => {
    mockState.seed(['tournamentTemplates', 'tt-1'], makeTournamentTemplate({ id: 'tt-1', archivedAt: null }))

    await archiveTournamentTemplate({ id: 'tt-1', actorId: 'manager-1', actorRole: 'manager' })

    const setCall = mockState.calls.set.find((c) => c.path[1] === 'tt-1')
    expect(setCall.data.archivedAt).toBeInstanceOf(Timestamp)
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'tournamentTemplate.archived',
        targetId: 'tt-1',
      })
    )
  })
})

// ── Rejections ───────────────────────────────────────────────────────────────

describe('template ops — rejections', () => {
  it('rejects a missing/blank actorId on create', async () => {
    await expect(
      createStructureTemplate({ name: 'x', levels: LEVELS, actorId: '', actorRole: 'manager' })
    ).rejects.toThrow(TournamentError)
    expect(validatedSet).not.toHaveBeenCalled()
  })

  it('rejects a missing/blank id on update', async () => {
    await expect(
      updateStructureTemplate({ id: '   ', patch: { name: 'x' }, actorId: 'manager-1', actorRole: 'manager' })
    ).rejects.toThrow(TournamentError)
  })

  it('rejects a missing/blank id on archive', async () => {
    await expect(
      archiveTournamentTemplate({ id: '', actorId: 'manager-1', actorRole: 'manager' })
    ).rejects.toThrow(TournamentError)
  })

  it('propagates NotFoundError when updating a template that does not exist', async () => {
    // store is empty → mock tx.get throws NotFoundError
    await expect(
      updateStructureTemplate({ id: 'missing', patch: { name: 'x' }, actorId: 'manager-1', actorRole: 'manager' })
    ).rejects.toThrow()
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })
})
