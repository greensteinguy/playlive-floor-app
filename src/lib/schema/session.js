// Schema for the `tournaments/{tid}/sessions` subcollection.
// Mirrors docs/schema/canonical-schema.md §5.1.
//
// Key concepts:
//   - Routing is via convergesIntoSessionId only (explicit FK to next session).
//     dayNumber / flightLabel / sessionLabel are display/query metadata, never
//     used for routing decisions.
//   - Slice has TWO pairs of indices:
//       maximumStart/EndIndex — the cap (set at session creation; maximumEnd is
//       nullable for "play to a winner" final sessions).
//       actualStart/EndIndex  — what really gets played (set at runtime; can
//       differ from maximum due to rollback or playToPercentRemaining tripping).
//   - playToPercentRemaining is an early-termination criterion (e.g., 15 = end
//     when 15% of the starting field remains).

import { z } from 'zod'
import {
  DocumentId,
  DocumentRef,
  NonEmptyString,
  FirestoreTimestamp,
  NullableTimestamp,
  AuditFields,
} from './_shared'

const Status = z.enum(['scheduled', 'inProgress', 'finished', 'cancelled'])

export const Session = z
  .object({
    id: DocumentId,
    tournamentId: DocumentRef,

    // Routing (authoritative — never derive from day/flight)
    convergesIntoSessionId: DocumentRef.nullable(),

    // Display / query metadata
    dayNumber: z.number().int().positive(),
    flightLabel: z.string().nullable(),
    sessionLabel: NonEmptyString,

    // Slice caps (manager intent at setup)
    maximumStartIndex: z.number().int().nonnegative(),
    maximumEndIndex: z.number().int().nonnegative().nullable(),

    // Termination criterion
    playToPercentRemaining: z.number().min(0).max(100).nullable(),

    // Runtime: actual slice played
    actualStartIndex: z.number().int().nonnegative().nullable(),
    actualEndIndex: z.number().int().nonnegative().nullable(),

    // Scheduling
    scheduledStartTime: FirestoreTimestamp,
    actualStartTime: NullableTimestamp,
    actualEndTime: NullableTimestamp,

    status: Status,

    // Live state
    currentStructureIndex: z.number().int().nonnegative().nullable(),
    remainingPlayerCount: z.number().int().nonnegative().nullable(),

    ...AuditFields,
  })
  .strict()
  .superRefine((s, ctx) => {
    // Slice constraints — see canonical-schema.md §5.1 validator block.
    if (s.maximumEndIndex !== null && s.maximumStartIndex > s.maximumEndIndex) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maximumStartIndex'],
        message: `maximumStartIndex (${s.maximumStartIndex}) must be <= maximumEndIndex (${s.maximumEndIndex})`,
      })
    }

    // Non-final sessions must have a termination criterion (either max index cap or % threshold);
    // otherwise the chain can't progress.
    const isFinal = s.convergesIntoSessionId === null
    if (!isFinal && s.maximumEndIndex === null && s.playToPercentRemaining === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maximumEndIndex'],
        message:
          'non-final session must have a termination criterion: either maximumEndIndex set, or playToPercentRemaining set, or both',
      })
    }

    // Actual end must be >= actual start.
    if (
      s.actualStartIndex !== null &&
      s.actualEndIndex !== null &&
      s.actualEndIndex < s.actualStartIndex
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actualEndIndex'],
        message: `actualEndIndex (${s.actualEndIndex}) must be >= actualStartIndex (${s.actualStartIndex})`,
      })
    }

    // Actual end (when set) must respect the maximum end cap.
    if (
      s.actualEndIndex !== null &&
      s.maximumEndIndex !== null &&
      s.actualEndIndex > s.maximumEndIndex
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actualEndIndex'],
        message: `actualEndIndex (${s.actualEndIndex}) must be <= maximumEndIndex (${s.maximumEndIndex})`,
      })
    }

    // currentStructureIndex bounds, when set and runtime is active
    if (s.currentStructureIndex !== null && s.actualStartIndex !== null) {
      if (s.currentStructureIndex < s.actualStartIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['currentStructureIndex'],
          message: `currentStructureIndex (${s.currentStructureIndex}) must be >= actualStartIndex (${s.actualStartIndex})`,
        })
      }
      if (s.actualEndIndex !== null && s.currentStructureIndex > s.actualEndIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['currentStructureIndex'],
          message: `currentStructureIndex (${s.currentStructureIndex}) must be <= actualEndIndex (${s.actualEndIndex})`,
        })
      }
    }
  })
