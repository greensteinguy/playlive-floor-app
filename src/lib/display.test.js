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
  levelTrackSegment,
  msUntilLateRegClose,
  msUntilNextBreak,
  formatCloseIn,
  structureSummary,
  tickerItems,
  ordinalPlace,
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
  totalPrizePool: 500000,
  ...over,
})

// Structure shorthand: 3 levels, break, 2 levels, break, 1 level.
const L = (n, dur = 20) => ({
  type: 'level',
  blindNumber: n,
  smallBlind: n * 100,
  bigBlind: n * 200,
  ante: 0,
  bringIn: 0,
  durationMinutes: dur,
})
const B = (dur = 10, over = {}) => ({ type: 'break', durationMinutes: dur, label: null, isColorUp: false, ...over })
const STRUCT = [L(1), L(2), L(3), B(), L(4), L(5), B(), L(6)]

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

  it('drops the prizes slide while the pool is $0, unless the screen is pinned', () => {
    const early = [tourney({ id: 'a', totalPrizePool: 0 }), tourney({ id: 'b' })]
    expect(buildSlides(early)).toEqual([
      { tournamentId: 'a', screen: 'clock' },
      { tournamentId: 'b', screen: 'clock' },
      { tournamentId: 'b', screen: 'prizes' },
    ])
    // a dedicated prizes TV keeps its slide even at $0
    expect(buildSlides(early, { screen: 'prizes' })).toEqual([
      { tournamentId: 'a', screen: 'prizes' },
      { tournamentId: 'b', screen: 'prizes' },
    ])
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
  it('derives entries / remaining / re-entries / avg stack / total chips', () => {
    const c = displayCounters(
      tourney({ entryCount: 40, uniquePlayerCount: 34, remainingPlayerCount: 16, startingStack: 20000 }),
    )
    expect(c).toEqual({ entries: 40, remaining: 16, reentries: 6, avgStack: 50000, totalChips: 800000 })
  })

  it('avg stack is null with nobody left; total chips null with no entries', () => {
    expect(displayCounters(tourney({ entryCount: 10, remainingPlayerCount: 0 })).avgStack).toBeNull()
    expect(displayCounters(tourney({ entryCount: 0 })).totalChips).toBeNull()
    expect(displayCounters(null).avgStack).toBeNull()
  })
})

describe('levelTrackSegment', () => {
  it('bounds the current run of levels by breaks', () => {
    const seg = levelTrackSegment(STRUCT, 1, STRUCT.length - 1)
    expect(seg.blocks).toEqual([
      { index: 0, state: 'done' },
      { index: 1, state: 'current' },
      { index: 2, state: 'upcoming' },
    ])
    expect(seg.endsInBreak).toBe(true)
  })

  it('looks ahead to the next segment during a break (no current block)', () => {
    const seg = levelTrackSegment(STRUCT, 3, STRUCT.length - 1)
    expect(seg.blocks).toEqual([
      { index: 4, state: 'upcoming' },
      { index: 5, state: 'upcoming' },
    ])
    expect(seg.endsInBreak).toBe(true)
  })

  it('flags a segment that runs to the slice end instead of a break', () => {
    expect(levelTrackSegment(STRUCT, 4, 5).endsInBreak).toBe(false)
  })

  it('hides trivial or impossible tracks', () => {
    // final segment is a single level — one block reads as noise
    expect(levelTrackSegment(STRUCT, 7, STRUCT.length - 1)).toBeNull()
    expect(levelTrackSegment(STRUCT, null, STRUCT.length - 1)).toBeNull()
    expect(levelTrackSegment(STRUCT, 99, STRUCT.length - 1)).toBeNull()
    expect(levelTrackSegment([], 0, 0)).toBeNull()
  })
})

describe('msUntilLateRegClose', () => {
  it('sums the current remainder plus everything through the cutoff level (breaks included)', () => {
    // in level 1 with 30s left; cutoff is level 4 → 30s + L2 + L3 + break + L4
    expect(msUntilLateRegClose(STRUCT, 0, 30_000, 4)).toBe(30_000 + (20 + 20 + 10 + 20) * 60_000)
  })

  it('is just the remainder inside the cutoff level itself', () => {
    expect(msUntilLateRegClose(STRUCT, 4, 120_000, 4)).toBe(120_000)
  })

  it('returns 0 once the clock is past the cutoff', () => {
    expect(msUntilLateRegClose(STRUCT, 5, 120_000, 4)).toBe(0)
  })

  it('returns null when it cannot be computed', () => {
    expect(msUntilLateRegClose(STRUCT, 0, 30_000, null)).toBeNull()
    expect(msUntilLateRegClose(STRUCT, 0, 30_000, 99)).toBeNull()
    expect(msUntilLateRegClose(STRUCT, null, 30_000, 4)).toBeNull()
  })
})

describe('msUntilNextBreak', () => {
  it('sums the current remainder plus full levels until the break', () => {
    // level 1 with 30s left → 30s + L2 + L3, then the index-3 break
    expect(msUntilNextBreak(STRUCT, 0, 30_000, STRUCT.length - 1)).toBe(30_000 + (20 + 20) * 60_000)
  })

  it('is just the remainder when the break is next', () => {
    expect(msUntilNextBreak(STRUCT, 2, 45_000, STRUCT.length - 1)).toBe(45_000)
  })

  it('returns null on a break, past the last break, or outside the slice', () => {
    expect(msUntilNextBreak(STRUCT, 3, 30_000, STRUCT.length - 1)).toBeNull()
    expect(msUntilNextBreak(STRUCT, 7, 30_000, STRUCT.length - 1)).toBeNull()
    // slice capped before the break → the break never comes
    expect(msUntilNextBreak(STRUCT, 0, 30_000, 2)).toBeNull()
    expect(msUntilNextBreak(STRUCT, null, 30_000, 7)).toBeNull()
  })
})

describe('formatCloseIn', () => {
  it('formats M:SS and H:MM:SS, ceiling to a second', () => {
    expect(formatCloseIn(42 * 60_000 + 10_000)).toBe('42:10')
    expect(formatCloseIn(3_723_000)).toBe('1:02:03')
    expect(formatCloseIn(500)).toBe('0:01')
    expect(formatCloseIn(0)).toBeNull()
  })
})

describe('structureSummary', () => {
  it('reads stack and first-level duration', () => {
    expect(structureSummary(tourney({ structure: STRUCT }))).toBe('20,000 chips · 20-min levels')
    expect(structureSummary(tourney({ structure: [] }))).toBe('20,000 chips')
    expect(structureSummary({ startingStack: 0, structure: [] })).toBeNull()
  })
})

describe('tickerItems', () => {
  it('lists pool, guarantee, places, and payouts in reading order', () => {
    const t = tourney({ totalPrizePool: 500000, guarantee: 1000000, status: 'lateRegClosed' })
    const items = tickerItems(t, [
      { place: 1, amount: 300000 },
      { place: 2, amount: 200000 },
    ])
    expect(items).toEqual([
      'Prize pool $5,000',
      '$10,000 guaranteed',
      'Paying 2 places',
      '1st $3,000',
      '2nd $2,000',
    ])
  })

  it('adds a late-reg item while reg is open', () => {
    const t = tourney({ totalPrizePool: 0, guarantee: 0, buyIn: 15000, structure: STRUCT })
    expect(tickerItems(t, [])).toEqual(['Late reg open — $150 buy-in — 20,000 chips · 20-min levels'])
  })

  it('is empty when there is nothing to say', () => {
    expect(tickerItems(tourney({ totalPrizePool: 0, guarantee: 0, status: 'lateRegClosed' }), [])).toEqual([])
    expect(tickerItems(null, [])).toEqual([])
  })

  it('uses band labels and counts places through the last toPlace (stored payout table)', () => {
    const t = tourney({ totalPrizePool: 720000, guarantee: 0, status: 'lateRegClosed' })
    const items = tickerItems(t, [
      { place: 1, toPlace: 1, label: '1st', amount: 215000 },
      { place: 10, toPlace: 12, label: '10 – 12', amount: 26000 },
    ])
    expect(items).toEqual(['Prize pool $7,200', 'Paying 12 places', '1st $2,150', '10 – 12 $260'])
  })
})

describe('ordinalPlace', () => {
  it('handles the English suffix edge cases', () => {
    expect(ordinalPlace(1)).toBe('1st')
    expect(ordinalPlace(2)).toBe('2nd')
    expect(ordinalPlace(3)).toBe('3rd')
    expect(ordinalPlace(4)).toBe('4th')
    expect(ordinalPlace(11)).toBe('11th')
    expect(ordinalPlace(12)).toBe('12th')
    expect(ordinalPlace(13)).toBe('13th')
    expect(ordinalPlace(21)).toBe('21st')
    expect(ordinalPlace(103)).toBe('103rd')
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
