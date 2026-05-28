// Hook behind the duplicate-player merge tool. Fetches every (non-merged)
// player, runs the phone-normalized heuristic, and exposes:
//   - groups        — array of { key, members[] }
//   - loading / error / mockMode
//   - reload        — refetch (used after a successful merge)
//
// We pull all players in one shot for v1. With current venue volume (low
// thousands at most), the round-trip is fine. If/when the player count gets
// big we can move to a server-side aggregation, but until then this keeps the
// hook trivially correct and the heuristic easy to iterate on.

import { useCallback, useEffect, useReducer } from 'react'
import { players, MockModeError } from '../lib/firestore'
import { findDuplicateCandidates } from '../lib/players'

const initialState = {
  allPlayers: [],
  groups: [],
  loading: true,
  error: null,
  mockMode: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        allPlayers: action.players,
        groups: findDuplicateCandidates(action.players),
      }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

export function useDuplicateCandidates() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    players
      .listPlayers()
      .then((rows) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', players: rows })
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
