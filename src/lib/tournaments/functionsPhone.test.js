// Tests for functions/core/phone.js — the account auto-link phone matcher.
// Lives in the main suite (the functions package has no test runner of its
// own; vitest here transforms the ESM source directly).

import { describe, it, expect } from 'vitest'
import { normalizePhone, phonesMatch, findLinkCandidates } from '../../../functions/core/phone.js'

describe('normalizePhone', () => {
  it.each([
    ['+61400123456', '400123456'],
    ['0400123456', '400123456'],
    ['0400 123 456', '400123456'],
    ['(04) 0012-3456', '400123456'],
    ['61400123456', '400123456'],
    ['400123456', '400123456'],
    ['+61 400 123 456', '400123456'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected)
  })

  it('handles junk without throwing', () => {
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone(null)).toBe('')
    expect(normalizePhone('n/a')).toBe('')
  })
})

describe('phonesMatch', () => {
  it('matches E.164 against as-entered forms', () => {
    expect(phonesMatch('+61400123456', '0400 123 456')).toBe(true)
    expect(phonesMatch('+61400123456', '0400123457')).toBe(false)
  })

  it('refuses short/junk numbers even when equal', () => {
    expect(phonesMatch('123', '123')).toBe(false)
    expect(phonesMatch('', '')).toBe(false)
  })
})

describe('findLinkCandidates', () => {
  const player = (id, over = {}) => ({
    id, phone: '0400123456', isMerged: false, archivedAt: null, authUid: null, ...over,
  })

  it('links a single clean match', () => {
    const r = findLinkCandidates('+61400123456', [player('p1'), player('p2', { phone: '0400999999' })])
    expect(r).toMatchObject({ linkable: true, reason: null })
    expect(r.candidates.map((c) => c.id)).toEqual(['p1'])
  })

  it('noMatch when nothing matches', () => {
    expect(findLinkCandidates('+61400123456', [player('p1', { phone: '0400999999' })]))
      .toMatchObject({ linkable: false, reason: 'noMatch' })
  })

  it('multipleMatches when duplicates share the number', () => {
    const r = findLinkCandidates('+61400123456', [player('p1'), player('p2')])
    expect(r).toMatchObject({ linkable: false, reason: 'multipleMatches' })
    expect(r.candidates).toHaveLength(2)
  })

  it('matchedPlayerAlreadyLinked when the one match is taken', () => {
    expect(findLinkCandidates('+61400123456', [player('p1', { authUid: 'other-uid' })]))
      .toMatchObject({ linkable: false, reason: 'matchedPlayerAlreadyLinked' })
  })

  it('self-heal: linkable again when the match is linked to the SAME uid (claim-write retry)', () => {
    expect(findLinkCandidates('+61400123456', [player('p1', { authUid: 'my-uid' })], 'my-uid'))
      .toMatchObject({ linkable: true, reason: null })
  })

  it('ignores merged and archived players', () => {
    const r = findLinkCandidates('+61400123456', [
      player('p1', { isMerged: true }),
      player('p2', { archivedAt: { toMillis: () => 1 } }),
    ])
    expect(r).toMatchObject({ linkable: false, reason: 'noMatch' })
  })
})
