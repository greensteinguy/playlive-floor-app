// Live queues for the /desk/app-requests screen (Phase 6.2): pending Player
// App registration requests + pending account-link requests. LIVE
// subscriptions (unlike the one-shot withdrawals hook) because these arrive
// from players' phones while the desk screen sits open — the queue must grow
// by itself. Each registration request is hydrated with its player +
// tournament docs for display.

import { useEffect, useMemo, useReducer } from 'react'
import { query, where, orderBy } from 'firebase/firestore'
import {
  registrationRequests as regReqApi,
  linkRequests as linkReqApi,
  players as playersApi,
  tournaments as tournamentsApi,
} from '../lib/firestore'

const initialState = {
  regRequests: [],
  linkRequests: [],
  playersById: {},
  tournamentsById: {},
  loading: true,
  error: null,
  mockMode: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'REG_ROWS':
      return { ...state, regRequests: action.rows, loading: false }
    case 'LINK_ROWS':
      return { ...state, linkRequests: action.rows, loading: false }
    case 'HYDRATE':
      return {
        ...state,
        playersById: { ...state.playersById, ...action.players },
        tournamentsById: { ...state.tournamentsById, ...action.tournaments },
      }
    case 'MOCK':
      return { ...initialState, loading: false, mockMode: true }
    case 'ERROR':
      return { ...state, loading: false, error: action.error }
    default:
      return state
  }
}

const pendingByRequested = (c) => query(c, where('state', '==', 'pending'), orderBy('requestedAt', 'asc'))

export function useAppRequests() {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    let unsubs = []
    try {
      unsubs = [
        regReqApi.subscribeToRegistrationRequests(
          (rows) => dispatch({ type: 'REG_ROWS', rows }),
          pendingByRequested,
          (e) => dispatch({ type: 'ERROR', error: e })
        ),
        linkReqApi.subscribeToLinkRequests(
          (rows) => dispatch({ type: 'LINK_ROWS', rows }),
          pendingByRequested,
          (e) => dispatch({ type: 'ERROR', error: e })
        ),
      ]
    } catch {
      // Pure mock mode — the data layer throws MockModeError synchronously.
      dispatch({ type: 'MOCK' })
    }
    return () => unsubs.forEach((u) => u?.())
  }, [])

  // Hydrate player + tournament docs the rows reference but we haven't loaded.
  const missing = useMemo(() => {
    const players = new Set()
    const tournaments = new Set()
    state.regRequests.forEach((r) => {
      if (!state.playersById[r.playerId]) players.add(r.playerId)
      if (!state.tournamentsById[r.tournamentId]) tournaments.add(r.tournamentId)
    })
    state.linkRequests.forEach((r) =>
      r.candidatePlayerIds.forEach((pid) => {
        if (!state.playersById[pid]) players.add(pid)
      })
    )
    return { players: [...players], tournaments: [...tournaments] }
  }, [state.regRequests, state.linkRequests, state.playersById, state.tournamentsById])

  useEffect(() => {
    if (missing.players.length === 0 && missing.tournaments.length === 0) return
    let cancelled = false
    Promise.all([
      Promise.all(missing.players.map((id) => playersApi.getPlayer(id).catch(() => null))),
      Promise.all(missing.tournaments.map((id) => tournamentsApi.getTournament(id).catch(() => null))),
    ]).then(([players, tournaments]) => {
      if (cancelled) return
      dispatch({
        type: 'HYDRATE',
        players: Object.fromEntries(players.filter(Boolean).map((p) => [p.id, p])),
        tournaments: Object.fromEntries(tournaments.filter(Boolean).map((t) => [t.id, t])),
      })
    })
    return () => {
      cancelled = true
    }
  }, [missing])

  return state
}
