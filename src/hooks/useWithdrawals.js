// Withdrawal-request list hook behind the /desk/withdrawals queue (task 4.8).
//
// One-shot whole-collection fetch + `reload`, ordered newest-first server-side
// (a single-field orderBy needs no composite index — the queue page filters by
// state and re-sorts queue-first client-side, matching how useTournaments /
// useWalletTransactions avoid index sprawl). The collection is low-volume:
// withdrawals are a few-a-day desk flow. Mock-mode (pure mock, no emulator)
// surfaces as a flag, matching the other list hooks — never a thrown UI error.

import { useCallback, useEffect, useReducer } from 'react'
import { query, orderBy } from 'firebase/firestore'
import { withdrawalRequests as withdrawalsApi, MockModeError } from '../lib/firestore'

const initialState = {
  withdrawals: [],
  loading: true,
  error: null,
  mockMode: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'FETCH_START':
      return { ...initialState, loading: true }
    case 'FETCH_SUCCESS':
      return { ...initialState, loading: false, withdrawals: action.withdrawals }
    case 'FETCH_MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'FETCH_ERROR':
      return { ...initialState, loading: false, error: action.error }
    default:
      return state
  }
}

const byRequestedDesc = (c) => query(c, orderBy('requestedAt', 'desc'))

export function useWithdrawals() {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    withdrawalsApi
      .listWithdrawalRequests(byRequestedDesc)
      .then((rows) => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', withdrawals: rows })
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
