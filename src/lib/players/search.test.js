import { describe, it, expect } from 'vitest'
import { searchPlayers, playerDisplayName } from './search'

// Minimal player shapes — searchPlayers only reads names / email / phone /
// isMerged, so we don't need full schema-valid docs here.
function p(overrides = {}) {
  return {
    id: 'p',
    firstName: 'Jane',
    lastName: 'Doe',
    displayName: null,
    phone: '0400 000 000',
    email: null,
    isMerged: false,
    ...overrides,
  }
}

const PEOPLE = [
  p({ id: 'jane', firstName: 'Jane', lastName: 'Doe', phone: '+61 412 345 678', email: 'jane@example.com' }),
  p({ id: 'john', firstName: 'John', lastName: 'Doe', phone: '0411 111 111' }),
  p({ id: 'janet', firstName: 'Janet', lastName: 'Smith', phone: '0422 222 222' }),
  p({ id: 'bob', firstName: 'Bob', lastName: 'Adams', phone: '0433 333 333', displayName: 'Bobby A' }),
]

describe('playerDisplayName', () => {
  it('uses displayName when set', () => {
    expect(playerDisplayName(p({ displayName: 'Ace' }))).toBe('Ace')
  })
  it('falls back to "First Last"', () => {
    expect(playerDisplayName(p({ firstName: 'Jane', lastName: 'Doe', displayName: null }))).toBe('Jane Doe')
  })
  it('trims a whitespace-only displayName back to the name', () => {
    expect(playerDisplayName(p({ displayName: '   ' }))).toBe('Jane Doe')
  })
})

describe('searchPlayers — empty query', () => {
  it('returns everyone sorted by last then first name', () => {
    const out = searchPlayers(PEOPLE, '')
    expect(out.map((x) => x.id)).toEqual(['bob', 'jane', 'john', 'janet'])
  })
  it('treats whitespace-only as empty', () => {
    expect(searchPlayers(PEOPLE, '   ')).toHaveLength(PEOPLE.length)
  })
  it('respects the limit', () => {
    expect(searchPlayers(PEOPLE, '', { limit: 2 })).toHaveLength(2)
  })
})

describe('searchPlayers — name matching', () => {
  it('matches a case-insensitive name token', () => {
    const out = searchPlayers(PEOPLE, 'doe')
    expect(out.map((x) => x.id).sort()).toEqual(['jane', 'john'])
  })

  it('matches across first + last with two tokens', () => {
    const out = searchPlayers(PEOPLE, 'jane doe')
    expect(out.map((x) => x.id)).toEqual(['jane'])
  })

  it('matches a displayName', () => {
    expect(searchPlayers(PEOPLE, 'bobby').map((x) => x.id)).toEqual(['bob'])
  })

  it('returns nothing when a token matches no one', () => {
    expect(searchPlayers(PEOPLE, 'zzz')).toEqual([])
  })

  it('requires every token to match (AND semantics)', () => {
    // "jane" matches jane+janet by first name, but "doe" only jane.
    expect(searchPlayers(PEOPLE, 'jane doe').map((x) => x.id)).toEqual(['jane'])
  })

  it('ranks a prefix hit above a mid-string hit', () => {
    const people = [
      p({ id: 'mid', firstName: 'AJane', lastName: 'X', phone: '0400 000 001' }),
      p({ id: 'prefix', firstName: 'Jane', lastName: 'Y', phone: '0400 000 002' }),
    ]
    expect(searchPlayers(people, 'jane').map((x) => x.id)).toEqual(['prefix', 'mid'])
  })
})

describe('searchPlayers — phone matching', () => {
  it('matches by digit substring ignoring formatting', () => {
    // jane's phone is "+61 412 345 678" → digits include "412".
    expect(searchPlayers(PEOPLE, '412').map((x) => x.id)).toEqual(['jane'])
  })

  it('matches a full local-format number against a +61 stored number', () => {
    expect(searchPlayers(PEOPLE, '0412345678').map((x) => x.id)).toEqual(['jane'])
  })

  it('matches an email substring', () => {
    expect(searchPlayers(PEOPLE, 'example.com').map((x) => x.id)).toEqual(['jane'])
  })
})

describe('searchPlayers — merged records', () => {
  it('excludes merged source players from results', () => {
    const people = [
      p({ id: 'live', firstName: 'Jane', lastName: 'Doe', isMerged: false }),
      p({ id: 'dead', firstName: 'Jane', lastName: 'Doe', isMerged: true }),
    ]
    expect(searchPlayers(people, 'jane').map((x) => x.id)).toEqual(['live'])
    expect(searchPlayers(people, '').map((x) => x.id)).toEqual(['live'])
  })
})
