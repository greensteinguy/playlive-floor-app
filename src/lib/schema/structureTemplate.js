// Schema for the `structureTemplates` top-level collection.
// Mirrors docs/schema/canonical-schema.md §3.4.
//
// A structureTemplate carries a reusable blind structure. When a tournament
// references one via `structureTemplateId`, the structure is COPIED into the
// tournament at create time — editing the template later doesn't affect
// already-created tournaments.

import { z } from 'zod'
import { DocumentId, NonEmptyString, AuditFields, ArchiveField } from './_shared'
import { Structure } from './structure'

export const StructureTemplate = z
  .object({
    id: DocumentId,
    name: NonEmptyString,
    description: z.string().nullable(),

    levels: Structure, // reuses the same discriminated-union validator (level | break)

    ...AuditFields,
    ...ArchiveField,
  })
  .strict()
