// A player's tournament activity across every tournament — backs the Activity tab
// on the player detail page (which tournaments they've played, buy-ins, winnings).
//
// Uses the `entries` collection-group query (listEntriesByPlayer — needs the
// playerId + registeredAt composite index in production; works on the emulator),
// then resolves each referenced tournament's name so the table can show it. A
// missing tournament is tolerated (the entry still shows, name "—"). Pure-mock
// surfaces as `mockMode`.

import { useCallback, useEffect, useReducer } from 'react'
import { entries as entriesApi, tournaments as tournamentsApi, MockModeError } from '../lib/firestore'

const initialState = {
  entries: [],
  tournamentNameById: {},
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
        ...initialState,
        loading: false,
        entries: action.entries,
        tournamentNameById: action.tournamentNameById,
      }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

export function usePlayerActivity(playerId) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    entriesApi
      .listEntriesByPlayer(playerId)
      .then(async (rows) => {
        const ids = [...new Set(rows.map((e) => e.tournamentId))]
        const settled = await Promise.allSettled(ids.map((id) => tournamentsApi.getTournament(id)))
        const tournamentNameById = {}
        settled.forEach((r, i) => {
          if (r.status === 'fulfilled') tournamentNameById[ids[i]] = r.value.name
        })
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', entries: rows, tournamentNameById })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
        else dispatch({ type: 'FETCH_ERROR', error: e })
      })
    return () => {
      cancelled = true
    }
  }, [playerId])

  useEffect(() => fetchOnce(), [fetchOnce])

  const reload = useCallback(() => {
    fetchOnce()
  }, [fetchOnce])

  return { ...state, reload }
}
