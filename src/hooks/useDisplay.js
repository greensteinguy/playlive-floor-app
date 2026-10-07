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
  displayGroups as displayGroupsApi,
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

// ── Named screens + sets (/display/<id>, 7 Oct 2026) ───────────────────────

/**
 * Live single doc by id. status: 'idle' (no id) | 'loading' | 'ready' |
 * 'missing' | 'error'. On a transient error after a good read the last data
 * is kept (stale beats blank on a TV).
 */
function useLiveDoc(subscribe, id) {
  const fresh = (forId) => ({ forId, data: null, status: forId ? 'loading' : 'idle', error: null })
  const [state, setState] = useState(() => fresh(id))
  // Reset during render when the id changes (no effect round-trip).
  if (state.forId !== id) setState(fresh(id))

  useEffect(() => {
    if (!id) return undefined
    const onError = (e) => {
      if (e instanceof NotFoundError) setState({ forId: id, data: null, status: 'missing', error: null })
      else if (e instanceof MockModeError) setState({ forId: id, data: null, status: 'error', error: e })
      else setState((s) => (s.data ? { ...s, error: e } : { ...s, status: 'error', error: e }))
    }
    try {
      return subscribe(id, (data) => setState({ forId: id, data, status: 'ready', error: null }), onError)
    } catch (e) {
      onError(e)
      return undefined
    }
  }, [subscribe, id])

  return state
}

/** Live config for one named TV ({ data: screen, status, error }). */
export function useDisplayScreen(screenId) {
  return useLiveDoc(displayScreensApi.subscribeToDisplayScreen, screenId)
}

/** Live config for one TV set ({ data: group, status, error }). */
export function useDisplayGroup(groupId) {
  return useLiveDoc(displayGroupsApi.subscribeToDisplayGroup, groupId)
}

function useLiveList(subscribe) {
  const [state, setState] = useState({ rows: null, mockMode: false, error: null })

  useEffect(() => {
    const onError = (e) => {
      if (e instanceof MockModeError) setState({ rows: [], mockMode: true, error: null })
      else setState((s) => ({ ...s, error: e }))
    }
    try {
      return subscribe(
        (rows) => setState({ rows: [...rows].sort((a, b) => a.name.localeCompare(b.name)), mockMode: false, error: null }),
        onError,
      )
    } catch (e) {
      onError(e)
      return undefined
    }
  }, [subscribe])

  return state
}

/** Live list of every named screen, sorted by name. rows is null until loaded. */
export function useDisplayScreens() {
  return useLiveList(displayScreensApi.subscribeToDisplayScreens)
}

/** Live list of every TV set, sorted by name. rows is null until loaded. */
export function useDisplayGroups() {
  return useLiveList(displayGroupsApi.subscribeToDisplayGroups)
}
