// Single import point for tournament-domain operations.
//
// Usage:
//   import { createStructureTemplate, TournamentError } from '../lib/tournaments'

export {
  createStructureTemplate,
  updateStructureTemplate,
  archiveStructureTemplate,
  createTournamentTemplate,
  updateTournamentTemplate,
  archiveTournamentTemplate,
} from './templates'

export { createTournament, updateTournament } from './tournaments'

export { validateSessionPlan, deriveFormatFlags, SINGLE_DAY_PLAN } from './sessions'

export { TournamentError } from './errors'
