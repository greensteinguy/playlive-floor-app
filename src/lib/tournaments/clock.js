// Tournament-clock operations: start / pause / resume / advance / rewind / goto
// / finish. Each runs as a read-modify-write transaction over the SESSION (the
// clock's source of truth — a multi-day tournament runs its clock per session)
// and the parent TOURNAMENT (read for its structure, and updated with a
// denormalized live-state snapshot so the list page and the other apps see the
// running level without re-deriving).
//
// The clock is server-authoritative but stored as an ANCHOR, not a per-tick
// value: only these events write. Between events the live level + countdown are
// DERIVED (see ../clock.js deriveClock) from the anchor + the structure, so
// levels auto-advance at zero with no writes and every screen stays in sync.
// Because of that, the tournament's denormalized currentStructureIndex /
// isOnBreak are a SNAPSHOT taken at each event — they can lag a level between
// events; the derived value is authoritative for display.
//
// Time discipline: all anchors use Timestamp.now() from the SDK (consistent with
// the wallet module's now()); the resume re-anchor math lives in ../clock.js so
// it stays pure and unit-tested. Role enforcement is at the UI + Firestore-rules
// layers (manager + td); these ops assemble, validate (the full Session +
// Tournament schemas re-run on tx.set), and write a best-effort audit row.

import { Timestamp } from 'firebase/firestore'
import { runValidatedTransaction, auditLog, paths } from '../firestore'
import { Tournament, Session } from '../schema'
import { now } from '../wallet/_shared'
import { TournamentError } from './errors'
import {
  deriveClock,
  clockState,
  clockSliceEndIndex,
  resumeStartedAtMs,
  CLOCK_STOPPED,
  CLOCK_RUNNING,
  CLOCK_PAUSED,
} from '../clock'

function requireId(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TournamentError(`${name} is required (non-empty string)`)
  }
}

function requireActor(actorId) {
  requireId(actorId, 'actorId')
}

// The denormalized live-state patch written onto the tournament doc from the
// derived current index + the session's pause state.
function liveState(currentIndex, structure, pausedAtTs) {
  const entry = currentIndex != null ? structure[currentIndex] : null
  return {
    currentStructureIndex: currentIndex,
    pausedAt: pausedAtTs,
    isOnBreak: entry?.type === 'break',
  }
}

/**
 * Shared transaction driver. Reads the session + tournament, hands them to
 * `mutate` (which returns the session field patch + the tournament live-state
 * patch, or throws TournamentError to abort before any write), then writes both
 * docs back in full so every schema superRefine invariant re-runs.
 */
async function runClockTxn({ tournamentId, sessionId, mutate }) {
  requireId(tournamentId, 'tournamentId')
  requireId(sessionId, 'sessionId')
  return runValidatedTransaction(async (tx) => {
    const session = await tx.get(paths.sessionPath(tournamentId, sessionId), Session)
    const tournament = await tx.get(paths.tournamentPath(tournamentId), Tournament)
    if (!Array.isArray(tournament.structure) || tournament.structure.length === 0) {
      throw new TournamentError('tournament has no structure to run a clock against')
    }
    const timestamp = now()
    const nowMs = timestamp.toMillis()
    const { session: sessionPatch, tournament: tournamentPatch } = mutate({
      session,
      tournament,
      timestamp,
      nowMs,
    })
    const nextSession = { ...session, ...sessionPatch, updatedAt: timestamp }
    const nextTournament = { ...tournament, ...tournamentPatch, updatedAt: timestamp }
    tx.set(paths.sessionPath(tournamentId, sessionId), Session, nextSession)
    tx.set(paths.tournamentPath(tournamentId), Tournament, nextTournament)
    return { session: nextSession, tournament: nextTournament }
  })
}

function writeClockAudit({ actorId, actorRole, actionType, tournamentId, sessionId, metadata }) {
  return auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType,
    targetType: 'tournament',
    targetId: tournamentId,
    metadata: { sessionId, ...metadata },
  })
}

/**
 * Start the clock for a session. Anchors at the session's first level
 * (maximumStartIndex), moves the session to inProgress, and stamps
 * actualStartIndex / actualStartTime. (The multi-flight convergence rollback —
 * deriving actualStartIndex from upstream sessions — is deferred; see
 * canonical-schema §5.1 and the task-2.4 notes.)
 */
export async function startClock({ tournamentId, sessionId, actorId, actorRole }) {
  requireActor(actorId)
  const result = await runClockTxn({
    tournamentId,
    sessionId,
    mutate: ({ session, tournament, timestamp }) => {
      if (clockState(session) !== CLOCK_STOPPED) {
        throw new TournamentError('clock is already started')
      }
      if (session.status === 'finished' || session.status === 'cancelled') {
        throw new TournamentError(`cannot start a ${session.status} session`)
      }
      const startIndex = session.maximumStartIndex
      if (startIndex >= tournament.structure.length) {
        throw new TournamentError('session start index is out of range of the structure')
      }
      return {
        session: {
          status: 'inProgress',
          actualStartIndex: startIndex,
          actualStartTime: timestamp,
          clockStartIndex: startIndex,
          clockStartedAt: timestamp,
          clockPausedAt: null,
          currentStructureIndex: startIndex,
        },
        tournament: liveState(startIndex, tournament.structure, null),
      }
    },
  })
  await writeClockAudit({
    actorId,
    actorRole,
    actionType: 'tournament.clockStarted',
    tournamentId,
    sessionId,
    metadata: { sessionLabel: result.session.sessionLabel, startIndex: result.session.clockStartIndex },
  })
  return result
}

/** Pause a running clock (freezes the countdown at this instant). */
export async function pauseClock({ tournamentId, sessionId, actorId, actorRole }) {
  requireActor(actorId)
  const result = await runClockTxn({
    tournamentId,
    sessionId,
    mutate: ({ session, tournament, timestamp, nowMs }) => {
      if (clockState(session) !== CLOCK_RUNNING) {
        throw new TournamentError('clock is not running')
      }
      const derived = deriveClock(session, tournament.structure, nowMs)
      return {
        session: { clockPausedAt: timestamp, currentStructureIndex: derived.currentIndex },
        tournament: liveState(derived.currentIndex, tournament.structure, timestamp),
      }
    },
  })
  await writeClockAudit({ actorId, actorRole, actionType: 'tournament.paused', tournamentId, sessionId, metadata: {} })
  return result
}

/** Resume a paused clock. Re-anchors so the paused interval doesn't count. */
export async function resumeClock({ tournamentId, sessionId, actorId, actorRole }) {
  requireActor(actorId)
  const result = await runClockTxn({
    tournamentId,
    sessionId,
    mutate: ({ session, tournament, nowMs }) => {
      if (clockState(session) !== CLOCK_PAUSED) {
        throw new TournamentError('clock is not paused')
      }
      const newStartedMs = resumeStartedAtMs(
        session.clockStartedAt.toMillis(),
        session.clockPausedAt.toMillis(),
        nowMs,
      )
      const patch = { clockStartedAt: Timestamp.fromMillis(newStartedMs), clockPausedAt: null }
      const derived = deriveClock({ ...session, ...patch }, tournament.structure, nowMs)
      return {
        session: { ...patch, currentStructureIndex: derived.currentIndex },
        tournament: liveState(derived.currentIndex, tournament.structure, null),
      }
    },
  })
  await writeClockAudit({ actorId, actorRole, actionType: 'tournament.resumed', tournamentId, sessionId, metadata: {} })
  return result
}

// Re-anchor the clock to a new level (manual advance / rewind / jump). The new
// level starts fresh at its full duration; if the clock was paused it stays
// paused (frozen at the new level's start). resolveTarget maps the current
// derived index to the target index; the result is clamped to the session slice.
function reanchorMutate(resolveTarget) {
  return ({ session, tournament, timestamp, nowMs }) => {
    const state = clockState(session)
    if (state === CLOCK_STOPPED) {
      throw new TournamentError('clock is not running; start it first')
    }
    if (session.status !== 'inProgress') {
      throw new TournamentError('session is not in progress')
    }
    const structure = tournament.structure
    const derived = deriveClock(session, structure, nowMs)
    const sliceEnd = clockSliceEndIndex(session, structure.length)
    const current = derived.currentIndex ?? session.clockStartIndex
    const target = Math.max(session.maximumStartIndex, Math.min(sliceEnd, resolveTarget(current)))
    const wasPaused = state === CLOCK_PAUSED
    return {
      _meta: { from: current, to: target },
      session: {
        clockStartIndex: target,
        clockStartedAt: timestamp,
        clockPausedAt: wasPaused ? timestamp : null,
        currentStructureIndex: target,
      },
      tournament: liveState(target, structure, wasPaused ? timestamp : null),
    }
  }
}

async function changeLevel({ tournamentId, sessionId, actorId, actorRole, resolveTarget, direction }) {
  requireActor(actorId)
  let meta = {}
  const result = await runClockTxn({
    tournamentId,
    sessionId,
    mutate: (ctx) => {
      const out = reanchorMutate(resolveTarget)(ctx)
      meta = out._meta
      return out
    },
  })
  await writeClockAudit({
    actorId,
    actorRole,
    actionType: 'tournament.levelChanged',
    tournamentId,
    sessionId,
    metadata: { direction, fromIndex: meta.from, toIndex: meta.to },
  })
  return result
}

/** Advance to the next level/break (TD button). No-op clamp at the slice end. */
export function advanceLevel({ tournamentId, sessionId, actorId, actorRole }) {
  return changeLevel({ tournamentId, sessionId, actorId, actorRole, resolveTarget: (cur) => cur + 1, direction: 'advance' })
}

/** Step back to the previous level/break. Clamped at the slice start. */
export function rewindLevel({ tournamentId, sessionId, actorId, actorRole }) {
  return changeLevel({ tournamentId, sessionId, actorId, actorRole, resolveTarget: (cur) => cur - 1, direction: 'rewind' })
}

/** Jump to an explicit structure index (clamped to the session slice). */
export function gotoLevel({ tournamentId, sessionId, targetIndex, actorId, actorRole }) {
  if (!Number.isInteger(targetIndex)) {
    return Promise.reject(new TournamentError('targetIndex must be an integer'))
  }
  return changeLevel({ tournamentId, sessionId, actorId, actorRole, resolveTarget: () => targetIndex, direction: 'goto' })
}

/**
 * Finish the session's clock: marks the session finished, stops the clock, and
 * records the level play ended on as actualEndIndex. Tournament-level status /
 * finishedAt transitions are owned by the status-transition flow (task 2.7), so
 * this touches the session + the denormalized live-state snapshot only.
 */
export async function finishClock({ tournamentId, sessionId, actorId, actorRole }) {
  requireActor(actorId)
  const result = await runClockTxn({
    tournamentId,
    sessionId,
    mutate: ({ session, tournament, timestamp, nowMs }) => {
      if (session.status !== 'inProgress') {
        throw new TournamentError('only an in-progress session can be finished')
      }
      const derived = deriveClock(session, tournament.structure, nowMs)
      const endIndex = derived.currentIndex ?? session.actualStartIndex ?? session.maximumStartIndex
      return {
        session: {
          status: 'finished',
          actualEndTime: timestamp,
          actualEndIndex: endIndex,
          currentStructureIndex: endIndex,
          clockStartIndex: null,
          clockStartedAt: null,
          clockPausedAt: null,
        },
        tournament: liveState(endIndex, tournament.structure, null),
      }
    },
  })
  await writeClockAudit({
    actorId,
    actorRole,
    actionType: 'tournament.clockFinished',
    tournamentId,
    sessionId,
    metadata: { endIndex: result.session.actualEndIndex },
  })
  return result
}
