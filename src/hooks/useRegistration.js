// Data behind the tournament registration page (task 3.4): the tournament, its
// sessions (to pick the flight a new entry joins), and its entries (to plan the
// entry — initial vs re-entry — and to refresh the counters after a buy-in).
//
// One-shot fetch + `reload`, NOT a subscription — the page holds an in-progress
// registration and reloads itself after each successful buy-in to refresh the
// entries/duplicate state. A missing tournament surfaces as `notFound`, pure-mock
// as `mockMode` — neither is a thrown UI error (matches useTournament).

import { useCallback, useEffect, useReducer } from 'react'
import {
  tournaments,
  sessions as sessionsApi,
  entries as entriesApi,
  MockModeError,
  NotFoundError,
} from '../lib/firestore'

const initialState = {
  tournament: null,
  sessions: [],
  entries: [],
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
      return {
        ...initialState,
        loading: false,
        tournament: action.tournament,
        sessions: action.sessions,
        entries: action.entries,
      }
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

export function useRegistration(id) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    Promise.all([
      tournaments.getTournament(id),
      sessionsApi.listSessions(id),
      entriesApi.listEntries(id),
    ])
      .then(([tournament, sessions, entries]) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', tournament, sessions, entries })
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
