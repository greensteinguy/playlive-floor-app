import { describe, it, expect } from 'vitest'
import {
  DISPLAY_SCREENS,
  SCREEN_DURATION_MS,
  isDisplayableTournament,
  displayableTournaments,
  pickDisplaySession,
  buildSlides,
  slideDurationMs,
  nextSlideIndex,
  displayCounters,
  msUntilStart,
  formatUntilStart,
  formatDisplayMoney,
} from './display'

// Fixed "now": 2026-08-10 14:00 local.
const NOW = new Date(2026, 7, 10, 14, 0, 0).getTime()
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime()

const tourney = (over = {}) => ({
  id: over.id ?? 't1',
  status: 'lateRegOpen',
  scheduledStartTime: at(2026, 7, 10, 19, 0),
  entryCount: 0,
  uniquePlayerCount: 0,
  remainingPlayerCount: 0,
  startingStack: 20000,
  ...over,
})

describe('isDisplayableTournament', () => {
  it('always shows lateRegOpen and lateRegClosed', () => {
    expect(isDisplayableTournament(tourney({ status: 'lateRegOpen' }), NOW)).toBe(true)
    expect(isDisplayableTournament(tourney({ status: 'lateRegClosed' }), NOW)).toBe(true)
  })

  it('never shows draft, finished, or cancelled', () => {
    for (const status of ['draft', 'finished', 'cancelled']) {
      expect(isDisplayableTournament(tourney({ status }), NOW)).toBe(false)
    }
  })

  it('shows scheduled only on its start day or once its start time has passed', () => {
    // tonight (same local day, still ahead)
    expect(
      isDisplayableTournament(tourney({ status: 'scheduled', scheduledStartTime: at(2026, 7, 10, 19, 0) }), NOW),
    ).toBe(true)
    // tomorrow — not yet
    expect(
      isDisplayableTournament(tourney({ status: 'scheduled', scheduledStartTime: at(2026, 7, 11, 19, 0) }), NOW),
    ).toBe(false)
    // yesterday evening, never opened (start passed) — still shown
    expect(
      isDisplayableTournament(tourney({ status: 'scheduled', scheduledStartTime: at(2026, 7, 9, 19, 0) }), NOW),
    ).toBe(true)
    // no start time at all
    expect(isDisplayableTournament(tourney({ status: 'scheduled', scheduledStartTime: null }), NOW)).toBe(false)
  })

  it('accepts Timestamp-like objects with toMillis', () => {
    const ts = { toMillis: () => at(2026, 7, 10, 19, 0) }
    expect(isDisplayableTournament(tourney({ status: 'scheduled', scheduledStartTime: ts }), NOW)).toBe(true)
  })
})

describe('displayableTournaments', () => {
  it('filters and orders soonest-start-first', () => {
    const list = [
      tourney({ id: 'late', scheduledStartTime: at(2026, 7, 10, 21, 0) }),
      tourney({ id: 'gone', status: 'finished' }),
      tourney({ id: 'early', scheduledStartTime: at(2026, 7, 10, 18, 0) }),
      tourney({ id: 'tomorrow', status: 'scheduled', scheduledStartTime: at(2026, 7, 11, 19, 0) }),
    ]
    expect(displayableTournaments(list, NOW).map((t) => t.id)).toEqual(['early', 'late'])
  })

  it('handles null/empty', () => {
    expect(displayableTournaments(null, NOW)).toEqual([])
    expect(displayableTournaments([], NOW)).toEqual([])
  })
})

describe('pickDisplaySession', () => {
  const sess = (over) => ({
    id: over.id,
    status: 'scheduled',
    dayNumber: 1,
    flightLabel: null,
    ...over,
  })

  it('prefers the session in progress', () => {
    const picked = pickDisplaySession([
      sess({ id: 'd2', dayNumber: 2, status: 'inProgress' }),
      sess({ id: 'd1', dayNumber: 1, status: 'finished' }),
    ])
    expect(picked.id).toBe('d2')
  })

  it('falls back to the earliest scheduled session', () => {
    const picked = pickDisplaySession([
      sess({ id: 'd2b', dayNumber: 2, flightLabel: 'B' }),
      sess({ id: 'd2a', dayNumber: 2, flightLabel: 'A' }),
      sess({ id: 'd1', dayNumber: 1, status: 'finished' }),
    ])
    expect(picked.id).toBe('d2a')
  })

  it('falls back to the last finished session when everything is done', () => {
    const picked = pickDisplaySession([
      sess({ id: 'd1', dayNumber: 1, status: 'finished' }),
      sess({ id: 'd2', dayNumber: 2, status: 'finished' }),
    ])
    expect(picked.id).toBe('d2')
  })

  it('ignores cancelled sessions and handles empties', () => {
    expect(pickDisplaySession([sess({ id: 'x', status: 'cancelled' })])).toBeNull()
    expect(pickDisplaySession([])).toBeNull()
    expect(pickDisplaySession(null)).toBeNull()
  })
})

describe('buildSlides', () => {
  const two = [tourney({ id: 'a' }), tourney({ id: 'b' })]

  it('crosses tournaments with screens in order', () => {
    expect(buildSlides(two)).toEqual([
      { tournamentId: 'a', screen: 'clock' },
      { tournamentId: 'a', screen: 'prizes' },
      { tournamentId: 'b', screen: 'clock' },
      { tournamentId: 'b', screen: 'prizes' },
    ])
  })

  it('pins to a tournament', () => {
    expect(buildSlides(two, { tournamentId: 'b' }).every((s) => s.tournamentId === 'b')).toBe(true)
    expect(buildSlides(two, { tournamentId: 'nope' })).toEqual([])
  })

  it('pins to a screen', () => {
    expect(buildSlides(two, { screen: 'clock' })).toEqual([
      { tournamentId: 'a', screen: 'clock' },
      { tournamentId: 'b', screen: 'clock' },
    ])
    // unknown screen name → empty (the page falls back to the full deck)
    expect(buildSlides(two, { screen: 'stats' })).toEqual([])
  })

  it('screens stay in sync with DISPLAY_SCREENS', () => {
    expect(DISPLAY_SCREENS).toEqual(['clock', 'prizes'])
    for (const s of DISPLAY_SCREENS) expect(SCREEN_DURATION_MS[s]).toBeGreaterThan(0)
  })
})

describe('rotation helpers', () => {
  it('slideDurationMs per screen with a clock fallback', () => {
    expect(slideDurationMs({ screen: 'clock' })).toBe(SCREEN_DURATION_MS.clock)
    expect(slideDurationMs({ screen: 'prizes' })).toBe(SCREEN_DURATION_MS.prizes)
    expect(slideDurationMs({ screen: 'mystery' })).toBe(SCREEN_DURATION_MS.clock)
  })

  it('nextSlideIndex wraps and survives empty decks', () => {
    expect(nextSlideIndex(0, 3)).toBe(1)
    expect(nextSlideIndex(2, 3)).toBe(0)
    expect(nextSlideIndex(5, 3)).toBe(0)
    expect(nextSlideIndex(0, 0)).toBe(-1)
    expect(nextSlideIndex(null, 3)).toBe(0)
  })
})

describe('displayCounters', () => {
  it('derives entries / remaining / re-entries / avg stack', () => {
    const c = displayCounters(
      tourney({ entryCount: 40, uniquePlayerCount: 34, remainingPlayerCount: 16, startingStack: 20000 }),
    )
    expect(c).toEqual({ entries: 40, remaining: 16, reentries: 6, avgStack: 50000 })
  })

  it('avg stack is null with nobody left', () => {
    expect(displayCounters(tourney({ entryCount: 10, remainingPlayerCount: 0 })).avgStack).toBeNull()
    expect(displayCounters(null).avgStack).toBeNull()
  })
})

describe('formatDisplayMoney', () => {
  it('drops .00 and separates thousands', () => {
    expect(formatDisplayMoney(1245000)).toBe('$12,450')
    expect(formatDisplayMoney(750)).toBe('$7.50')
    expect(formatDisplayMoney(0)).toBe('$0')
    expect(formatDisplayMoney(null)).toBe('$0')
  })
})

describe('pre-start countdown', () => {
  it('msUntilStart clamps at 0', () => {
    expect(msUntilStart(tourney({ scheduledStartTime: at(2026, 7, 10, 15, 0) }), NOW)).toBe(3_600_000)
    expect(msUntilStart(tourney({ scheduledStartTime: at(2026, 7, 10, 12, 0) }), NOW)).toBe(0)
    expect(msUntilStart(tourney({ scheduledStartTime: null }), NOW)).toBe(0)
  })

  it('formatUntilStart phrasing', () => {
    expect(formatUntilStart(80 * 60_000)).toBe('starts in 1h 20m')
    expect(formatUntilStart(120 * 60_000)).toBe('starts in 2h')
    expect(formatUntilStart(9 * 60_000)).toBe('starts in 9m')
    expect(formatUntilStart(0)).toBeNull()
  })
})
