// Typed access to the single `settings/venue` document (venue-wide config).
//
// The doc may not exist yet — a fresh venue has never saved settings — so the
// subscription reports `null` for "missing" rather than an error, and callers
// fall back to the defaults in src/lib/chips.js.

import { Timestamp } from 'firebase/firestore'
import { VenueSettings, VENUE_SETTINGS_ID } from '../schema'
import { subscribeToDoc, validatedSet } from './_client'
import { NotFoundError } from './_errors'
import { settingsPath } from './_paths'

export function subscribeToVenueSettings(onUpdate, onError = () => {}) {
  return subscribeToDoc(settingsPath(VENUE_SETTINGS_ID), VenueSettings, onUpdate, (err) =>
    err instanceof NotFoundError ? onUpdate(null) : onError(err)
  )
}

export function saveVenueSettings({ chipDenominations }, actorId) {
  return validatedSet(settingsPath(VENUE_SETTINGS_ID), VenueSettings, {
    chipDenominations,
    updatedAt: Timestamp.now(),
    updatedBy: actorId,
  })
}
