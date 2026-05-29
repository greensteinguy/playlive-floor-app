// Single-tournament hook behind the detail page (task 2.x / 3.2).
//
// Deliberately a one-shot fetch + `reload`, NOT a live subscription: the detail
// page holds editable forms, and a streaming update arriving mid-edit would
// clobber the TD's in-progress changes. The page calls `reload` itself after a
// successful save to re-sync from the persisted document.
//
// A missing document surfaces as a `notFound` flag (the id in the URL may be
// stale or wrong) and pure-mock mode as `mockMode` — neither is a thrown UI
// error, matching useTournaments / useTemplates.

import { useCallback, useEffect, useReducer } from 'react'
import { tournaments, MockModeError, NotFoundError } from '../lib/firestore'

const initialState = {
  tournament: null,
  loading: true,
  error: null,
  mockMode: false,
  notFound: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return { ...initialState, loading: false, tournament: action.tournament }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_NOTFOUND':
      return { ...initialState, loading: false, notFound: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

export function useTournament(id) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    tournaments
      .getTournament(id)
      .then((t) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', tournament: t })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
        else if (e instanceof NotFoundError) dispatch({ type: 'FETCH_NOTFOUND' })
        else dispatch({ type: 'FETCH_ERROR', error: e })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => fetchOnce(), [fetchOnce])

  const reload = useCallback(() => {
    fetchOnce()
  }, [fetchOnce])

  return { ...state, reload }
}
