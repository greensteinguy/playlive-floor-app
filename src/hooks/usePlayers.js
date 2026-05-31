// Player-list hook behind the player search page (task 3.2).
//
// Like useTournaments, this is a one-shot whole-collection fetch + `reload`: the
// search page filters/ranks client-side (see lib/players/search.js) so it needs
// every active row in memory, and the collection is moderate-volume in v1. Merged
// and archived records are dropped client-side. Mock-mode (pure mock, no
// emulator) surfaces as a `mockMode` flag rather than a thrown error, matching
// useTournaments / useAuditLog.

import { useCallback, useEffect, useReducer } from 'react'
import { players as playersApi, MockModeError } from '../lib/firestore'

const initialState = {
  players: [],
  loading: true,
  error: null,
  mockMode: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return { ...initialState, loading: false, players: action.players }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

export function usePlayers() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    playersApi
      .listPlayers()
      .then((rows) => {
        if (cancelled) return
        const active = rows.filter((p) => p.archivedAt === null && !p.isMerged)
        dispatch({ type: 'FETCH_SUCCESS', players: active })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
        else dispatch({ type: 'FETCH_ERROR', error: e })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => fetchOnce(), [fetchOnce])

  const reload = useCallback(() => {
    fetchOnce()
  }, [fetchOnce])

  return { ...state, reload }
}
