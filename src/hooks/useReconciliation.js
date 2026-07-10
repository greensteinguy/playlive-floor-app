// Cross-player wallet-transaction window hook for the end-of-day
// reconciliation view (task 4.9).
//
// One-shot fetch of every walletTransaction in a { since, until } window via
// the collection-group query (`listAllWalletTransactions`), plus `reload` for
// after-the-till-count refreshes. The page derives BOTH the summary (via the
// pure `buildReconciliationReport`) and the detail table from the same rows,
// so one query serves the whole screen.
//
// Mock-mode (pure mock, no emulator) surfaces as a flag, matching
// useWalletTransactions / useAuditLog — never a thrown UI error.
//
// NOTE: the collection-group query needs the `walletTransactions.timestamp`
// COLLECTION_GROUP index — declared in firestore.indexes.json; deploy with
// `firebase deploy --only firestore` before this works in production.

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { walletTransactions as walletTxApi, MockModeError } from '../lib/firestore'

const initialState = {
  transactions: [],
  loading: true,
  error: null,
  mockMode: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return { ...initialState, loading: false, transactions: action.transactions }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

/**
 * @param {{ since?: Date, until?: Date }} range — venue-local day boundaries
 *   (see reconDateRange). Either end may be undefined for an open range.
 */
export function useReconciliation({ since, until }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Serialize the range so a fresh-but-equal Date pair from the caller's
  // render doesn't restart the effect (same trick as useAuditLog).
  const rangeKey = useMemo(
    () => JSON.stringify({ since: since?.toISOString() ?? null, until: until?.toISOString() ?? null }),
    [since, until]
  )

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    walletTxApi
      .listAllWalletTransactions({ since, until })
      .then((rows) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', transactions: rows })
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof MockModeError) dispatch({ type: 'FETCH_MOCK' })
        else dispatch({ type: 'FETCH_ERROR', error: e })
      })
    return () => {
      cancelled = true
    }
    // rangeKey captures since/until — see the memo above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey])

  useEffect(() => fetchOnce(), [fetchOnce])

  const reload = useCallback(() => {
    fetchOnce()
  }, [fetchOnce])

  return { ...state, reload }
}
