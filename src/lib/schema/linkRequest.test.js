import { describe, it, expect } from 'vitest'
import { LinkRequest } from './linkRequest'
import { buildLinkRequest, ts } from './_fixtures'

describe('LinkRequest', () => {
  it('accepts a minimal pending request', () => {
    expect(() => LinkRequest.parse(buildLinkRequest())).not.toThrow()
  })

  it('accepts candidate ids for multipleMatches', () => {
    const req = buildLinkRequest({ reason: 'multipleMatches', candidatePlayerIds: ['player-1', 'player-2'] })
    expect(() => LinkRequest.parse(req)).not.toThrow()
  })

  it('rejects unknown reasons', () => {
    expect(LinkRequest.safeParse(buildLinkRequest({ reason: 'because' })).success).toBe(false)
  })

  describe('state=pending', () => {
    it.each([
      ['playerId', 'player-1'],
      ['resolvedBy', 'cashier-1'],
      ['resolvedAt', ts()],
    ])('rejects stray %s', (field, value) => {
      const result = LinkRequest.safeParse(buildLinkRequest({ [field]: value }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })

  describe('state=linked', () => {
    function linked(overrides = {}) {
      return buildLinkRequest({
        state: 'linked',
        playerId: 'player-1',
        resolvedBy: 'cashier-1',
        resolvedAt: ts(),
        ...overrides,
      })
    }

    it('accepts with playerId + resolution fields', () => {
      expect(() => LinkRequest.parse(linked())).not.toThrow()
    })

    it.each(['playerId', 'resolvedBy', 'resolvedAt'])('requires %s', (field) => {
      const result = LinkRequest.safeParse(linked({ [field]: null }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })

  describe('state=rejected', () => {
    it('accepts without playerId (rejection links nobody)', () => {
      const req = buildLinkRequest({ state: 'rejected', resolvedBy: 'manager-1', resolvedAt: ts(), resolutionNote: 'spam' })
      expect(() => LinkRequest.parse(req)).not.toThrow()
    })
  })
})
