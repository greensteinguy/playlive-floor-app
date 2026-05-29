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

export { TournamentError } from './errors'
