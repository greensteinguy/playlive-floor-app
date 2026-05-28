// Schema for the embedded payout structure on tournaments.
//
// Either 'byPlace' (each position has an absolute payout) or 'byPercent' (each
// position has a percentage of the prize pool). Rounding rule applies when
// percentages are converted to cash at tournament end.

import { z } from 'zod'
import { Money } from './_shared'

const PayoutPosition = z
  .object({
    place: z.number().int().positive(),
    payout: Money,
    percent: z.number().min(0).max(1).nullable(),
  })
  .strict()

export const PayoutStructure = z
  .object({
    type: z.enum(['byPlace', 'byPercent']),
    rounding: z.enum(['nearest5', 'nearest10', 'none']),
    positions: z.array(PayoutPosition).min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    // Cross-field invariant: 'byPercent' positions must carry a percent value;
    // 'byPlace' positions don't need one (the absolute payout is authoritative).
    if (p.type === 'byPercent') {
      p.positions.forEach((pos, i) => {
        if (pos.percent === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['positions', i, 'percent'],
            message: 'percent is required for byPercent payout structures',
          })
        }
      })
    }
    // 'place' values should be sequential 1, 2, 3, ... (no gaps, no duplicates).
    const places = p.positions.map((pos) => pos.place).sort((a, b) => a - b)
    for (let i = 0; i < places.length; i++) {
      if (places[i] !== i + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['positions'],
          message: `position 'place' values must be sequential 1..N; got [${places.join(', ')}]`,
        })
        break
      }
    }
  })
