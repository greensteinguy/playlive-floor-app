// Schema for the `tournaments` top-level collection.
// Mirrors docs/schema/canonical-schema.md §3.1.

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  NonEmptyString,
  Money,
  ChipCount,
  AuditFields,
  ArchiveField,
  FirestoreTimestamp,
  NullableTimestamp,
} from './_shared'
import { Structure } from './structure'
import { PayoutStructure } from './payoutStructure'

const GameType = z.enum([
  'nlh',
  'plo',
  'plo5',
  'omaha',
  'horse',
  'stud',
  'mixed',
  'mainEvent',
  'mysteryBounty',
  'satellite',
])

const Status = z.enum([
  'draft',
  'scheduled',
  'lateRegOpen',
  'lateRegClosed',
  'finished',
  'cancelled',
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
  .superRefine((cfg, ctx) => {
    // The sum of individual bountyValues should equal totalPool.
    // Tolerated drift = 0 because everything is integer cents.
    const sum = cfg.bountyValues.reduce((acc, v) => acc + v, 0)
    if (sum !== cfg.totalPool) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalPool'],
        message: `sum of bountyValues (${sum}) must equal totalPool (${cfg.totalPool})`,
      })
    }
  })

export const Tournament = z
  .object({
    // Identity
    id: DocumentId,
    legacyId: z.number().int().nullable(),

    // Naming & display
    name: NonEmptyString,
    shortDescription: z.string(),

    // Format flags (denormalized from sessions subcollection; see §5.1)
    isMultiDay: z.boolean(),
    isMultiFlight: z.boolean(),

    gameType: GameType,

    // Money (integer cents AUD)
    buyIn: Money,
    hospitalityCost: Money,
    guarantee: Money,
    houseConsumption: Money,

    // Structure
    structureTemplateId: DocumentRef.nullable(),
    startingStack: ChipCount,
    structure: Structure,

    // Payout structure (embedded)
    payoutStructure: PayoutStructure,

    // Scheduling
    scheduledStartTime: FirestoreTimestamp,
    lateRegCutoffTime: NullableTimestamp,

    // Status (status + isOnBreak + pausedAt are independent)
    status: Status,
    isOnBreak: z.boolean(),
    pausedAt: NullableTimestamp,

    // Reentry
    reentryConfig: ReentryConfig,

    // Side bets
    hasUpperDeckMainDeck: z.boolean(),

    // Format-specific configs (null when not the matching format)
    satelliteConfig: SatelliteConfig.nullable(),
    bountyPoolConfig: BountyPoolConfig.nullable(),

    // Template / recurrence link
    fromTemplateId: DocumentRef.nullable(),

    // Live state
    currentStructureIndex: z.number().int().nonnegative().nullable(),

    // Derived counters
    entryCount: z.number().int().nonnegative(),
    uniquePlayerCount: z.number().int().nonnegative(),
    remainingPlayerCount: z.number().int().nonnegative(),
    totalPrizePool: Money,

    // Lifecycle
    finishedAt: NullableTimestamp,

    // Standard
    ...AuditFields,
    ...ArchiveField,
  })
  .strict()
  .superRefine((t, ctx) => {
    // Invariant: isMultiFlight implies isMultiDay.
    if (t.isMultiFlight && !t.isMultiDay) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isMultiFlight'],
        message: 'isMultiFlight=true requires isMultiDay=true',
      })
    }

    // Invariant: satelliteConfig set iff gameType is 'satellite'.
    if (t.gameType === 'satellite' && t.satelliteConfig === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['satelliteConfig'],
        message: 'satelliteConfig is required when gameType is "satellite"',
      })
    }
    if (t.gameType !== 'satellite' && t.satelliteConfig !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['satelliteConfig'],
        message: 'satelliteConfig must be null when gameType is not "satellite"',
      })
    }

    // Invariant: bountyPoolConfig set iff gameType is 'mysteryBounty'.
    if (t.gameType === 'mysteryBounty' && t.bountyPoolConfig === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bountyPoolConfig'],
        message: 'bountyPoolConfig is required when gameType is "mysteryBounty"',
      })
    }
    if (t.gameType !== 'mysteryBounty' && t.bountyPoolConfig !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bountyPoolConfig'],
        message: 'bountyPoolConfig must be null when gameType is not "mysteryBounty"',
      })
    }

    // Invariant: currentStructureIndex (when set) must be in bounds of structure.
    if (t.currentStructureIndex !== null && t.currentStructureIndex >= t.structure.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentStructureIndex'],
        message: `currentStructureIndex (${t.currentStructureIndex}) is out of bounds for structure (length ${t.structure.length})`,
      })
    }
  })
