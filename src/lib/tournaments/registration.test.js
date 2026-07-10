import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the data + wallet layers so the orchestrator tests don't hit Firestore.
// The pure helpers below don't use either, so they run against the real code.
vi.mock('../firestore', () => ({
  entries: { listEntries: vi.fn() },
  runValidatedTransaction: vi.fn(),
  paths: {
    tournamentPath: (id) => ['tournaments', id],
    entryPath: (tid, eid) => ['tournaments', tid, 'entries', eid],
  },
}))
vi.mock('../wallet', () => ({
  payViaExternalMethod: vi.fn(),
  payViaWallet: vi.fn(),
  payViaTicket: vi.fn(),
}))

import { entries as entriesApi, runValidatedTransaction } from '../firestore'
import { payViaExternalMethod, payViaWallet, payViaTicket } from '../wallet'
import {
  totalEntryCost,
  registrationOpen,
  registrableSessions,
  planEntry,
  computeEntryCounters,
  recountTournamentEntries,
  registerEntry,
} from './registration'
import { TournamentError } from './errors'

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('totalEntryCost', () => {
  it('sums buy-in and hospitality', () => {
    expect(totalEntryCost({ buyIn: 100_00, hospitalityCost: 15_00 })).toBe(115_00)
  })
  it('treats missing hospitality as 0', () => {
    expect(totalEntryCost({ buyIn: 50_00 })).toBe(50_00)
  })
})

describe('registrationOpen', () => {
  it('is open for scheduled and lateRegOpen', () => {
    expect(registrationOpen({ status: 'scheduled' })).toBe(true)
    expect(registrationOpen({ status: 'lateRegOpen' })).toBe(true)
  })
  it('is closed otherwise', () => {
    for (const status of ['draft', 'lateRegClosed', 'finished', 'cancelled']) {
      expect(registrationOpen({ status })).toBe(false)
    }
  })
})

describe('registrableSessions', () => {
  it('returns the single session for a single-day tournament', () => {
    const sessions = [{ id: 's1', convergesIntoSessionId: null, dayNumber: 1, sessionLabel: 'Day 1', status: 'scheduled' }]
    expect(registrableSessions(sessions).map((s) => s.id)).toEqual(['s1'])
  })

  it('returns only the entry-point (Day 1) flights of a multi-flight tournament', () => {
    const sessions = [
      { id: 'd1a', convergesIntoSessionId: 'd2', dayNumber: 1, sessionLabel: 'Day 1A', status: 'scheduled' },
      { id: 'd1b', convergesIntoSessionId: 'd2', dayNumber: 1, sessionLabel: 'Day 1B', status: 'scheduled' },
      { id: 'd2', convergesIntoSessionId: null, dayNumber: 2, sessionLabel: 'Day 2', status: 'scheduled' },
    ]
    expect(registrableSessions(sessions).map((s) => s.id)).toEqual(['d1a', 'd1b'])
  })

  it('excludes cancelled sessions', () => {
    const sessions = [
      { id: 'd1a', convergesIntoSessionId: 'd2', dayNumber: 1, sessionLabel: 'Day 1A', status: 'cancelled' },
      { id: 'd1b', convergesIntoSessionId: 'd2', dayNumber: 1, sessionLabel: 'Day 1B', status: 'scheduled' },
      { id: 'd2', convergesIntoSessionId: null, dayNumber: 2, sessionLabel: 'Day 2', status: 'scheduled' },
    ]
    expect(registrableSessions(sessions).map((s) => s.id)).toEqual(['d1b'])
  })
})

describe('planEntry', () => {
  const freezeout = { type: 'freezeout', maxReentries: null, maxRebuys: null }
  const reentry = { type: 'reentry', maxReentries: null, maxRebuys: null }
  const rebuy = { type: 'rebuy', maxReentries: null, maxRebuys: 2 }

  it('plans an initial entry when the player has none', () => {
    expect(planEntry({ playerEntries: [], reentryConfig: freezeout })).toEqual({
      entryType: 'initial',
      entryNumber: 1,
      blockedReason: null,
    })
  })

  it('blocks a player who already has an alive entry', () => {
    const r = planEntry({ playerEntries: [{ entryType: 'initial', bustedAt: null, voidedAt: null }], reentryConfig: reentry })
    expect(r.entryType).toBeNull()
    expect(r.blockedReason).toMatch(/already has an active entry/)
  })

  it('blocks re-entry in a freezeout once busted', () => {
    const r = planEntry({ playerEntries: [{ entryType: 'initial', bustedAt: {}, voidedAt: null }], reentryConfig: freezeout })
    expect(r.blockedReason).toMatch(/freezeout/i)
  })

  it('plans a re-entry after busting when re-entry is allowed', () => {
    const r = planEntry({ playerEntries: [{ entryType: 'initial', bustedAt: {}, voidedAt: null }], reentryConfig: reentry })
    expect(r).toEqual({ entryType: 'reentry', entryNumber: 2, blockedReason: null })
  })

  it('uses entryType "rebuy" for a rebuy tournament', () => {
    const r = planEntry({ playerEntries: [{ entryType: 'initial', bustedAt: {}, voidedAt: null }], reentryConfig: rebuy })
    expect(r).toMatchObject({ entryType: 'rebuy', entryNumber: 2 })
  })

  it('enforces the re-entry limit', () => {
    const busted = (t) => ({ entryType: t, bustedAt: {}, voidedAt: null })
    const r = planEntry({
      playerEntries: [busted('initial'), busted('rebuy'), busted('rebuy')], // 2 prior rebuys, max 2
      reentryConfig: rebuy,
    })
    expect(r.blockedReason).toMatch(/limit reached/i)
  })

  it('ignores voided entries (a voided initial leaves the player as fresh)', () => {
    const r = planEntry({ playerEntries: [{ entryType: 'initial', bustedAt: null, voidedAt: {} }], reentryConfig: freezeout })
    expect(r).toEqual({ entryType: 'initial', entryNumber: 1, blockedReason: null })
  })
})

describe('computeEntryCounters', () => {
  it('counts entries, unique players, remaining, and the prize pool', () => {
    const entries = [
      { playerId: 'a', bustedAt: null, voidedAt: null },
      { playerId: 'b', bustedAt: {}, voidedAt: null }, // busted
      { playerId: 'a', bustedAt: null, voidedAt: null }, // a re-entered (alive)
      { playerId: 'c', bustedAt: null, voidedAt: {} }, // voided — ignored
    ]
    expect(computeEntryCounters(entries, 100_00)).toEqual({
      entryCount: 3, // excludes the voided one
      uniquePlayerCount: 2, // a, b
      remainingPlayerCount: 2, // two non-busted (a×2... but counts entries, not players)
      totalPrizePool: 3 * 100_00,
    })
  })

  it('is all-zero for an empty tournament', () => {
    expect(computeEntryCounters([], 100_00)).toEqual({
      entryCount: 0,
      uniquePlayerCount: 0,
      remainingPlayerCount: 0,
      totalPrizePool: 0,
    })
  })
})

// ── Operations ──────────────────────────────────────────────────────────────

function makeTournament(overrides = {}) {
  return {
    id: 'tour-1',
    status: 'lateRegOpen',
    buyIn: 100_00,
    hospitalityCost: 0,
    reentryConfig: { type: 'freezeout', maxReentries: null, maxRebuys: null },
    ...overrides,
  }
}

let txGetDoc
beforeEach(() => {
  vi.clearAllMocks()
  txGetDoc = { id: 'tour-1', buyIn: 100_00 }
  runValidatedTransaction.mockImplementation(async (fn) =>
    fn({ get: vi.fn(async () => txGetDoc), set: vi.fn() })
  )
  entriesApi.listEntries.mockResolvedValue([])
  payViaExternalMethod.mockResolvedValue({ entryId: 'e-ext', walletTransactionId: 'wt-ext' })
  payViaWallet.mockResolvedValue({ entryId: 'e-wal', walletTransactionId: 'wt-wal' })
  payViaTicket.mockResolvedValue({ entryId: 'e-tic', ticketUseTransactionId: 'tu', topUpTransactionId: null })
})

const baseArgs = {
  tournament: makeTournament(),
  originSessionId: 'sess-1',
  player: { id: 'player-1' },
  playerEntries: [],
  actorId: 'cashier-1',
  actorRole: 'cashier',
}

describe('registerEntry — payment routing', () => {
  it('routes cash to payViaExternalMethod with the assembled entryData', async () => {
    const res = await registerEntry({ ...baseArgs, paymentMethod: 'cash', reference: 'till' })
    expect(payViaExternalMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        totalCost: 100_00,
        method: 'cash',
        reference: 'till',
        actorId: 'cashier-1',
        actorRole: 'cashier',
        entryData: expect.objectContaining({
          tournamentId: 'tour-1',
          playerId: 'player-1',
          originSessionId: 'sess-1',
          entryType: 'initial',
          entryNumber: 1,
          registeredBy: 'cashier-1',
        }),
      })
    )
    expect(res).toMatchObject({ entryId: 'e-ext', entryType: 'initial', entryNumber: 1, totalCost: 100_00 })
    expect(payViaWallet).not.toHaveBeenCalled()
    expect(payViaTicket).not.toHaveBeenCalled()
  })

  it('routes wallet to payViaWallet', async () => {
    await registerEntry({ ...baseArgs, paymentMethod: 'wallet' })
    expect(payViaWallet).toHaveBeenCalledWith(
      expect.objectContaining({ totalCost: 100_00, entryData: expect.objectContaining({ playerId: 'player-1' }) })
    )
  })

  it('routes ticket to payViaTicket with the ticket + top-up + override', async () => {
    await registerEntry({
      ...baseArgs,
      paymentMethod: 'ticket',
      ticketId: 'tk-1',
      topUp: { method: 'cash', reference: null },
      managerOverride: { reason: 'regular' },
    })
    expect(payViaTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'tk-1',
        topUp: { method: 'cash', reference: null },
        managerOverride: { reason: 'regular' },
        totalCost: 100_00,
      })
    )
  })

  it('recomputes the tournament counters after a successful payment', async () => {
    await registerEntry({ ...baseArgs, paymentMethod: 'cash' })
    expect(entriesApi.listEntries).toHaveBeenCalledWith('tour-1')
    expect(runValidatedTransaction).toHaveBeenCalled()
  })

  it('a recount failure does not undo the registration', async () => {
    entriesApi.listEntries.mockRejectedValueOnce(new Error('network blip'))
    const res = await registerEntry({ ...baseArgs, paymentMethod: 'cash' })
    expect(res.entryId).toBe('e-ext')
    expect(res.counters).toBeNull()
  })
})

describe('registerEntry — last-longer deck capture', () => {
  const llTournament = makeTournament({ hasUpperDeckMainDeck: true })
  const freshEntry = {
    id: 'e-ext',
    lastLongerDeck: null,
    isLastLongerWinner: false,
    voidedAt: null,
    updatedAt: {},
  }

  it('applies the deck pick to the fresh entry after the payment write', async () => {
    const sets = []
    runValidatedTransaction.mockImplementation(async (fn) =>
      fn({
        get: vi.fn(async (path) => (path[2] === 'entries' ? freshEntry : txGetDoc)),
        set: vi.fn((path, _schema, data) => sets.push({ path, data })),
      })
    )
    const res = await registerEntry({
      ...baseArgs,
      tournament: llTournament,
      paymentMethod: 'cash',
      lastLongerDeck: 'upper',
    })
    const entrySet = sets.find((s) => s.path[2] === 'entries')
    expect(entrySet.path).toEqual(['tournaments', 'tour-1', 'entries', 'e-ext'])
    expect(entrySet.data).toMatchObject({ lastLongerDeck: 'upper', isLastLongerWinner: false })
    expect(res).toMatchObject({ lastLongerDeck: 'upper', lastLongerDeckApplied: true })
  })

  it('defaults to no deck: no entry write, lastLongerDeckApplied null', async () => {
    const res = await registerEntry({ ...baseArgs, tournament: llTournament, paymentMethod: 'cash' })
    expect(res).toMatchObject({ lastLongerDeck: null, lastLongerDeckApplied: null })
  })

  it('rejects a deck pick when the tournament has no Upper/Main split (before any payment)', async () => {
    await expect(
      registerEntry({ ...baseArgs, paymentMethod: 'cash', lastLongerDeck: 'upper' })
    ).rejects.toThrow(TournamentError)
    expect(payViaExternalMethod).not.toHaveBeenCalled()
  })

  it('rejects an unknown deck value', async () => {
    await expect(
      registerEntry({ ...baseArgs, tournament: llTournament, paymentMethod: 'cash', lastLongerDeck: 'middle' })
    ).rejects.toThrow(TournamentError)
    expect(payViaExternalMethod).not.toHaveBeenCalled()
  })

  it('a failed deck write does not undo the registration — flagged for the caller to warn', async () => {
    // Every transaction fails: the deck application AND the recount — both are
    // best-effort after the committed payment write.
    runValidatedTransaction.mockImplementation(async () => {
      throw new Error('network blip')
    })
    const res = await registerEntry({
      ...baseArgs,
      tournament: llTournament,
      paymentMethod: 'cash',
      lastLongerDeck: 'main',
    })
    expect(res.entryId).toBe('e-ext')
    expect(res.lastLongerDeckApplied).toBe(false)
  })
})

describe('registerEntry — rejections (before any payment)', () => {
  it('rejects when registration is not open', async () => {
    await expect(
      registerEntry({ ...baseArgs, tournament: makeTournament({ status: 'lateRegClosed' }), paymentMethod: 'cash' })
    ).rejects.toThrow(TournamentError)
    expect(payViaExternalMethod).not.toHaveBeenCalled()
  })

  it('rejects a duplicate (player already alive in this tournament)', async () => {
    await expect(
      registerEntry({
        ...baseArgs,
        playerEntries: [{ entryType: 'initial', bustedAt: null, voidedAt: null }],
        paymentMethod: 'cash',
      })
    ).rejects.toThrow(TournamentError)
    expect(payViaExternalMethod).not.toHaveBeenCalled()
  })

  it('rejects a blank actorId', async () => {
    await expect(registerEntry({ ...baseArgs, actorId: '', paymentMethod: 'cash' })).rejects.toThrow(TournamentError)
  })

  it('rejects a missing originSessionId', async () => {
    await expect(registerEntry({ ...baseArgs, originSessionId: '', paymentMethod: 'cash' })).rejects.toThrow(TournamentError)
  })

  it('rejects the ticket method with no ticket selected', async () => {
    await expect(registerEntry({ ...baseArgs, paymentMethod: 'ticket' })).rejects.toThrow(TournamentError)
    expect(payViaTicket).not.toHaveBeenCalled()
  })

  it('rejects an unknown payment method', async () => {
    await expect(registerEntry({ ...baseArgs, paymentMethod: 'crypto' })).rejects.toThrow(TournamentError)
  })
})

describe('recountTournamentEntries', () => {
  it('reads the entries and writes the computed counters', async () => {
    entriesApi.listEntries.mockResolvedValueOnce([
      { playerId: 'a', bustedAt: null, voidedAt: null },
      { playerId: 'b', bustedAt: null, voidedAt: null },
    ])
    let setArg
    runValidatedTransaction.mockImplementationOnce(async (fn) =>
      fn({ get: vi.fn(async () => ({ id: 'tour-1', buyIn: 50_00 })), set: vi.fn((_p, _s, data) => { setArg = data }) })
    )
    const counters = await recountTournamentEntries({ tournamentId: 'tour-1' })
    expect(counters).toEqual({ entryCount: 2, uniquePlayerCount: 2, remainingPlayerCount: 2, totalPrizePool: 2 * 50_00 })
    expect(setArg).toMatchObject({ entryCount: 2, totalPrizePool: 100_00 })
  })

  it('rejects a blank tournamentId', async () => {
    await expect(recountTournamentEntries({ tournamentId: '' })).rejects.toThrow(TournamentError)
  })
})
