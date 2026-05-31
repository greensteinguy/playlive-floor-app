// Conformance gate for the emulator seed (scripts/seed/tournament-fixtures.js).
//
// The seed runner executes under plain `node`, which can't import these Zod
// schemas (the src tree uses Vite-style extensionless imports). Vitest CAN, so
// this is where we prove every seeded document actually validates — and that the
// seed meets the brief: ≥3 structure templates all >10 levels, 5–10 tournaments
// (some from templates), and 2–3 multi-day / multi-flight events with a correctly
// wired session graph. If the fixtures ever drift out of schema conformance, this
// fails in `npm test` rather than at runtime against the emulator.

import { describe, it, expect } from 'vitest'
import { Tournament, Session, StructureTemplate } from '../schema'
import { buildSeedData } from '../../../scripts/seed/tournament-fixtures.js'

const { structureTemplates, tournaments, sessions } = buildSeedData()

const sessionsFor = (tid) => sessions.filter((s) => s.tournamentId === tid).map((s) => s.doc)
const levelCount = (entries) => entries.filter((e) => e.type === 'level').length

// safeParse with the Zod issues surfaced in the assertion message on failure.
function expectValid(schema, value, label) {
  const r = schema.safeParse(value)
  expect(r.success, r.success ? '' : `${label} failed schema:\n${JSON.stringify(r.error.issues, null, 2)}`).toBe(true)
}

describe('seed — structure templates', () => {
  it('has 3–5 templates', () => {
    expect(structureTemplates.length).toBeGreaterThanOrEqual(3)
    expect(structureTemplates.length).toBeLessThanOrEqual(5)
  })

  it('every template validates against StructureTemplate', () => {
    for (const t of structureTemplates) expectValid(StructureTemplate, t, `structureTemplate ${t.id}`)
  })

  it('every template has more than 10 blind levels', () => {
    for (const t of structureTemplates) {
      expect(levelCount(t.levels), `${t.id} should have >10 levels`).toBeGreaterThan(10)
    }
  })
})

describe('seed — tournaments', () => {
  it('has 5–10 tournaments', () => {
    expect(tournaments.length).toBeGreaterThanOrEqual(5)
    expect(tournaments.length).toBeLessThanOrEqual(10)
  })

  it('every tournament validates against Tournament', () => {
    for (const t of tournaments) expectValid(Tournament, t, `tournament ${t.id}`)
  })

  it('some tournaments are built from a structure template, and the structure is copied in', () => {
    const fromTemplate = tournaments.filter((t) => t.structureTemplateId !== null)
    expect(fromTemplate.length).toBeGreaterThan(0)
    // At least one is bespoke (no template) too — proving both paths are exercised.
    expect(tournaments.some((t) => t.structureTemplateId === null)).toBe(true)

    const byId = Object.fromEntries(structureTemplates.map((s) => [s.id, s]))
    for (const t of fromTemplate) {
      const tpl = byId[t.structureTemplateId]
      expect(tpl, `${t.id} references missing template ${t.structureTemplateId}`).toBeTruthy()
      expect(t.structure, `${t.id} structure should be copied from ${t.structureTemplateId}`).toEqual(tpl.levels)
    }
  })

  it('has 2–3 multi-day / multi-flight tournaments', () => {
    const multi = tournaments.filter((t) => t.isMultiDay)
    expect(multi.length).toBeGreaterThanOrEqual(2)
    expect(multi.length).toBeLessThanOrEqual(3)
    // isMultiFlight ⇒ isMultiDay (also a Tournament invariant).
    for (const t of tournaments) if (t.isMultiFlight) expect(t.isMultiDay).toBe(true)
  })

  it('format flags are derived consistently from the session graph', () => {
    for (const t of tournaments) {
      const sess = sessionsFor(t.id)
      const dayCount = new Set(sess.map((s) => s.dayNumber)).size
      const maxFlights = Math.max(...[...new Set(sess.map((s) => s.dayNumber))].map(
        (d) => sess.filter((s) => s.dayNumber === d).length,
      ))
      expect(t.isMultiDay, `${t.id} isMultiDay`).toBe(dayCount > 1)
      expect(t.isMultiFlight, `${t.id} isMultiFlight`).toBe(maxFlights > 1)
    }
  })
})

describe('seed — sessions', () => {
  it('every session validates against Session', () => {
    for (const { tournamentId, doc } of sessions) expectValid(Session, doc, `session ${tournamentId}/${doc.id}`)
  })

  it('every tournament has exactly one final (converging) session', () => {
    for (const t of tournaments) {
      const finals = sessionsFor(t.id).filter((s) => s.convergesIntoSessionId === null)
      expect(finals.length, `${t.id} should have exactly one final session`).toBe(1)
    }
  })

  it('single-day tournaments have one play-to-a-winner session', () => {
    for (const t of tournaments.filter((x) => !x.isMultiDay)) {
      const sess = sessionsFor(t.id)
      expect(sess.length, `${t.id} single-day → 1 session`).toBe(1)
      expect(sess[0].maximumEndIndex, `${t.id} session plays to a winner`).toBe(null)
    }
  })
})

describe('seed — multi-day Championship', () => {
  const sess = sessionsFor('tour-championship')

  it('chains three single-flight days into a final', () => {
    expect(sess.length).toBe(3)
    const [d1, d2, d3] = [1, 2, 3].map((d) => sess.filter((s) => s.dayNumber === d))
    expect([d1.length, d2.length, d3.length]).toEqual([1, 1, 1])
    expect(d1[0].convergesIntoSessionId).toBe(d2[0].id)
    expect(d2[0].convergesIntoSessionId).toBe(d3[0].id)
    expect(d3[0].convergesIntoSessionId).toBe(null)
  })

  it('tiles the structure contiguously (Day1 [0..9], Day2 [10..19], Day3 [20..end])', () => {
    const byDay = (d) => sess.find((s) => s.dayNumber === d)
    expect([byDay(1).maximumStartIndex, byDay(1).maximumEndIndex]).toEqual([0, 9])
    expect([byDay(2).maximumStartIndex, byDay(2).maximumEndIndex]).toEqual([10, 19])
    expect(byDay(3).maximumStartIndex).toBe(20)
    expect(byDay(3).maximumEndIndex).toBe(null)
  })
})

describe('seed — multi-flight Mystery Bounty (4 → 1 fan-in)', () => {
  const sess = sessionsFor('tour-mystery-bounty')

  it('four Day-1 flights all converge into a single Day 2', () => {
    const d1 = sess.filter((s) => s.dayNumber === 1)
    const d2 = sess.filter((s) => s.dayNumber === 2)
    expect(d1.length).toBe(4)
    expect(d2.length).toBe(1)
    expect(d1.map((s) => s.flightLabel).sort()).toEqual(['A', 'B', 'C', 'D'])
    for (const s of d1) expect(s.convergesIntoSessionId).toBe(d2[0].id)
    expect(d2[0].convergesIntoSessionId).toBe(null)
  })

  it('Day-1 flights carry the play-to-% termination criterion', () => {
    for (const s of sess.filter((x) => x.dayNumber === 1)) {
      expect(s.playToPercentRemaining).toBe(15)
    }
  })
})

describe('seed — general N→N→1 funnel Mega Stack (4 → 2 → 1)', () => {
  const sess = sessionsFor('tour-megastack')

  it('narrows 4 Day-1 flights → 2 Day-2 flights → 1 Day-3 final', () => {
    const d1 = sess.filter((s) => s.dayNumber === 1)
    const d2 = sess.filter((s) => s.dayNumber === 2)
    const d3 = sess.filter((s) => s.dayNumber === 3)
    expect([d1.length, d2.length, d3.length]).toEqual([4, 2, 1])
  })

  it('Day-1 flights partition exactly across the two Day-2 flights (each claims 2)', () => {
    const d1 = sess.filter((s) => s.dayNumber === 1)
    const d2Ids = new Set(sess.filter((s) => s.dayNumber === 2).map((s) => s.id))
    const counts = {}
    for (const s of d1) {
      expect(d2Ids.has(s.convergesIntoSessionId), `Day-1 ${s.flightLabel} must feed a Day-2 flight`).toBe(true)
      counts[s.convergesIntoSessionId] = (counts[s.convergesIntoSessionId] ?? 0) + 1
    }
    expect(Object.keys(counts).length).toBe(2) // both Day-2 flights are fed
    expect(Object.values(counts)).toEqual([2, 2]) // each by exactly two Day-1 flights
  })

  it('both Day-2 flights converge into the single Day-3 final', () => {
    const d2 = sess.filter((s) => s.dayNumber === 2)
    const d3 = sess.filter((s) => s.dayNumber === 3)
    for (const s of d2) expect(s.convergesIntoSessionId).toBe(d3[0].id)
    expect(d3[0].convergesIntoSessionId).toBe(null)
  })
})
