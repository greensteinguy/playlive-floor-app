// Entries for one tournament — the registered roster shown on the tournament
// detail Players tab. One-shot fetch + `reload` (the page reloads after a
// registration). Pure-mock surfaces as `mockMode`, not a thrown error.

import { useCallback, useEffect, useReducer } from 'react'
import { entries as entriesApi, MockModeError } from '../lib/firestore'

const initialState = { entries: [], loading: true, error: null, mockMode: false }

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return { ...initialState, loading: false, entries: action.entries }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

export function useEntries(tournamentId) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    entriesApi
      .listEntries(tournamentId)
      .then((rows) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', entries: rows })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
        else dispatch({ type: 'FETCH_ERROR', error: e })
      })
    return () => {
      cancelled = true
    }
  }, [tournamentId])

  useEffect(() => fetchOnce(), [fetchOnce])

  const reload = useCallback(() => {
    fetchOnce()
  }, [fetchOnce])

  return { ...state, reload }
}
