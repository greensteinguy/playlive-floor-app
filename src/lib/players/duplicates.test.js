import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { normalizePhone, findDuplicateCandidates } from './duplicates'

describe('normalizePhone', () => {
  it('collapses Australian-formatted variants of the same number', () => {
    expect(normalizePhone('+61 4 1234 5678')).toBe('412345678')
    expect(normalizePhone('0412345678')).toBe('412345678')
    expect(normalizePhone('412345678')).toBe('412345678')
    expect(normalizePhone('(04) 1234-5678')).toBe('412345678')
  })

  it('returns null for null / undefined / non-string input', () => {
    expect(normalizePhone(null)).toBe(null)
    expect(normalizePhone(undefined)).toBe(null)
    expect(normalizePhone(412345678)).toBe(null)
  })

  it('returns null for too-short inputs', () => {
    expect(normalizePhone('123')).toBe(null)
    expect(normalizePhone('')).toBe(null)
  })

  it('strips non-digit characters', () => {
    expect(normalizePhone('413-555-0199')).toBe('4135550199')
  })
})

describe('findDuplicateCandidates', () => {
  const ts = (n) => Timestamp.fromMillis(1_700_000_000_000 + n)
  function p(id, phone, overrides = {}) {
    return {
      id,
      phone,
      firstName: 'X',
      lastName: 'Y',
      isMerged: false,
      mergedIntoId: null,
      mergedAt: null,
      createdAt: ts(0),
      ...overrides,
    }
  }

  it('groups players that share a normalized phone', () => {
    const groups = findDuplicateCandidates([
      p('a', '+61 4 1234 5678', { createdAt: ts(1000) }),
      p('b', '0412345678',      { createdAt: ts(2000) }),
      p('c', '0411111111'),
      p('d', '412345678',       { createdAt: ts(3000) }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('412345678')
    expect(groups[0].members.map((m) => m.id)).toEqual(['a', 'b', 'd'])
  })

  it('orders each group by createdAt ASC so oldest record is the natural "keep" candidate', () => {
    const groups = findDuplicateCandidates([
      p('newest', '0411111111', { createdAt: ts(3000) }),
      p('oldest', '0411111111', { createdAt: ts(1000) }),
      p('middle', '0411111111', { createdAt: ts(2000) }),
    ])
    expect(groups[0].members.map((m) => m.id)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('skips singletons (no duplicates)', () => {
    const groups = findDuplicateCandidates([
      p('a', '0411111111'),
      p('b', '0412222222'),
      p('c', '0413333333'),
    ])
    expect(groups).toEqual([])
  })

  it('skips already-merged players', () => {
    const groups = findDuplicateCandidates([
      p('a', '0411111111'),
      p('b', '0411111111', { isMerged: true, mergedIntoId: 'a', mergedAt: ts(0) }),
    ])
    expect(groups).toEqual([])
  })

  it('skips players whose phone normalizes to null', () => {
    const groups = findDuplicateCandidates([
      p('a', '123'),
      p('b', null),
      p('c', '0411111111'),
      p('d', '0411111111'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(['c', 'd'])
  })

  it('orders groups by member count descending (biggest collisions first)', () => {
    const groups = findDuplicateCandidates([
      p('a1', '0411111111'),
      p('a2', '0411111111'),
      p('a3', '0411111111'),
      p('b1', '0422222222'),
      p('b2', '0422222222'),
    ])
    expect(groups.map((g) => g.members.length)).toEqual([3, 2])
  })
})
