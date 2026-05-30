// Session-graph construction for multi-day / multi-flight tournaments.
//
// A tournament's play is divided into one or more *sessions* (the
// `tournaments/{tid}/sessions` subcollection — see canonical-schema.md §5.1).
// A single-day tournament has exactly one session; a multi-day event has one
// per day; a multi-flight event has several parallel flights on a day that all
// converge into a single later session.
//
// The hard part is the convergence graph. Player progression follows
// `convergesIntoSessionId` ONLY (never dayNumber/flightLabel — those are
// display-only). That pointer is a forward reference to another session that
// must already have an id, which creates a chicken-and-egg problem: we resolve
// it by pre-generating every session's UUID up front, wiring the pointers
// against the in-memory id set, and writing all sessions in ONE atomic batch
// (createTournament does the write; this module builds the docs).
//
// The Zod Session schema validates each session in isolation. The invariants
// that span sessions — contiguous non-overlapping slices across days, identical
// slices within a day's flights, exactly one final session — can't live in a
// per-doc schema, so validateSessionPlan enforces them here before any write.

import { generateId } from '../firestore'
import { TournamentError } from './errors'

// The implicit plan for a plain single-day tournament: one session, no flights,
// no level cap (plays to a winner). createTournament falls back to this when the
// caller passes no sessionPlan, so the common case needs no builder input.
export const SINGLE_DAY_PLAN = {
  days: [{ flightCount: 1, endStructureIndex: null, playToPercentRemaining: null, scheduledStartTime: null }],
}

// Denormalized format booleans on the tournament doc (§3.1) are derived from the
// session shape so they can never drift from the subcollection:
//   isMultiDay    = more than one day
//   isMultiFlight = any day runs more than one parallel session (flight)
export function deriveFormatFlags(days) {
  return {
    isMultiDay: days.length > 1,
    isMultiFlight: days.some((day) => day.flightCount > 1),
  }
}

/**
 * Validate a session plan against the structure it slices. Returns a
 * human-readable error string for the first problem found, or null if the plan
 * is sound. These are the cross-session invariants the Zod schema can't express
 * (it only sees one session at a time); both this module and the create form
 * call it (the form to flag the offending step, buildSessionDocs to refuse to
 * build a bad graph).
 *
 * The maximum slices must tile the structure: Day 1 = [0..e1], Day 2 = [e1+1..e2],
 * … with each non-final day capped at a concrete level so the next day knows
 * where to start. The final day may be uncapped (maximumEndIndex=null → "play to
 * a winner"). Flights share their day's slice, so only the final day — which is
 * the single convergence point — may not be flighted.
 *
 * @param {{days: Array<{flightCount:number, endStructureIndex:number|null, playToPercentRemaining:number|null}>}} plan
 * @param {number} structureLength  number of entries in the tournament's structure
 * @returns {string|null}
 */
export function validateSessionPlan(plan, structureLength) {
  if (!plan || !Array.isArray(plan.days) || plan.days.length === 0) {
    return 'A tournament needs at least one session.'
  }
  if (!Number.isInteger(structureLength) || structureLength < 1) {
    return 'Build the blind structure before defining days and flights.'
  }

  const { days } = plan
  const lastIndex = days.length - 1
  let expectedStart = 0

  for (let i = 0; i < days.length; i++) {
    const day = days[i]
    const isFinal = i === lastIndex
    const label = `Day ${i + 1}`

    const fc = day.flightCount
    if (!Number.isInteger(fc) || fc < 1) {
      return `${label}: number of flights must be a positive whole number.`
    }
    if (isFinal && fc !== 1) {
      return 'The final day must be a single converged session (parallel flights are only allowed on earlier days).'
    }

    const start = expectedStart
    if (start >= structureLength) {
      return `${label} starts past the end of the structure — earlier days cover too many levels.`
    }

    const end = day.endStructureIndex
    if (isFinal) {
      // The final day may be uncapped (play to a winner). If a cap is given it
      // must be a real index at/after the day's start.
      if (end !== null && end !== undefined) {
        if (!Number.isInteger(end) || end < start) {
          return `${label}: the end level must be at or after the day's start.`
        }
        if (end >= structureLength) {
          return `${label}: the end level is past the end of the structure.`
        }
      }
    } else {
      if (end === null || end === undefined) {
        return `${label}: choose the level this day ends on.`
      }
      if (!Number.isInteger(end)) {
        return `${label}: the end level is invalid.`
      }
      if (end < start) {
        return `${label}: the end level must be at or after the day's start (level ${start + 1}).`
      }
      if (end >= structureLength) {
        return `${label}: the end level is past the end of the structure.`
      }
      expectedStart = end + 1
    }

    const pct = day.playToPercentRemaining
    if (pct !== null && pct !== undefined) {
      if (typeof pct !== 'number' || Number.isNaN(pct) || pct < 0 || pct > 100) {
        return `${label}: "play down to %" must be between 0 and 100.`
      }
    }
  }

  return null
}

/**
 * Build the array of session documents for a tournament from a validated plan.
 * Generates every session's UUID, computes the convergence graph (each day's
 * sessions converge into the first session of the next day; the final day's
 * session has convergesIntoSessionId=null), and assigns the tiled maximum
 * slices. Runtime fields (actual indices/times, currentStructureIndex,
 * remainingPlayerCount) start null; status starts 'scheduled'.
 *
 * Throws TournamentError if the plan is unsound (see validateSessionPlan).
 *
 * @param {object} args
 * @param {Array<{flightCount:number, endStructureIndex:number|null, playToPercentRemaining:number|null, scheduledStartTime:(import('firebase/firestore').Timestamp|null)}>} args.days
 * @param {string} args.tournamentId
 * @param {number} args.structureLength
 * @param {import('firebase/firestore').Timestamp} args.defaultScheduledStartTime  Day 1's start (the tournament's), and the fallback for any day without its own time
 * @param {string} args.actorId
 * @param {import('firebase/firestore').Timestamp} args.timestamp  createdAt/updatedAt stamp
 * @returns {Array<object>} session docs ready for validatedSet / batch.set
 */
export function buildSessionDocs({
  days,
  tournamentId,
  structureLength,
  defaultScheduledStartTime,
  actorId,
  timestamp,
}) {
  const planError = validateSessionPlan({ days }, structureLength)
  if (planError) throw new TournamentError(planError)

  // Pre-generate ids for every session, grouped by day, BEFORE building any
  // doc — so each day's sessions can point at the next day's (already-known)
  // first id. This is the chicken-and-egg fix (§5.1).
  const idsByDay = days.map((day) => Array.from({ length: day.flightCount }, () => generateId()))

  const docs = []
  let start = 0

  for (let i = 0; i < days.length; i++) {
    const day = days[i]
    const isFinal = i === days.length - 1
    const maximumStartIndex = start
    const maximumEndIndex = isFinal ? (day.endStructureIndex ?? null) : day.endStructureIndex
    const convergesIntoSessionId = isFinal ? null : idsByDay[i + 1][0]
    // Day 1 always opens at the tournament's scheduled start; later days use
    // their own start time when given, else fall back to it.
    const scheduledStartTime =
      i === 0 ? defaultScheduledStartTime : (day.scheduledStartTime ?? defaultScheduledStartTime)
    const playToPercentRemaining = day.playToPercentRemaining ?? null
    const multiFlight = day.flightCount > 1

    for (let f = 0; f < day.flightCount; f++) {
      const flightLabel = multiFlight ? String.fromCharCode(65 + f) : null
      const sessionLabel = multiFlight ? `Day ${i + 1}${flightLabel}` : `Day ${i + 1}`
      docs.push({
        id: idsByDay[i][f],
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

    if (!isFinal) start = day.endStructureIndex + 1
  }

  return docs
}
