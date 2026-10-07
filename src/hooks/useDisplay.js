// Live data hooks behind the venue TV display (/display — Phase 5).
//
// UNLIKE useTournaments (a one-shot fetch + reload for the operator list),
// the TV has nobody to press reload — both hooks SUBSCRIBE live so status
// changes, counter updates, and clock events land on the TVs by themselves.
//
// INVARIANT (see HANDOFF 16 July — legacy data): every tournaments query MUST
// keep the orderBy('scheduledStartTime') clause. The prod collection carries
// ~1,800 legacy Casinoware docs that lack the field; orderBy excludes them,
// and without it the snapshot validator would throw on the first legacy doc.
//
// Mock-mode (pure mock, no emulator) surfaces as a `mockMode` flag, matching
// useTournaments / useClock.

import { useEffect, useReducer, useState } from 'react'
import { query, orderBy } from 'firebase/firestore'
import {
  tournaments as tournamentsApi,
  sessions as sessionsApi,
  displayScreens as displayScreensApi,
  MockModeError,
  NotFoundError,
} from '../lib/firestore'

const byScheduledDesc = (c) => query(c, orderBy('scheduledStartTime', 'desc'))

const initialTournaments = { tournaments: null, mockMode: false, error: null }

function tournamentsReducer(state, action) {
  switch (action.type) {
    case 'DATA':
      return { tournaments: action.tournaments, mockMode: false, error: null }
    case 'MOCK':
      return { ...initialTournaments, tournaments: [], mockMode: true }
    case 'ERROR':
      // Keep the last good list on a transient error — a TV should degrade to
      // slightly-stale data, not a crash screen, on a network blip.
      return { ...state, error: action.error }
    default:
      return state
  }
}

/** Live tournament list (archived rows dropped). tournaments is null until the first snapshot. */
export function useLiveTournaments() {
  const [state, dispatch] = useReducer(tournamentsReducer, initialTournaments)

  useEffect(() => {
    const onError = (e) => {
      if (e instanceof MockModeError) dispatch({ type: 'MOCK' })
      else dispatch({ type: 'ERROR', error: e })
    }
    try {
      return tournamentsApi.subscribeToTournaments(
        (rows) => dispatch({ type: 'DATA', tournaments: rows.filter((t) => t.archivedAt === null) }),
        byScheduledDesc,
        onError,
      )
    } catch (e) {
      onError(e)
      return undefined
    }
  }, [])

  return state
}

const initialSessions = { byTournament: {} }

function sessionsReducer(state, action) {
  switch (action.type) {
    case 'PRUNE': {
      const kept = {}
      for (const id of action.ids) if (state.byTournament[id]) kept[id] = state.byTournament[id]
      return { byTournament: kept }
    }
    case 'DATA':
      return { byTournament: { ...state.byTournament, [action.id]: action.sessions } }
    default:
      return state
  }
}

/**
 * Live sessions for each of the given tournament ids (the rotation set — a
 * handful at most, so a subscription per tournament is fine and keeps every
 * slide's clock warm before it rotates in). Session-level errors are dropped:
 * the slide renders its pre-start fallback until data arrives.
 */
export function useSessionsByTournament(tournamentIds) {
  const [state, dispatch] = useReducer(sessionsReducer, initialSessions)
  const key = (tournamentIds ?? []).join('|')

  useEffect(() => {
    const ids = key === '' ? [] : key.split('|')
    dispatch({ type: 'PRUNE', ids })
    const unsubs = []
    for (const id of ids) {
      try {
        unsubs.push(
          sessionsApi.subscribeToSessions(
            id,
            (sessions) => dispatch({ type: 'DATA', id, sessions }),
            undefined,
            () => {},
          ),
        )
      } catch {
        // MockModeError — the tournaments hook already surfaced mockMode.
      }
    }
    return () => {
      for (const u of unsubs) u()
    }
  }, [key])

  return state.byTournament
}

// ── Named screens (/display/<id>, 7 Oct 2026) ──────────────────────────────

/**
 * Live config for one named TV. status: 'loading' | 'ready' | 'missing' |
 * 'error'. On a transient error after a good read, the last config is kept
 * (stale beats blank on a TV); 'missing' is a deleted or mistyped screen.
 */
export function useDisplayScreen(screenId) {
  const [state, setState] = useState({ forId: screenId, screen: null, status: 'loading', error: null })
  // Reset during render when the id changes (no effect round-trip).
  if (state.forId !== screenId) {
    setState({ forId: screenId, screen: null, status: 'loading', error: null })
  }

  useEffect(() => {
    if (!screenId) return undefined
    const onError = (e) => {
      if (e instanceof NotFoundError) setState({ forId: screenId, screen: null, status: 'missing', error: null })
      else if (e instanceof MockModeError) setState({ forId: screenId, screen: null, status: 'error', error: e })
      else setState((s) => (s.screen ? { ...s, error: e } : { ...s, status: 'error', error: e }))
    }
    try {
      return displayScreensApi.subscribeToDisplayScreen(
        screenId,
        (screen) => setState({ forId: screenId, screen, status: 'ready', error: null }),
        onError,
      )
    } catch (e) {
      onError(e)
      return undefined
    }
  }, [screenId])

  return state
}

/** Live list of every named screen, sorted by name. screens is null until loaded. */
export function useDisplayScreens() {
  const [state, setState] = useState({ screens: null, mockMode: false, error: null })

  useEffect(() => {
    const onError = (e) => {
      if (e instanceof MockModeError) setState({ screens: [], mockMode: true, error: null })
      else setState((s) => ({ ...s, error: e }))
    }
    try {
      return displayScreensApi.subscribeToDisplayScreens(
        (rows) =>
          setState({ screens: [...rows].sort((a, b) => a.name.localeCompare(b.name)), mockMode: false, error: null }),
        onError,
      )
    } catch (e) {
      onError(e)
      return undefined
    }
  }, [])

  return state
}
