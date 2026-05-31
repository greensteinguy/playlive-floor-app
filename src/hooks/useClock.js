// Live clock hook behind the TD clock control screen (task 2.6).
//
// UNLIKE useTournament (a one-shot fetch, so a stream can't clobber an in-progress
// edit), the clock screen is a read-only mirror of server state with action
// buttons — so it SUBSCRIBES live to both the session (the clock's source of
// truth) and the parent tournament (structure + counters).
//
// SMOOTHNESS (the gospel rule — see lib/clock-sync.js): the displayed running
// countdown must never jump. So this hook does NOT derive the running clock from
// the Firestore echo every tick (which made pause/resume snap across the async
// write's round trip). Instead it keeps an OPTIMISTIC LOCAL ANCHOR: button clicks
// mutate it synchronously (pause freezes instantly; resume continues from the
// frozen remaining instantly), the async domain op writes in the background, and
// when the echo lands we RECONCILE (absorb our own echo without a snap; re-seed
// only on a genuine external event). All of that state machine is the pure,
// unit-tested clockSyncReducer; this hook is just the React glue (subscriptions,
// a wall-clock tick while running, and wiring the action buttons + rollback).
//
// Pure-mock mode (no emulator) surfaces as `mockMode`; a missing session/
// tournament as `notFound` — neither is a thrown UI error, matching useTournament.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { tournaments as tournamentsApi, sessions as sessionsApi, MockModeError, NotFoundError } from '../lib/firestore'
import {
  startClock,
  pauseClock,
  resumeClock,
  advanceLevel,
  rewindLevel,
  gotoLevel,
  finishClock,
} from '../lib/tournaments'
import { deriveClock } from '../lib/clock'
import { clockSyncReducer, initialClockState, syntheticSession, isAnchorRunning } from '../lib/clock-sync'
import { useAuth } from '../auth/useAuth'

// Backstop if an optimistic op neither confirms nor rejects within this window
// (e.g. multi-device contention): adopt the latest server state as baseline but
// KEEP the smooth local clock. Longer than the worst plausible long-poll RTT.
const PENDING_TIMEOUT_MS = 6000

// While running, tick faster than 1s so the displayed whole second updates
// promptly (formatRemaining rounds up, so 250ms collapses to clean 1s steps).
const TICK_MS = 250

export function useClock(tournamentId, sessionId) {
  const { user, role } = useAuth()
  const [state, dispatch] = useReducer(clockSyncReducer, initialClockState)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const tokenRef = useRef(0)

  // Subscribe to the tournament + session live. ensureLive() throws MockModeError
  // synchronously in pure-mock mode, so the subscribe calls are guarded. RESET on
  // id change clears the optimistic anchor too, so switching sessions re-seeds clean.
  useEffect(() => {
    dispatch({ type: 'RESET' })
    if (!tournamentId || !sessionId) return undefined
    const onError = (e) => {
      if (e instanceof MockModeError) dispatch({ type: 'MOCK' })
      else if (e instanceof NotFoundError) dispatch({ type: 'NOTFOUND' })
      else dispatch({ type: 'ERROR', error: e })
    }
    try {
      const unsubT = tournamentsApi.subscribeToTournament(
        tournamentId,
        (t) => dispatch({ type: 'SET_TOURNAMENT', tournament: t }),
        onError,
      )
      const unsubS = sessionsApi.subscribeToSession(
        tournamentId,
        sessionId,
        (s) => dispatch({ type: 'ECHO', session: s, nowMs: Date.now() }),
        onError,
      )
      return () => {
        unsubT()
        unsubS()
      }
    } catch (e) {
      onError(e)
      return undefined
    }
  }, [tournamentId, sessionId])

  // Tick only while the LOCAL anchor is running (paused/stopped are static). Gating
  // on the local anchor — not the server echo — means optimistic pause stops the
  // tick instantly and optimistic resume starts it instantly.
  const running = isAnchorRunning(state.localAnchor)
  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  // The displayed clock: from the LOCAL anchor while started (so the running
  // countdown is purely local and never snapped), or straight from the server doc
  // while stopped/finished (yields the stopped/EMPTY shape — preserves the
  // NOT-STARTED preview + the FINISHED screen, which read the server session).
  const derived = useMemo(() => {
    if (!state.tournament) return null
    if (state.localAnchor) {
      return deriveClock(syntheticSession(state.localAnchor, state.session), state.tournament.structure, nowMs)
    }
    if (state.session) {
      return deriveClock(state.session, state.tournament.structure, nowMs)
    }
    return null
  }, [state.localAnchor, state.session, state.tournament, nowMs])

  // Clock actions. Each applies its OPTIMISTIC local transition synchronously (so
  // the display reacts instantly), fires the async domain op, and on rejection
  // rolls the optimistic change back to the server doc + re-throws so the screen
  // can toast. The confirming echo (or a timeout backstop) clears the pending slot.
  const actorId = user?.uid
  const actorRole = role
  const runOp = useCallback(
    async (verb, fn, extra = {}) => {
      const token = ++tokenRef.current
      dispatch({ type: 'OPTIMISTIC', verb, nowMs: Date.now(), token, targetIndex: extra.targetIndex })
      const timer = setTimeout(() => {
        if (tokenRef.current === token) dispatch({ type: 'PENDING_TIMEOUT' })
      }, PENDING_TIMEOUT_MS)
      try {
        await fn({ tournamentId, sessionId, actorId, actorRole, ...extra })
      } catch (e) {
        clearTimeout(timer)
        dispatch({ type: 'ROLLBACK', nowMs: Date.now() })
        throw e
      }
      clearTimeout(timer)
    },
    [tournamentId, sessionId, actorId, actorRole],
  )

  const actions = useMemo(
    () => ({
      start: () => runOp('start', startClock),
      pause: () => runOp('pause', pauseClock),
      resume: () => runOp('resume', resumeClock),
      advance: () => runOp('advance', advanceLevel),
      rewind: () => runOp('rewind', rewindLevel),
      goto: (targetIndex) => runOp('goto', gotoLevel, { targetIndex }),
      finish: () => runOp('finish', finishClock),
    }),
    [runOp],
  )

  const ready = state.tournament !== null && state.session !== null
  const loading = !ready && !state.error && !state.mockMode && !state.notFound

  return {
    tournament: state.tournament,
    session: state.session,
    derived,
    nowMs,
    loading,
    ready,
    error: state.error,
    mockMode: state.mockMode,
    notFound: state.notFound,
    actions,
  }
}
