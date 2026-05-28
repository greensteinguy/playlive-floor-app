// Hook backing the audit log viewer page. Encapsulates:
//   - filter state (dateRange / actionType / actorId / targetType+targetId)
//   - paginated fetch (50 per page, timestamp-cursor)
//   - mock-mode handling (returns an empty page + a `mockMode` flag instead of
//     surfacing MockModeError)
//   - export-all (refetches without the page limit, for CSV download)
//
// The query construction is centralized in `buildQuery` below so the paginated
// fetch and the export-all path produce identical filter behaviour.
//
// State is managed via useReducer so the effect body only issues a single
// dispatch (preferred over multiple setState calls — see
// react-hooks/set-state-in-effect lint rule).

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { Timestamp, query, where, orderBy, limit, startAfter } from 'firebase/firestore'
import { auditLog, MockModeError } from '../lib/firestore'

const PAGE_SIZE = 50
const EXPORT_MAX = 10_000 // safety cap so a CSV export can't run unbounded

const initialState = {
  entries: [],
  loading: true,
  error: null,
  mockMode: false,
  hasMore: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      // Reset for a fresh first-page fetch (filter change or mount).
      return { entries: [], loading: true, error: null, mockMode: false, hasMore: false }
    case 'LOAD_MORE_START':
      return { ...state, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        entries: action.rows,
        hasMore: action.rows.length === PAGE_SIZE,
      }
    case 'LOAD_MORE_SUCCESS':
      return {
        ...state,
        loading: false,
        entries: [...state.entries, ...action.rows],
        hasMore: action.rows.length === PAGE_SIZE,
      }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error }
    case 'FETCH_MOCK':
      return { ...state, loading: false, mockMode: true, entries: [], hasMore: false }
    default:
      return state
  }
}

/**
 * Build a Firestore query function from a filter set + optional cursor.
 * Used both for the paginated fetch and the export-all fetch.
 */
function buildQuery(filters, { cursor, pageSize }) {
  const constraints = []

  if (filters.actionType) constraints.push(where('actionType', '==', filters.actionType))
  if (filters.actorId)    constraints.push(where('actorId',    '==', filters.actorId))
  if (filters.targetType) constraints.push(where('targetType', '==', filters.targetType))
  if (filters.targetId)   constraints.push(where('targetId',   '==', filters.targetId))
  if (filters.since) constraints.push(where('timestamp', '>=', Timestamp.fromDate(filters.since)))
  if (filters.until) constraints.push(where('timestamp', '<=', Timestamp.fromDate(filters.until)))

  constraints.push(orderBy('timestamp', 'desc'))
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(pageSize))

  return (c) => query(c, ...constraints)
}

/**
 * The hook.
 *
 * @param {object} filters - { actionType?, actorId?, targetType?, targetId?, since?, until? }
 *   Pass an object reference that is stable between renders (e.g. via useState
 *   on the viewer page). When any filter changes, the hook resets and refetches
 *   from page 1.
 */
export function useAuditLog(filters) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const { entries, loading, error, mockMode, hasMore } = state

  // Serialize filter to a stable key so an object-identity change of `filters`
  // (which happens every render in the caller) doesn't restart the effect.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        actionType: filters.actionType ?? null,
        actorId:    filters.actorId    ?? null,
        targetType: filters.targetType ?? null,
        targetId:   filters.targetId   ?? null,
        since: filters.since?.toISOString() ?? null,
        until: filters.until?.toISOString() ?? null,
      }),
    [filters.actionType, filters.actorId, filters.targetType, filters.targetId, filters.since, filters.until]
  )

  useEffect(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })

    auditLog
      .listAuditLog(buildQuery(filters, { cursor: null, pageSize: PAGE_SIZE }))
      .then((rows) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', rows })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
        else dispatch({ type: 'FETCH_ERROR', error: e })
      })

    return () => {
      cancelled = true
    }
    // filterKey captures every input we actually read inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])

  /** Load the next page, appending to `entries`. No-op if there's nothing more. */
  const loadMore = useCallback(async () => {
    if (!hasMore || loading || entries.length === 0) return
    const cursor = entries[entries.length - 1].timestamp
    dispatch({ type: 'LOAD_MORE_START' })
    try {
      const rows = await auditLog.listAuditLog(
        buildQuery(filters, { cursor, pageSize: PAGE_SIZE })
      )
      dispatch({ type: 'LOAD_MORE_SUCCESS', rows })
    } catch (e) {
      if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
      else dispatch({ type: 'FETCH_ERROR', error: e })
    }
  }, [hasMore, loading, entries, filters])

  /**
   * Fetch every row matching the current filters (up to EXPORT_MAX), for CSV
   * export. Independent of pagination state. Returns an array; throws on error
   * so the caller can show a toast.
   */
  const exportAll = useCallback(async () => {
    const rows = await auditLog.listAuditLog(
      buildQuery(filters, { cursor: null, pageSize: EXPORT_MAX })
    )
    return {
      rows,
      truncated: rows.length === EXPORT_MAX,
      limit: EXPORT_MAX,
    }
  }, [filters])

  return { entries, loading, error, mockMode, hasMore, loadMore, exportAll }
}
