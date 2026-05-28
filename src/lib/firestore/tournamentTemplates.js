// Typed CRUD for the `tournamentTemplates` top-level collection.

import { TournamentTemplate } from '../schema'
import {
  validatedGet,
  validatedGetMany,
  validatedSet,
  validatedUpdate,
} from './_client'
import { tournamentTemplatePath, tournamentTemplatesCollectionPath } from './_paths'
import { generateId } from './_ids'

export function getTournamentTemplate(id) {
  return validatedGet(tournamentTemplatePath(id), TournamentTemplate)
}

export function listTournamentTemplates(queryFn) {
  return validatedGetMany(tournamentTemplatesCollectionPath(), TournamentTemplate, queryFn)
}

export function createTournamentTemplate(data) {
  const id = data.id ?? generateId()
  return validatedSet(tournamentTemplatePath(id), TournamentTemplate, { ...data, id })
}

export function updateTournamentTemplate(id, partialData) {
  return validatedUpdate(tournamentTemplatePath(id), partialData)
}
