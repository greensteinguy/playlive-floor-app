// Schema for the `tournamentTemplates` top-level collection.
// Mirrors docs/schema/canonical-schema.md §3.5.
//
// Templates carry the STATIC tournament config. Recurrence is NOT a property
// of a template — it's a choice the manager makes at tournament-creation time
// (the system bulk-creates N tournament instances upfront for the chosen window).
// See canonical-schema.md §3.5 and DECISIONS.md.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  NonEmptyString,
  Money,
  ChipCount,
  AuditFields,
  ArchiveField,
} from './_shared'

// Same enum as Tournament. Duplicated here intentionally to keep this schema
// self-contained — if tournaments' enum grows we may want to update both.
const GameType = z.enum([
  'nlh', 'plo', 'plo5', 'omaha', 'horse', 'stud',
  'mixed', 'mainEvent', 'mysteryBounty', 'satellite',
])

const ReentryConfig = z
  .object({
    type: z.enum(['freezeout', 'reentry', 'rebuy']),
    maxReentries: z.number().int().nonnegative().nullable(),
    maxRebuys: z.number().int().nonnegative().nullable(),
    hasAddOn: z.boolean(),
  })
  .strict()

const SatelliteConfig = z
  .object({
    ticketReward: Money,
  })
  .strict()

const BountyPoolConfig = z
  .object({
    totalPool: Money,
    bountyValues: z.array(Money).min(1),
  })
  .strict()

// Tournament config the template represents. Same field shape as the equivalent
// fields on Tournament (sans live-state, derived counters, and lifecycle).
const TemplateConfig = z
  .object({
    name: NonEmptyString,
    shortDescription: z.string(),
    isMultiDay: z.boolean(),
    isMultiFlight: z.boolean(),
    gameType: GameType,

    buyIn: Money,
    hospitalityCost: Money,
    guarantee: Money,
    houseConsumption: Money,

    structureTemplateId: DocumentRef.nullable(),
    startingStack: ChipCount,

    reentryConfig: ReentryConfig,
    hasUpperDeckMainDeck: z.boolean(),

    satelliteConfig: SatelliteConfig.nullable(),
    bountyPoolConfig: BountyPoolConfig.nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.isMultiFlight && !c.isMultiDay) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isMultiFlight'],
        message: 'isMultiFlight=true requires isMultiDay=true',
      })
    }
  })

export const TournamentTemplate = z
  .object({
    id: DocumentId,
    name: NonEmptyString,
    description: z.string().nullable(),

    config: TemplateConfig,

    ...AuditFields,
    ...ArchiveField,
  })
  .strict()
