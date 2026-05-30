// Builders that produce minimal, validator-passing objects for each schema.
// Tests override just the field under test rather than spelling out every
// required field on every test case.
//
// Internal to tests — not exported from index.js.

import { Timestamp } from 'firebase/firestore'

export const ts = () => Timestamp.fromMillis(1_700_000_000_000)

export function buildPlayer(overrides = {}) {
  return {
    id: 'player-1',
    legacyId: null,
    firstName: 'Test',
    lastName: 'User',
    displayName: null,
    phone: '0400000000',
    email: null,
    streetAddress: null,
    countryCode: null,
    walletBalance: 0,
    ticketBalance: 0,
    totalDeposited: 0,
    isMerged: false,
    mergedIntoId: null,
    mergedAt: null,
    createdAt: ts(),
    updatedAt: ts(),
    createdBy: 'system',
    archivedAt: null,
    ...overrides,
  }
}

export function buildStructure() {
  return [
    { type: 'level', blindNumber: 1, smallBlind: 25, bigBlind: 50, ante: 0, bringIn: 0, durationMinutes: 20 },
    { type: 'level', blindNumber: 2, smallBlind: 50, bigBlind: 100, ante: 0, bringIn: 0, durationMinutes: 20 },
    { type: 'break', durationMinutes: 10, label: 'Short break', isColorUp: false },
    { type: 'level', blindNumber: 3, smallBlind: 100, bigBlind: 200, ante: 25, bringIn: 0, durationMinutes: 20 },
  ]
}

export function buildPayoutStructure() {
  return {
    type: 'byPlace',
    rounding: 'nearest5',
    positions: [
      { place: 1, payout: 100_00, percent: null },
      { place: 2, payout: 60_00, percent: null },
      { place: 3, payout: 40_00, percent: null },
    ],
  }
}

export function buildTournament(overrides = {}) {
  return {
    id: 'tournament-1',
    legacyId: null,
    name: 'Test Tournament',
    shortDescription: '',
    isMultiDay: false,
    isMultiFlight: false,
    gameType: 'nlh',
    buyIn: 50_00,
    hospitalityCost: 0,
    guarantee: 0,
    houseConsumption: 0,
    structureTemplateId: null,
    startingStack: 10_000,
    structure: buildStructure(),
    payoutStructure: buildPayoutStructure(),
    scheduledStartTime: ts(),
    lateRegCutoffLevel: null,
    status: 'scheduled',
    isOnBreak: false,
    pausedAt: null,
    reentryConfig: { type: 'freezeout', maxReentries: null, maxRebuys: null, hasAddOn: false, addOnCost: null, addOnChips: null },
    hasUpperDeckMainDeck: false,
    satelliteConfig: null,
    bountyPoolConfig: null,
    fromTemplateId: null,
    currentStructureIndex: null,
    entryCount: 0,
    uniquePlayerCount: 0,
    remainingPlayerCount: 0,
    totalPrizePool: 0,
    finishedAt: null,
    createdAt: ts(),
    updatedAt: ts(),
    createdBy: 'system',
    archivedAt: null,
    ...overrides,
  }
}

export function buildWithdrawalRequest(overrides = {}) {
  return {
    id: 'wr-1',
    playerId: 'player-1',
    amount: 5_000,
    payoutMethod: 'cash',
    state: 'pending',
    requestedBy: 'cashier-1',
    requestedAt: ts(),
    completedBy: null,
    completedAt: null,
    externalReference: null,
    walletTransactionId: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  }
}

export function buildWalletTransaction(overrides = {}) {
  return {
    id: 'tx-1',
    playerId: 'player-1',
    type: 'deposit',
    amount: 1_000,
    method: 'cash',
    direction: null,
    reference: 'cash',
    relatedDocId: null,
    actorId: 'cashier-1',
    actorRole: 'cashier',
    timestamp: ts(),
    notes: null,
    ...overrides,
  }
}

export function buildSession(overrides = {}) {
  return {
    id: 'session-1',
    tournamentId: 'tournament-1',
    convergesIntoSessionId: null,
    dayNumber: 1,
    flightLabel: null,
    sessionLabel: 'Final',
    maximumStartIndex: 0,
    maximumEndIndex: null,
    playToPercentRemaining: null,
    actualStartIndex: null,
    actualEndIndex: null,
    scheduledStartTime: ts(),
    actualStartTime: null,
    actualEndTime: null,
    status: 'scheduled',
    currentStructureIndex: null,
    remainingPlayerCount: null,
    clockStartIndex: null,
    clockStartedAt: null,
    clockPausedAt: null,
    createdAt: ts(),
    updatedAt: ts(),
    createdBy: 'system',
    ...overrides,
  }
}

export function buildEntry(overrides = {}) {
  return {
    id: 'entry-1',
    legacyId: null,
    tournamentId: 'tournament-1',
    playerId: 'player-1',
    originSessionId: 'session-1',
    entryType: 'initial',
    entryNumber: 1,
    registeredAt: ts(),
    registeredBy: 'cashier-1',
    paymentMethod: 'cash',
    paymentAmount: 50_00,
    paymentReference: 'cash',
    walletTransactionId: 'tx-1',
    currentTableId: null,
    currentSeatNumber: null,
    bustedAt: null,
    bustedInSessionId: null,
    finishingPlace: null,
    bountyEarnings: 0,
    bountiesKnockoutCount: 0,
    cashWinnings: 0,
    ticketWinnings: 0,
    lastLongerDeck: null,
    isLastLongerWinner: false,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    notes: null,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  }
}

export function buildTable(overrides = {}) {
  return {
    id: 'table-1',
    tournamentId: 'tournament-1',
    sessionId: 'session-1',
    tableNumber: 1,
    seatCount: 3,
    openedAt: null,
    closedAt: null,
    status: 'open',
    seats: [
      { seatNumber: 1, entryId: null },
      { seatNumber: 2, entryId: null },
      { seatNumber: 3, entryId: null },
    ],
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  }
}

export function buildTicket(overrides = {}) {
  return {
    id: 'ticket-1',
    playerId: 'player-1',
    faceValue: 50_00,
    state: 'unused',
    issuedAt: ts(),
    issuedReason: null,
    issuedFromTournamentId: null,
    usedAt: null,
    usedOnEntryId: null,
    usedOnTournamentId: null,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  }
}

export function buildBountyDraw(overrides = {}) {
  return {
    id: 'draw-1',
    tournamentId: 'tournament-1',
    bountyValue: 1_000_00,
    drawnAt: ts(),
    drawnBy: 'td-1',
    knockedOutEntryId: 'entry-1',
    knockerEntryId: 'entry-2',
    walletTransactionId: null,
    notes: null,
    ...overrides,
  }
}
