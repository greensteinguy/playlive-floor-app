// Data behind the seating page (task 3.7): the tournament, its sessions (tables
// are per-session, so the page picks which session to seat), its tables (the live
// seat state), and its entries (who needs a seat + the seat denormalization).
//
// One-shot fetch + `reload` (NOT a subscription) — the page reloads after each
// draw / clear / seat move so the grid and the unseated pool stay current. Mirrors
// useRegistration: missing tournament → `notFound`, pure-mock → `mockMode`,
// neither a thrown UI error.

import { useCallback, useEffect, useReducer } from 'react'
import {
  tournaments,
  sessions as sessionsApi,
  tables as tablesApi,
  entries as entriesApi,
  MockModeError,
  NotFoundError,
} from '../lib/firestore'

const initialState = {
  tournament: null,
  sessions: [],
  tables: [],
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
        tables: action.tables,
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

export function useSeating(id) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    if (!id) return undefined
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    Promise.all([
      tournaments.getTournament(id),
      sessionsApi.listSessions(id),
      tablesApi.listTables(id),
      entriesApi.listEntries(id),
    ])
      .then(([tournament, sessions, tables, entries]) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', tournament, sessions, tables, entries })
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
