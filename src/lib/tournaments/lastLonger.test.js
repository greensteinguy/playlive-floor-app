import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { makeMockStore, entryPath } from '../wallet/_test-helpers'

vi.mock('../firestore', () => ({
  runValidatedTransaction: vi.fn(),
  auditLog: { writeAuditLogSafe: vi.fn().mockResolvedValue(undefined) },
  paths: {
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
  },
}))

import { runValidatedTransaction, auditLog } from '../firestore'
import {
  LAST_LONGER_DECKS,
  lastLongerDeckLabel,
  lastLongerParticipants,
  deriveLastLongerStatus,
  lastLongerReasonLabel,
  settleLastLonger,
  unsettleLastLonger,
  LastLongerError,
  LastLongerNotDeterminableError,
  LastLongerAlreadySettledError,
  LastLongerNotSettledError,
} from './lastLonger'
import { TournamentError } from './errors'

function makeEntry(overrides = {}) {
  return {
    id: 'e1',
    playerId: 'p1',
    lastLongerDeck: 'upper',
    isLastLongerWinner: false,
    bustedAt: null,
    finishingPlace: null,
    voidedAt: null,
    ...overrides,
  }
}
const busted = (id, place = null, overrides = {}) =>
  makeEntry({ id, playerId: `player-${id}`, bustedAt: Timestamp.now(), finishingPlace: place, ...overrides })
const alive = (id, overrides = {}) => makeEntry({ id, playerId: `player-${id}`, ...overrides })

const tournament = { id: 't1', name: 'Friday $80', hasUpperDeckMainDeck: true }

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('deck constants / labels', () => {
  it('names both decks', () => {
    expect(LAST_LONGER_DECKS).toEqual(['upper', 'main'])
    expect(lastLongerDeckLabel('upper')).toBe('Upper Deck')
    expect(lastLongerDeckLabel('main')).toBe('Main Deck')
  })
})

describe('lastLongerParticipants', () => {
  it('filters to the deck and excludes voided + non-opted entries', () => {
    const entries = [
      alive('a'),
      alive('b', { lastLongerDeck: 'main' }),
      alive('c', { lastLongerDeck: null }),
      alive('d', { voidedAt: Timestamp.now() }),
    ]
    expect(lastLongerParticipants(entries, 'upper').map((e) => e.id)).toEqual(['a'])
    expect(lastLongerParticipants(entries, 'main').map((e) => e.id)).toEqual(['b'])
  })
})

describe('deriveLastLongerStatus — the winner matrix', () => {
  it('no participants → not determinable (noParticipants)', () => {
    const s = deriveLastLongerStatus([alive('x', { lastLongerDeck: null })], 'upper')
    expect(s).toMatchObject({ derivedWinner: null, determinable: false, reason: 'noParticipants' })
  })

  it('exactly one alive → that entry wins (regardless of others being placeless)', () => {
    const s = deriveLastLongerStatus([alive('a'), busted('b'), busted('c', 12)], 'upper')
    expect(s.determinable).toBe(true)
    expect(s.derivedWinner.id).toBe('a')
    expect(s.reason).toBe('ok')
  })

  it('multiple alive → not determinable (multipleAlive)', () => {
    const s = deriveLastLongerStatus([alive('a'), alive('b')], 'upper')
    expect(s).toMatchObject({ derivedWinner: null, determinable: false, reason: 'multipleAlive' })
  })

  it('all busted with places → lowest finishingPlace wins', () => {
    const s = deriveLastLongerStatus([busted('a', 9), busted('b', 3), busted('c', 17)], 'upper')
    expect(s.determinable).toBe(true)
    expect(s.derivedWinner.id).toBe('b')
  })

  it('all busted but a place is missing → not determinable (missingPlaces)', () => {
    const s = deriveLastLongerStatus([busted('a', 9), busted('b')], 'upper')
    expect(s).toMatchObject({ derivedWinner: null, determinable: false, reason: 'missingPlaces' })
  })

  it('tie at the lowest place → not determinable (tiedPlaces)', () => {
    const s = deriveLastLongerStatus([busted('a', 5), busted('b', 5), busted('c', 8)], 'upper')
    expect(s).toMatchObject({ derivedWinner: null, determinable: false, reason: 'tiedPlaces' })
  })

  it('a single participant already busted with a place is the winner', () => {
    const s = deriveLastLongerStatus([busted('a', 42)], 'upper')
    expect(s.derivedWinner.id).toBe('a')
  })

  it('surfaces the settled winner and ignores the other deck', () => {
    const s = deriveLastLongerStatus(
      [busted('a', 2, { isLastLongerWinner: true }), busted('b', 7), alive('m', { lastLongerDeck: 'main' })],
      'upper'
    )
    expect(s.settledWinner.id).toBe('a')
    expect(s.participants.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('every undeterminable reason has panel copy', () => {
    for (const reason of ['noParticipants', 'multipleAlive', 'missingPlaces', 'tiedPlaces']) {
      expect(lastLongerReasonLabel(reason)).not.toBe('')
    }
  })
})

// ── Impure ops ───────────────────────────────────────────────────────────────

let mock
beforeEach(() => {
  vi.clearAllMocks()
  mock = makeMockStore()
  runValidatedTransaction.mockImplementation(async (fn) => fn(mock.tx))
})

function seedEntry(entry) {
  mock.seed(entryPath('t1', entry.id), entry)
}

describe('settleLastLonger', () => {
  it('settles the derived winner: full-doc set with the flag + audit', async () => {
    const entries = [alive('a'), busted('b', 8)]
    seedEntry(entries[0])
    const res = await settleLastLonger({ tournament, deck: 'upper', entries, actorId: 'td-1', actorRole: 'td' })
    expect(res).toEqual({ deck: 'upper', winnerEntryId: 'a', override: false })

    expect(mock.calls.set).toHaveLength(1)
    expect(mock.calls.set[0].path).toEqual(entryPath('t1', 'a'))
    expect(mock.calls.set[0].data).toMatchObject({ isLastLongerWinner: true })

    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'tournament.lastLongerSettled',
        targetType: 'tournament',
        targetId: 't1',
        actorId: 'td-1',
        actorRole: 'td',
        metadata: expect.objectContaining({
          deck: 'upper',
          winnerEntryId: 'a',
          winnerPlayerId: 'player-a',
          participantCount: 2,
          derivedWinnerEntryId: 'a',
          override: false,
        }),
      })
    )
  })

  it('refuses when the winner is not yet determinable (typed error, no writes)', async () => {
    const entries = [alive('a'), alive('b')]
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerNotDeterminableError)
    expect(mock.calls.set).toHaveLength(0)
    expect(auditLog.writeAuditLogSafe).not.toHaveBeenCalled()
  })

  it('manual override: settles the chosen participant and audits derived vs chosen', async () => {
    const entries = [alive('a'), busted('b', 8)]
    seedEntry(entries[1])
    const res = await settleLastLonger({
      tournament,
      deck: 'upper',
      entries,
      chosenEntryId: 'b',
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(res).toEqual({ deck: 'upper', winnerEntryId: 'b', override: true })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ derivedWinnerEntryId: 'a', winnerEntryId: 'b', override: true }),
      })
    )
  })

  it('manual pick works even when the deck is undeterminable (derived null in the audit)', async () => {
    const entries = [busted('a'), busted('b')] // all busted, no places
    seedEntry(entries[0])
    const res = await settleLastLonger({
      tournament,
      deck: 'upper',
      entries,
      chosenEntryId: 'a',
      actorId: 'mgr-1',
      actorRole: 'manager',
    })
    expect(res.override).toBe(true)
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ derivedWinnerEntryId: null }) })
    )
  })

  it('picking the derived winner explicitly is NOT an override', async () => {
    const entries = [alive('a'), busted('b', 8)]
    seedEntry(entries[0])
    const res = await settleLastLonger({
      tournament,
      deck: 'upper',
      entries,
      chosenEntryId: 'a',
      actorId: 'td-1',
      actorRole: 'td',
    })
    expect(res.override).toBe(false)
  })

  it('rejects a chosen winner who is not a deck participant', async () => {
    const entries = [alive('a'), alive('m', { lastLongerDeck: 'main' })]
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, chosenEntryId: 'm', actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerError)
    expect(mock.calls.set).toHaveLength(0)
  })

  it('refuses when the deck is already settled', async () => {
    const entries = [busted('a', 2, { isLastLongerWinner: true }), busted('b', 7)]
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerAlreadySettledError)
  })

  it('refuses when a concurrent settle flipped the flag (fresh in-tx re-check)', async () => {
    const entries = [alive('a')]
    seedEntry({ ...entries[0], isLastLongerWinner: true }) // store is fresher than the snapshot
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerAlreadySettledError)
    expect(mock.calls.set).toHaveLength(0)
  })

  it('refuses when the fresh entry was voided or moved deck since the snapshot', async () => {
    const entries = [alive('a')]
    seedEntry({ ...entries[0], voidedAt: Timestamp.now() })
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerError)

    seedEntry({ ...alive('a'), lastLongerDeck: 'main' })
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerError)
    expect(mock.calls.set).toHaveLength(0)
  })

  it('is gated to manager + TD and requires an actor + a real deck + the split', async () => {
    const entries = [alive('a')]
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, actorId: 'c-1', actorRole: 'cashier' })
    ).rejects.toThrow(LastLongerError)
    await expect(
      settleLastLonger({ tournament, deck: 'upper', entries, actorId: '', actorRole: 'td' })
    ).rejects.toThrow(LastLongerError)
    await expect(
      settleLastLonger({ tournament, deck: 'middle', entries, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerError)
    await expect(
      settleLastLonger({
        tournament: { ...tournament, hasUpperDeckMainDeck: false },
        deck: 'upper',
        entries,
        actorId: 'td-1',
        actorRole: 'td',
      })
    ).rejects.toThrow(LastLongerError)
  })

  it('LastLonger errors are TournamentErrors (one catch family for the pages)', () => {
    expect(new LastLongerNotDeterminableError('multipleAlive')).toBeInstanceOf(TournamentError)
    expect(new LastLongerAlreadySettledError()).toBeInstanceOf(TournamentError)
  })
})

describe('unsettleLastLonger', () => {
  it('clears the winner flag on the settled entry + audits the undo', async () => {
    const winner = busted('a', 2, { isLastLongerWinner: true })
    const entries = [winner, busted('b', 7)]
    seedEntry(winner)
    const res = await unsettleLastLonger({ tournament, deck: 'upper', entries, actorId: 'mgr-1', actorRole: 'manager' })
    expect(res).toEqual({ deck: 'upper', winnerEntryId: 'a' })
    expect(mock.calls.set[0].data).toMatchObject({ isLastLongerWinner: false })
    expect(auditLog.writeAuditLogSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'tournament.lastLongerUnsettled',
        metadata: expect.objectContaining({ deck: 'upper', winnerEntryId: 'a', winnerPlayerId: 'player-a' }),
      })
    )
  })

  it('refuses when the deck has no settled winner (snapshot or fresh)', async () => {
    const entries = [busted('a', 2), busted('b', 7)]
    await expect(
      unsettleLastLonger({ tournament, deck: 'upper', entries, actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerNotSettledError)

    // Snapshot says settled but a concurrent undo already cleared it.
    const stale = busted('a', 2, { isLastLongerWinner: true })
    seedEntry({ ...stale, isLastLongerWinner: false })
    await expect(
      unsettleLastLonger({ tournament, deck: 'upper', entries: [stale], actorId: 'td-1', actorRole: 'td' })
    ).rejects.toThrow(LastLongerNotSettledError)
    expect(mock.calls.set).toHaveLength(0)
  })

  it('is gated to manager + TD', async () => {
    const entries = [busted('a', 2, { isLastLongerWinner: true })]
    await expect(
      unsettleLastLonger({ tournament, deck: 'upper', entries, actorId: 'c-1', actorRole: 'cashier' })
    ).rejects.toThrow(LastLongerError)
  })
})
