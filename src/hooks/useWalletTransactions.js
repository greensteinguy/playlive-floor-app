// Per-player wallet-transaction list hook.
//
// One-shot whole-subcollection fetch + `reload`, ordered newest-first
// server-side (a single-field orderBy needs no composite index). The
// player-profile Wallet & tickets tab uses it to surface deposits (task 3.6);
// the full per-player ledger (task 3.11) grows from the same data. Mock-mode
// (pure mock, no emulator) surfaces as a flag, matching usePlayers /
// useTournaments — never a thrown UI error.

import { useCallback, useEffect, useReducer } from 'react'
import { query, orderBy } from 'firebase/firestore'
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

const byTimestampDesc = (c) => query(c, orderBy('timestamp', 'desc'))

export function useWalletTransactions(playerId) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchOnce = useCallback(() => {
    if (!playerId) return undefined
    let cancelled = false
    dispatch({ type: 'FETCH_START' })
    walletTxApi
      .listWalletTransactions(playerId, byTimestampDesc)
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
  }, [playerId])

  useEffect(() => fetchOnce(), [fetchOnce])

  const reload = useCallback(() => {
    fetchOnce()
  }, [fetchOnce])

  return { ...state, reload }
}
