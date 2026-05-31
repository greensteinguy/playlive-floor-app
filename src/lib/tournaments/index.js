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

export { createTournament, updateTournament, setTournamentStatus } from './tournaments'

export { validateSessionPlan, deriveFormatFlags, SINGLE_DAY_PLAN } from './sessions'

export {
  registerEntry,
  recountTournamentEntries,
  totalEntryCost,
  registrationOpen,
  registrableSessions,
  planEntry,
  computeEntryCounters,
} from './registration'

export {
  startClock,
  pauseClock,
  resumeClock,
  advanceLevel,
  rewindLevel,
  gotoLevel,
  finishClock,
} from './clock'

export { TournamentError } from './errors'
