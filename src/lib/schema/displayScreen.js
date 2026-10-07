// Schema for the `displayScreens` top-level collection — the venue's named TV
// screens (7 Oct 2026). Each physical TV opens a permanent URL,
// /display/<id>, once; what it shows is set here from the app and lands on the
// TV live, so nobody has to touch the TV to change it.
//
// id is the URL slug (lowercase letters, digits, hyphens — see
// lib/display.js slugifyScreenId). tournamentId null = rotate every live
// tournament; screen null = clock and prizes both.

import { z } from 'zod'
import { DocumentId, NonEmptyString, FirestoreTimestamp } from './_shared'

export const SCREEN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const DisplayScreen = z
  .object({
    id: DocumentId.regex(SCREEN_ID_PATTERN, 'Screen id must be lowercase letters, digits and hyphens.'),
    name: NonEmptyString,
    tournamentId: NonEmptyString.nullable(),
    screen: z.enum(['clock', 'prizes']).nullable(),
    createdAt: FirestoreTimestamp,
    createdBy: NonEmptyString,
    updatedAt: FirestoreTimestamp,
    updatedBy: NonEmptyString,
  })
  .strict()
