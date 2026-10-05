// Schema for the `settings/venue` document — venue-wide configuration that
// isn't tied to one tournament. One doc, id 'venue'.
//
// chipDenominations: every chip value that physically exists at the venue
// (Guy, 6 Oct 2026). Structures pick their smallest chip from this list, and
// colour-ups walk up it — see src/lib/chips.js.

import { z } from 'zod'
import { DocumentId, NonEmptyString, FirestoreTimestamp } from './_shared'

export const VENUE_SETTINGS_ID = 'venue'

export const VenueSettings = z
  .object({
    id: DocumentId,
    chipDenominations: z
      .array(z.number().int().positive())
      .min(1, 'At least one chip denomination is required.')
      .refine((list) => new Set(list).size === list.length, 'Chip denominations must be unique.'),
    updatedAt: FirestoreTimestamp,
    updatedBy: NonEmptyString,
  })
  .strict()
