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

export {
  drawSeats,
  clearSeating,
  seatEntry,
  unseatEntry,
  eliminateEntry,
  revertElimination,
  nextFinishingPlace,
  finishingOrder,
  balanceTables,
  breakTable,
  seatNextAlternate,
  openTable,
  setTableActive,
  seatableEntries,
  isSeatable,
  tableCountFor,
  distributeCounts,
  shuffle,
  planSeatDraw,
  occupiedSeatCount,
  buildSeatList,
  tableSizes,
  isBalanced,
  planBalance,
  planBreak,
  canBreakTable,
  waitlist,
  firstEmptySeat,
  randomEmptySeat,
  fillableTables,
  DEFAULT_SEAT_COUNT,
  SeatingError,
  TablesExistError,
  NoSeatableEntriesError,
  SeatOccupiedError,
  SeatOutOfRangeError,
  EntryNotSeatableError,
  AlreadyBustedError,
  NotBustedError,
  LastPlayerStandingError,
  RevertBlockedByPayoutError,
  CannotBreakTableError,
  NoAlternatesError,
  NoOpenSeatError,
} from './seating'

export {
  LAST_LONGER_DECKS,
  lastLongerDeckLabel,
  lastLongerParticipants,
  deriveLastLongerStatus,
  lastLongerReasonLabel,
  settleLastLonger,
  unsettleLastLonger,
  LastLongerError,
  LastLongerNotDeterminableError,
  LastLongerAlreadySettledError,
  LastLongerNotSettledError,
} from './lastLonger'

export {
  drawBounty,
  isMysteryBounty,
  undrawnBountyValues,
  undrawnSlotIndexes,
  remainingBountySummary,
  bountyBoardRows,
  slotIndexFromDrawId,
  drawIdForSlot,
  BountyError,
  NotMysteryBountyError,
  NoBountiesRemainingError,
  EliminatorNotAliveError,
  BountyAlreadyDrawnError,
} from './bounty'

export {
  reachSatelliteMilestone,
  isSatellite,
  satelliteMilestoneThreshold,
  isMilestoneWinner,
  milestoneWinners,
  SatelliteError,
  NotSatelliteError,
} from './satellite'

export {
  aliveEntries,
  recordedWinner,
  isWinningsPaid,
  isWinningsStaged,
  buildPayoutRows,
  payoutRowsTotal,
  recordWinner,
  revertWinner,
  enterDeal,
  PayoutsError,
  MultiplePlayersRemainError,
  WinnerAlreadyRecordedError,
  NoWinnerRecordedError,
  WinnerRevertBlockedError,
  DealRowAlreadyPaidError,
  DealTotalMismatchError,
} from './payouts'

export { TournamentError } from './errors'
