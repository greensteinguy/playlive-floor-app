// Bounty draws for a Mystery Bounty tournament (task 4.2): the recorded draws
// behind the bounty board + the remaining-pool figure. One-shot fetch + reload
// (mirrors useSeating — the page reloads after each draw). Pass a falsy id (or
// only pass an id for mysteryBounty tournaments) to skip fetching entirely.

import { useCallback, useEffect, useReducer } from 'react'
import { bountyDraws as bountyDrawsApi, MockModeError } from '../lib/firestore'

const initialState = { draws: [], loading: false, error: null }

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return { draws: action.draws, loading: false, error: null }
    case 'FETCH_SKIP': // no tournament / mock mode — behave as "no draws"
      return initialState
    case 'FETCH_ERROR':
      return { draws: [], loading: false, error: action.error }
    default:
      return state
  }
}

export function useBountyDraws(tournamentId) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    if (!tournamentId) {
      dispatch({ type: 'FETCH_SKIP' })
      return undefined
    }
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    bountyDrawsApi
      .listBountyDraws(tournamentId)
      .then((draws) => {
        if (!cancelled) dispatch({ type: 'FETCH_SUCCESS', draws })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_SKIP' })
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
