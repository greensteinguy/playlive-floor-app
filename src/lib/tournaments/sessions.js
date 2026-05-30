// Session-graph construction for multi-day / multi-flight tournaments.
//
// A tournament's play is divided into one or more *sessions* (the
// `tournaments/{tid}/sessions` subcollection — see canonical-schema.md §5.1).
// Sessions are organised into ordered STAGES (≈ days). Each stage plays a
// contiguous slice of the structure and runs one or more parallel FLIGHTS. A
// single-day tournament is one stage with one flight; a multi-flight event
// funnels many flights through fewer flights, stage by stage, down to a single
// final session.
//
// Routing is a FAN-IN FUNNEL: each flight feeds exactly one flight in the next
// stage (no fan-out), and a stage's flights partition the previous stage's
// flights ("survivors from"). Player progression follows `convergesIntoSessionId`
// ONLY (never dayNumber/flightLabel — those are display-only). That pointer is a
// forward reference, so we pre-generate every session's UUID up front, wire the
// pointers against the in-memory id set, and write all sessions in ONE atomic
// batch (createTournament does the write; this module builds the docs).
//
// The Zod Session schema validates each session in isolation. The cross-session
// invariants — contiguous non-overlapping slices, the routing partition, exactly
// one final session — live in validateSessionPlan here, before any write.

import { generateId } from '../firestore'
import { TournamentError } from './errors'

// The implicit plan for a plain single-day tournament: one stage, one flight, no
// level cap (plays to a winner). createTournament falls back to this when no
// sessionPlan is passed, so the common case needs no builder input.
export const SINGLE_DAY_PLAN = {
  stages: [
    {
      endStructureIndex: null,
      playToPercentRemaining: null,
      flights: [{ scheduledStartTime: null, survivorsFrom: [] }],
    },
  ],
}

// Display label for the n-th flight of a stage (0 → 'A', 1 → 'B', …).
function flightLetter(n) {
  return String.fromCharCode(65 + n)
}

// Denormalized format booleans on the tournament doc (§3.1), derived from the
// session shape so they can never drift from the subcollection:
//   isMultiDay    = more than one stage
//   isMultiFlight = any stage runs more than one parallel flight
export function deriveFormatFlags(stages) {
  return {
    isMultiDay: stages.length > 1,
    isMultiFlight: stages.some((stage) => (stage.flights?.length ?? 0) > 1),
  }
}

/**
 * Validate a session plan against the structure it slices. Returns a
 * human-readable error string for the first problem found, or null if sound.
 * These are the cross-session invariants the per-doc Zod schema can't express;
 * both this module and the create form call it (the form to flag the problem,
 * buildSessionDocs to refuse to build a bad graph).
 *
 * Invariants:
 *  - ≥1 stage; every stage has ≥1 flight; the LAST stage has exactly 1 flight
 *    (the single convergence point / final session).
 *  - The maximum slices tile the structure contiguously: stage 0 = [0..e0],
 *    stage 1 = [e0+1..e1], … each non-final stage capped at a concrete level; the
 *    final stage may be uncapped (null → "play to a winner").
 *  - Routing partition: stage 0's flights have no upstream; for every later stage,
 *    its flights' `survivorsFrom` partition the previous stage's flights exactly —
 *    each previous flight feeds exactly one next-stage flight (no orphan, split,
 *    duplicate, or out-of-range reference).
 *
 * @param {{stages: Array<{endStructureIndex:number|null, playToPercentRemaining:number|null, flights:Array<{survivorsFrom:number[]}>}>}} plan
 * @param {number} structureLength  number of entries in the tournament's structure
 * @returns {string|null}
 */
export function validateSessionPlan(plan, structureLength) {
  if (!plan || !Array.isArray(plan.stages) || plan.stages.length === 0) {
    return 'A tournament needs at least one session.'
  }
  if (!Number.isInteger(structureLength) || structureLength < 1) {
    return 'Build the blind structure before defining days and flights.'
  }

  const { stages } = plan
  const lastStage = stages.length - 1
  let expectedStart = 0

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    const isFinal = i === lastStage
    const dayLabel = `Day ${i + 1}`
    const prevDayLabel = `Day ${i}`

    const flights = stage.flights
    if (!Array.isArray(flights) || flights.length === 0) {
      return `${dayLabel}: needs at least one flight.`
    }
    if (isFinal && flights.length !== 1) {
      return 'The final day must be a single converged session (parallel flights are only allowed on earlier days).'
    }

    // ── Slice tiling ──────────────────────────────────────────────────────────
    const start = expectedStart
    if (start >= structureLength) {
      return `${dayLabel} starts past the end of the structure — earlier days cover too many levels.`
    }
    const end = stage.endStructureIndex
    if (isFinal) {
      // The final stage may be uncapped (play to a winner); a given cap must be a
      // real index at/after its start.
      if (end !== null && end !== undefined) {
        if (!Number.isInteger(end) || end < start) {
          return `${dayLabel}: the end level must be at or after the day's start.`
        }
        if (end >= structureLength) {
          return `${dayLabel}: the end level is past the end of the structure.`
        }
      }
    } else {
      if (end === null || end === undefined) {
        return `${dayLabel}: choose the level this day ends on.`
      }
      if (!Number.isInteger(end)) {
        return `${dayLabel}: the end level is invalid.`
      }
      if (end < start) {
        return `${dayLabel}: the end level must be at or after the day's start (level ${start + 1}).`
      }
      if (end >= structureLength) {
        return `${dayLabel}: the end level is past the end of the structure.`
      }
      expectedStart = end + 1
    }

    // ── Optional early-termination criterion ──────────────────────────────────
    const pct = stage.playToPercentRemaining
    if (pct !== null && pct !== undefined) {
      if (typeof pct !== 'number' || Number.isNaN(pct) || pct < 0 || pct > 100) {
        return `${dayLabel}: "play down to %" must be between 0 and 100.`
      }
    }

    // ── Routing partition ─────────────────────────────────────────────────────
    if (i === 0) {
      for (const flight of flights) {
        if (Array.isArray(flight.survivorsFrom) && flight.survivorsFrom.length > 0) {
          return `${dayLabel}: the first day's flights can't take survivors from an earlier day.`
        }
      }
    } else {
      const prevCount = stages[i - 1].flights.length
      const claimed = new Array(prevCount).fill(0)
      for (const flight of flights) {
        const from = flight.survivorsFrom
        if (!Array.isArray(from) || from.length === 0) {
          return `${dayLabel}: every flight must take survivors from at least one ${prevDayLabel} flight.`
        }
        for (const idx of from) {
          if (!Number.isInteger(idx) || idx < 0 || idx >= prevCount) {
            return `${dayLabel}: a flight references a ${prevDayLabel} flight that doesn't exist.`
          }
          claimed[idx] += 1
        }
      }
      for (let p = 0; p < prevCount; p++) {
        if (claimed[p] === 0) {
          return `${prevDayLabel}: flight ${flightLetter(p)} doesn't feed into any ${dayLabel} flight.`
        }
        if (claimed[p] > 1) {
          return `${prevDayLabel}: flight ${flightLetter(p)} feeds into more than one ${dayLabel} flight (survivors can only go to one).`
        }
      }
    }
  }

  return null
}

/**
 * Build the array of session documents for a tournament from a validated plan.
 * Generates every session's UUID, wires the convergence graph from the routing
 * partition (each flight → the next-stage flight whose `survivorsFrom` claims it;
 * the final stage's lone session has convergesIntoSessionId=null), and assigns the
 * tiled maximum slices. Runtime fields (actual indices/times, currentStructureIndex,
 * remainingPlayerCount, clock anchor) start null; status starts 'scheduled'.
 *
 * Throws TournamentError if the plan is unsound (see validateSessionPlan).
 *
 * @param {object} args
 * @param {Array<{endStructureIndex:number|null, playToPercentRemaining:number|null, flights:Array<{scheduledStartTime:(import('firebase/firestore').Timestamp|null), survivorsFrom:number[]}>}>} args.stages
 * @param {string} args.tournamentId
 * @param {number} args.structureLength
 * @param {import('firebase/firestore').Timestamp} args.defaultScheduledStartTime  fallback for any flight without its own start time (e.g. Day 1A = the tournament start)
 * @param {string} args.actorId
 * @param {import('firebase/firestore').Timestamp} args.timestamp  createdAt/updatedAt stamp
 * @returns {Array<object>} session docs ready for validatedSet / batch.set
 */
export function buildSessionDocs({
  stages,
  tournamentId,
  structureLength,
  defaultScheduledStartTime,
  actorId,
  timestamp,
}) {
  const planError = validateSessionPlan({ stages }, structureLength)
  if (planError) throw new TournamentError(planError)

  // Pre-generate ids for every flight in every stage BEFORE building any doc, so
  // each flight can point at its (already-known) downstream flight's id (§5.1).
  const idsByStage = stages.map((stage) => stage.flights.map(() => generateId()))

  const docs = []
  let start = 0

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    const isFinal = i === stages.length - 1
    const maximumStartIndex = start
    const maximumEndIndex = isFinal ? (stage.endStructureIndex ?? null) : stage.endStructureIndex
    const playToPercentRemaining = stage.playToPercentRemaining ?? null
    const multiFlight = stage.flights.length > 1

    for (let f = 0; f < stage.flights.length; f++) {
      const flight = stage.flights[f]
      // Downstream flight = the one in the next stage whose survivorsFrom claims
      // this flight's index. The partition guarantees exactly one (final → null).
      let convergesIntoSessionId = null
      if (!isFinal) {
        const g = stages[i + 1].flights.findIndex((nf) => (nf.survivorsFrom ?? []).includes(f))
        convergesIntoSessionId = g >= 0 ? idsByStage[i + 1][g] : null
      }
      const flightLabel = multiFlight ? flightLetter(f) : null
      const sessionLabel = multiFlight ? `Day ${i + 1}${flightLabel}` : `Day ${i + 1}`
      // Each flight opens at its own start time, falling back to the tournament's
      // scheduled start (so Day 1A defaults to the tournament start).
      const scheduledStartTime = flight.scheduledStartTime ?? defaultScheduledStartTime

      docs.push({
        id: idsByStage[i][f],
        tournamentId,
        convergesIntoSessionId,
        dayNumber: i + 1,
        flightLabel,
        sessionLabel,
        maximumStartIndex,
        maximumEndIndex,
        playToPercentRemaining,
        actualStartIndex: null,
        actualEndIndex: null,
        scheduledStartTime,
        actualStartTime: null,
        actualEndTime: null,
        status: 'scheduled',
        currentStructureIndex: null,
        remainingPlayerCount: null,
        clockStartIndex: null,
        clockStartedAt: null,
        clockPausedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actorId,
      })
    }

    if (!isFinal) start = stage.endStructureIndex + 1
  }

  return docs
}
