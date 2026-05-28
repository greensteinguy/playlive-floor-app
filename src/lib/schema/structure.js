// Schema for the embedded blind structure on tournaments and structureTemplates.
//
// The structure is a flat sequenced array of either `level` or `break` entries.
// Breaks are first-class steps in the structure — they take real time at designated
// points. Only `level` entries have a `blindNumber`; the `blindNumber` field
// increments across levels only, not across breaks.

import { z } from 'zod'
import { ChipCount } from './_shared'

export const LevelEntry = z
  .object({
    type: z.literal('level'),
    blindNumber: z.number().int().positive(),
    smallBlind: ChipCount,
    bigBlind: ChipCount,
    ante: ChipCount,
    bringIn: ChipCount,
    durationMinutes: z.number().int().positive(),
  })
  .strict()

export const BreakEntry = z
  .object({
    type: z.literal('break'),
    durationMinutes: z.number().int().positive(),
    label: z.string().nullable(),
    isColorUp: z.boolean(),
  })
  .strict()

export const StructureEntry = z.discriminatedUnion('type', [LevelEntry, BreakEntry])

/**
 * A full structure array. Validates each entry, plus the cross-entry invariant
 * that level entries' blindNumber values are sequential 1, 2, 3, ... (no gaps,
 * no duplicates; breaks don't get a number).
 */
export const Structure = z.array(StructureEntry).superRefine((entries, ctx) => {
  let expectedBlindNumber = 1
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.type === 'level') {
      if (entry.blindNumber !== expectedBlindNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'blindNumber'],
          message: `expected blindNumber ${expectedBlindNumber} (sequential across level entries; breaks are skipped), got ${entry.blindNumber}`,
        })
      }
      expectedBlindNumber++
    }
  }
})
