// Single-player hook behind the player detail / profile page (task 3.1).
//
// One-shot fetch + `reload`, NOT a live subscription — the profile page holds an
// editable form, and a streaming update arriving mid-edit would clobber the
// cashier's in-progress changes. The page calls `reload` after a successful save
// to re-sync from the persisted document. A missing document surfaces as a
// `notFound` flag and pure-mock mode as `mockMode` — neither is a thrown UI
// error, matching useTournament.

import { useCallback, useEffect, useReducer } from 'react'
import { players as playersApi, MockModeError, NotFoundError } from '../lib/firestore'

const initialState = {
  player: null,
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
      return { ...initialState, loading: false, player: action.player }
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

export function usePlayer(id) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    playersApi
      .getPlayer(id)
      .then((player) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', player })
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
