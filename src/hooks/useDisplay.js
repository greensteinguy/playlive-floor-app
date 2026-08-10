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

import { useEffect, useReducer } from 'react'
import { query, orderBy } from 'firebase/firestore'
import { tournaments as tournamentsApi, sessions as sessionsApi, MockModeError } from '../lib/firestore'

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
