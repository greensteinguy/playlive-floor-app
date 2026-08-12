import { describe, it, expect } from 'vitest'
import { RegistrationRequest } from './registrationRequest'
import { buildRegistrationRequest, ts } from './_fixtures'

describe('RegistrationRequest', () => {
  it('accepts a minimal pending request', () => {
    expect(() => RegistrationRequest.parse(buildRegistrationRequest())).not.toThrow()
  })

  it('rejects unknown requestedVia values', () => {
    expect(RegistrationRequest.safeParse(buildRegistrationRequest({ requestedVia: 'floorApp' })).success).toBe(false)
  })

  describe('state=pending', () => {
    it.each([
      ['entryId', 'entry-1'],
      ['resolvedBy', 'cashier-1'],
      ['resolvedAt', ts()],
      ['cancelReason', 'nope'],
    ])('rejects stray %s', (field, value) => {
      const result = RegistrationRequest.safeParse(buildRegistrationRequest({ [field]: value }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })

  describe('state=confirmed', () => {
    function confirmed(overrides = {}) {
      return buildRegistrationRequest({
        state: 'confirmed',
        entryId: 'player-1_1',
        resolvedBy: 'cashier-1',
        resolvedAt: ts(),
        ...overrides,
      })
    }

    it('accepts when entryId + resolution fields are set', () => {
      expect(() => RegistrationRequest.parse(confirmed())).not.toThrow()
    })

    it.each(['entryId', 'resolvedBy', 'resolvedAt'])('requires %s', (field) => {
      const result = RegistrationRequest.safeParse(confirmed({ [field]: null }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })

  describe('state=cancelled', () => {
    function cancelled(overrides = {}) {
      return buildRegistrationRequest({
        state: 'cancelled',
        resolvedBy: 'cashier-1',
        resolvedAt: ts(),
        cancelReason: 'player no-showed',
        ...overrides,
      })
    }

    it('accepts with resolution + reason', () => {
      expect(() => RegistrationRequest.parse(cancelled())).not.toThrow()
    })

    it.each(['resolvedBy', 'resolvedAt', 'cancelReason'])('requires %s', (field) => {
      const result = RegistrationRequest.safeParse(cancelled({ [field]: null }))
      expect(result.success).toBe(false)
      expect(result.error.issues.some((i) => i.path.includes(field))).toBe(true)
    })
  })
})
