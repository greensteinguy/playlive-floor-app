// Live clock hook behind the TD clock control screen (task 2.6).
//
// UNLIKE useTournament (a one-shot fetch, so a stream can't clobber an in-progress
// edit), the clock screen is a read-only mirror of server state with action
// buttons — so it SUBSCRIBES live to both the session (the clock's source of
// truth) and the parent tournament (structure + counters). After any clock
// action the subscription pushes the new state automatically; the screen never
// reloads by hand.
//
// The live blind level + countdown are DERIVED (see lib/clock.js) from the
// session's anchor fields + the structure, so they auto-advance with no writes.
// A local 1s tick (only while the clock is running) re-renders the countdown
// between Firestore updates; deriveClock self-corrects each tick against the
// stored anchor, so the local tick can never drift the clock out of sync.
//
// Pure-mock mode (no emulator) surfaces as `mockMode`; a missing session/
// tournament as `notFound` — neither is a thrown UI error, matching useTournament.

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
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
import { deriveClock, clockState, CLOCK_RUNNING } from '../lib/clock'
import { useAuth } from '../auth/useAuth'

const initialState = {
  tournament: null,
  session: null,
  error: null,
  mockMode: false,
  notFound: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return initialState
    case 'SET_TOURNAMENT':
      return { ...state, tournament: action.tournament }
    case 'SET_SESSION':
      return { ...state, session: action.session }
    case 'MOCK':
      return { ...initialState, mockMode: true }
    case 'NOTFOUND':
      return { ...state, notFound: true }
    case 'ERROR':
      return { ...state, error: action.error }
    default:
      return state
  }
}

export function useClock(tournamentId, sessionId) {
  const { user, role } = useAuth()
  const [state, dispatch] = useReducer(reducer, initialState)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Subscribe to the tournament + session live. ensureLive() throws MockModeError
  // synchronously in pure-mock mode, so the subscribe calls are guarded.
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
        (s) => dispatch({ type: 'SET_SESSION', session: s }),
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

  // Tick once a second only while the clock is actually running (paused/stopped
  // clocks are static — deriveClock ignores `now` when paused).
  const running = clockState(state.session) === CLOCK_RUNNING
  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const derived = useMemo(() => {
    if (!state.session || !state.tournament) return null
    return deriveClock(state.session, state.tournament.structure, nowMs)
  }, [state.session, state.tournament, nowMs])

  // Clock actions, bound to the current actor + ids. Each rejects (throws) on a
  // precondition failure so the screen can toast it; the live subscription
  // delivers the resulting state, so there's nothing to reload.
  const actorId = user?.uid
  const actorRole = role
  const op = useCallback(
    (fn, extra = {}) => fn({ tournamentId, sessionId, actorId, actorRole, ...extra }),
    [tournamentId, sessionId, actorId, actorRole],
  )

  const actions = useMemo(
    () => ({
      start: () => op(startClock),
      pause: () => op(pauseClock),
      resume: () => op(resumeClock),
      advance: () => op(advanceLevel),
      rewind: () => op(rewindLevel),
      goto: (targetIndex) => op(gotoLevel, { targetIndex }),
      finish: () => op(finishClock),
    }),
    [op],
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
