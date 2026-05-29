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
    // Add-on is variable: when offered, both its cost (money) and the chips it
    // grants are set; both are null when no add-on is offered.
    hasAddOn: z.boolean(),
    addOnCost: Money.nullable(),
    addOnChips: ChipCount.nullable(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.hasAddOn) {
      if (cfg.addOnCost === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addOnCost'],
          message: 'addOnCost is required when hasAddOn is true',
        })
      }
      if (cfg.addOnChips === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addOnChips'],
          message: 'addOnChips is required when hasAddOn is true',
        })
      }
    } else {
      if (cfg.addOnCost !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addOnCost'],
          message: 'addOnCost must be null when hasAddOn is false',
        })
      }
      if (cfg.addOnChips !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addOnChips'],
          message: 'addOnChips must be null when hasAddOn is false',
        })
      }
    }
  })

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
