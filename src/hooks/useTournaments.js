// List hook behind the tournament list page (task 2.2).
//
// Tournaments are a moderate-volume collection and the list page filters by
// status client-side, so — like useTemplates — we fetch the whole collection in
// one shot, drop archived rows client-side, and expose `reload` for after a
// create/edit/archive. Ordering by scheduledStartTime is done server-side
// (newest first); that also naturally excludes any legacy Casinoware-shape docs
// that predate the Phase-2 schema, since they lack the field.
//
// Mock-mode (pure mock, no emulator) surfaces as a `mockMode` flag rather than a
// thrown error, matching useAuditLog / useTemplates.

import { useCallback, useEffect, useReducer } from 'react'
import { query, orderBy } from 'firebase/firestore'
import { tournaments, MockModeError } from '../lib/firestore'

const initialState = {
  tournaments: [],
  loading: true,
  error: null,
  mockMode: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return { ...initialState, loading: false, tournaments: action.tournaments }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

const byScheduledDesc = (c) => query(c, orderBy('scheduledStartTime', 'desc'))

export function useTournaments() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    tournaments
      .listTournaments(byScheduledDesc)
      .then((rows) => {
        if (cancelled) return
        const active = rows.filter((t) => t.archivedAt === null)
        dispatch({ type: 'FETCH_SUCCESS', tournaments: active })
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
