// Typed CRUD for the `structureTemplates` top-level collection.

import { StructureTemplate } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
} from './_client'
import { structureTemplatePath, structureTemplatesCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getStructureTemplate(id) {
  return validatedGet(structureTemplatePath(id), StructureTemplate)
}

export function listStructureTemplates(queryFn) {
  return validatedGetMany(structureTemplatesCollectionPath(), StructureTemplate, queryFn)
}

export function createStructureTemplate(data) {
  const id = data.id ?? generateId()
  return validatedSet(structureTemplatePath(id), StructureTemplate, { ...data, id })
}

export function updateStructureTemplate(id, partialData) {
  return validatedUpdate(structureTemplatePath(id), partialData)
}
