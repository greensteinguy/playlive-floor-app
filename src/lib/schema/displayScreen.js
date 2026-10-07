// Schema for the `displayScreens` top-level collection — the venue's named TV
// screens (7 Oct 2026). Each physical TV opens a permanent URL,
// /display/<id>, once; what it shows is set here from the app and lands on the
// TV live, so nobody has to touch the TV to change it.
//
// id is the URL slug (lowercase letters, digits, hyphens — see
// lib/display.js slugifyScreenId). kind 'tournament' shows one tournament
// (tournamentId; null = nothing assigned yet) as clock, prizes or both
// (screen null); kind 'today' is the list of today's tournaments (desk TV).
//
// Sets (displayGroups): a TV belongs to at most one set (groupId). While
// followGroup is true it shows the set's pick; dropping a tournament on the
// TV alone sets its own fields and followGroup false. See resolveScreenConfig
// in lib/display.js.

import { z } from 'zod'
import { DocumentId, NonEmptyString, FirestoreTimestamp } from './_shared'

// What a TV shows — see SCREEN_KINDS in lib/display.js.
const ScreenKind = z.enum(['tournament', 'today']).default('tournament')

export const SCREEN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const DisplayScreen = z
  .object({
    id: DocumentId.regex(SCREEN_ID_PATTERN, 'Screen id must be lowercase letters, digits and hyphens.'),
    name: NonEmptyString,
    kind: ScreenKind,
    tournamentId: NonEmptyString.nullable(),
    screen: z.enum(['clock', 'prizes']).nullable(),
    groupId: NonEmptyString.nullable().default(null),
    followGroup: z.boolean().default(true),
    createdAt: FirestoreTimestamp,
    createdBy: NonEmptyString,
    updatedAt: FirestoreTimestamp,
    updatedBy: NonEmptyString,
  })
  .strict()

// A set of TVs that usually shows one thing (e.g. "Main room"). Not part of
// any URL, so its id is a generated one.
export const DisplayGroup = z
  .object({
    id: DocumentId,
    name: NonEmptyString,
    kind: ScreenKind,
    tournamentId: NonEmptyString.nullable(),
    screen: z.enum(['clock', 'prizes']).nullable(),
    createdAt: FirestoreTimestamp,
    createdBy: NonEmptyString,
    updatedAt: FirestoreTimestamp,
    updatedBy: NonEmptyString,
  })
  .strict()
