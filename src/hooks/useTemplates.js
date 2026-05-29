// List hooks behind the template-management pages and the create-wizard pickers.
//
// Templates are low-volume (a handful each), so — like useDuplicateCandidates —
// we fetch the whole collection in one shot, drop archived rows client-side, and
// sort by name. `reload` refetches after a create/edit/archive.

import { useCallback, useEffect, useReducer } from 'react'
import { structureTemplates, tournamentTemplates, MockModeError } from '../lib/firestore'

const initialState = {
  templates: [],
  loading: true,
  error: null,
  mockMode: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return { ...initialState, loading: false, templates: action.templates }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

const byName = (a, b) => a.name.localeCompare(b.name)

function useTemplateList(listFn) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    listFn()
      .then((rows) => {
        if (cancelled) return
        const active = rows.filter((t) => t.archivedAt === null).sort(byName)
        dispatch({ type: 'FETCH_SUCCESS', templates: active })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
        else dispatch({ type: 'FETCH_ERROR', error: e })
      })
    return () => {
      cancelled = true
    }
  }, [listFn])

  useEffect(() => fetchOnce(), [fetchOnce])

  const reload = useCallback(() => {
    fetchOnce()
  }, [fetchOnce])

  return { ...state, reload }
}

export function useStructureTemplates() {
  return useTemplateList(structureTemplates.listStructureTemplates)
}

export function useTournamentTemplates() {
  return useTemplateList(tournamentTemplates.listTournamentTemplates)
}
