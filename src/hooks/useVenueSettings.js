// Live venue settings (settings/venue) with the defaults filled in. Pure mock
// mode, a missing doc, or a read error all fall back to the defaults so the
// structure editor always has a chip set to check against.

import { useEffect, useState } from 'react'
import { USE_MOCK_DATA, USE_EMULATOR } from '../firebase/config'
import { venueSettings as venueSettingsApi } from '../lib/firestore'
import { DEFAULT_CHIP_DENOMINATIONS, normaliseChips } from '../lib/chips'

// Pure mock mode has no Firestore at all (the data layer throws), so there's
// nothing to subscribe to — known up front rather than discovered in the effect.
const PURE_MOCK = USE_MOCK_DATA && !USE_EMULATOR

export function useVenueSettings() {
  const [state, setState] = useState({ settings: null, loading: !PURE_MOCK, error: null })

  useEffect(() => {
    if (PURE_MOCK) return undefined
    const unsub = venueSettingsApi.subscribeToVenueSettings(
      (settings) => setState({ settings, loading: false, error: null }),
      (error) => setState((s) => ({ ...s, loading: false, error }))
    )
    return () => unsub()
  }, [])

  const saved = state.settings?.chipDenominations
  return {
    ...state,
    mockMode: PURE_MOCK,
    chipDenominations: saved ? normaliseChips(saved) : DEFAULT_CHIP_DENOMINATIONS,
    isDefault: !saved,
  }
}
