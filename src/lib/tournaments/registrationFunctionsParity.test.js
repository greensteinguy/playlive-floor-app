// Parity gate: functions/core/registration.js is a deploy-bundle COPY of the
// pure planning helpers in ./registration.js (Cloud Functions can't import
// src/). This suite runs both implementations over the same input matrix and
// requires identical outputs. If it fails, someone edited one file without
// the other.

import { describe, it, expect } from 'vitest'
import * as src from './registration'
import * as fn from '../../../functions/core/registration.js'

const ts = (ms) => ({ toMillis: () => ms }) // opaque — helpers never inspect timestamps

describe('functions/core/registration.js parity with src/lib/tournaments/registration.js', () => {
  it('totalEntryCost matches', () => {
    const cases = [
      { buyIn: 10000, hospitalityCost: 5000 },
      { buyIn: 10000, hospitalityCost: 0 },
      {},
      null,
    ]
    for (const t of cases) expect(fn.totalEntryCost(t)).toBe(src.totalEntryCost(t))
  })

  it('registrationOpen matches', () => {
    for (const status of ['draft', 'scheduled', 'lateRegOpen', 'lateRegClosed', 'finished', 'cancelled']) {
      expect(fn.registrationOpen({ status })).toBe(src.registrationOpen({ status }))
    }
    expect(fn.registrationOpen(null)).toBe(src.registrationOpen(null))
  })

  it('registrableSessions matches', () => {
    const sessions = [
      { id: 'd2', convergesIntoSessionId: null, status: 'scheduled', dayNumber: 2, sessionLabel: 'Day 2' },
      { id: 'd1a', convergesIntoSessionId: 'd2', status: 'scheduled', dayNumber: 1, sessionLabel: 'Day 1A' },
      { id: 'd1b', convergesIntoSessionId: 'd2', status: 'scheduled', dayNumber: 1, sessionLabel: 'Day 1B' },
      { id: 'd1c', convergesIntoSessionId: 'd2', status: 'cancelled', dayNumber: 1, sessionLabel: 'Day 1C' },
    ]
    expect(fn.registrableSessions(sessions)).toEqual(src.registrableSessions(sessions))
    expect(fn.registrableSessions([])).toEqual(src.registrableSessions([]))
    expect(fn.registrableSessions(null)).toEqual(src.registrableSessions(null))
  })

  it('planEntry matches across the state matrix', () => {
    const entry = (over = {}) => ({
      entryNumber: 1, entryType: 'initial', voidedAt: null, bustedAt: ts(1), playerId: 'p1', ...over,
    })
    const configs = [
      { type: 'freezeout', maxReentries: null, maxRebuys: null },
      { type: 'reentry', maxReentries: 2, maxRebuys: null },
      { type: 'reentry', maxReentries: null, maxRebuys: null },
      { type: 'rebuy', maxReentries: null, maxRebuys: 1 },
      null,
    ]
    const entrySets = [
      [],
      [entry({ bustedAt: null })],
      [entry()],
      [entry(), entry({ entryNumber: 2, entryType: 'reentry' })],
      [entry(), entry({ entryNumber: 2, entryType: 'reentry' }), entry({ entryNumber: 3, entryType: 'reentry' })],
      [entry({ voidedAt: ts(2) })],
      [entry({ voidedAt: ts(2) }), entry({ entryNumber: 5, voidedAt: ts(3) })],
      [entry({ entryNumber: undefined })],
      null,
    ]
    for (const reentryConfig of configs) {
      for (const playerEntries of entrySets) {
        expect(fn.planEntry({ playerEntries, reentryConfig })).toEqual(
          src.planEntry({ playerEntries, reentryConfig })
        )
      }
    }
  })

  it('computeEntryCounters matches', () => {
    const entries = [
      { playerId: 'a', voidedAt: null, bustedAt: null },
      { playerId: 'a', voidedAt: null, bustedAt: ts(1) },
      { playerId: 'b', voidedAt: null, bustedAt: null },
      { playerId: 'c', voidedAt: ts(2), bustedAt: null },
    ]
    expect(fn.computeEntryCounters(entries, 10000)).toEqual(src.computeEntryCounters(entries, 10000))
    expect(fn.computeEntryCounters([], 10000)).toEqual(src.computeEntryCounters([], 10000))
    expect(fn.computeEntryCounters(null, null)).toEqual(src.computeEntryCounters(null, null))
  })
})
