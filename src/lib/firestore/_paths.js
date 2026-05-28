// Centralized Firestore path constants and builders.
//
// All collection/document paths in the app go through here. Don't sprinkle
// string literals like "tournaments" throughout — import from this file
// instead. If we ever rename a collection or introduce path prefixes (e.g.,
// /v2/tournaments for a schema migration), it's a single change.
//
// Path builders return arrays of strings, ready to spread into Firestore SDK
// calls: doc(db, ...tournamentPath(id)) or collection(db, ...entriesCollectionPath(tid)).

// ── Top-level collection names ─────────────────────────────────────────────
export const TOURNAMENTS = 'tournaments'
export const PLAYERS = 'players'
export const WITHDRAWAL_REQUESTS = 'withdrawalRequests'
export const STRUCTURE_TEMPLATES = 'structureTemplates'
export const TOURNAMENT_TEMPLATES = 'tournamentTemplates'
export const AUDIT_LOG = 'auditLog'

// ── Subcollection names ────────────────────────────────────────────────────
export const SESSIONS = 'sessions'
export const ENTRIES = 'entries'
export const TABLES = 'tables'
export const BOUNTY_DRAWS = 'bountyDraws'
export const WALLET_TRANSACTIONS = 'walletTransactions'
export const TICKETS = 'tickets'

// ── Top-level doc and collection paths ─────────────────────────────────────

export const tournamentsCollectionPath = () => [TOURNAMENTS]
export const tournamentPath = (id) => [TOURNAMENTS, id]

export const playersCollectionPath = () => [PLAYERS]
export const playerPath = (id) => [PLAYERS, id]

export const withdrawalRequestsCollectionPath = () => [WITHDRAWAL_REQUESTS]
export const withdrawalRequestPath = (id) => [WITHDRAWAL_REQUESTS, id]

export const structureTemplatesCollectionPath = () => [STRUCTURE_TEMPLATES]
export const structureTemplatePath = (id) => [STRUCTURE_TEMPLATES, id]

export const tournamentTemplatesCollectionPath = () => [TOURNAMENT_TEMPLATES]
export const tournamentTemplatePath = (id) => [TOURNAMENT_TEMPLATES, id]

export const auditLogCollectionPath = () => [AUDIT_LOG]
export const auditLogPath = (id) => [AUDIT_LOG, id]

// ── Subcollection paths (under tournaments) ────────────────────────────────

export const sessionsCollectionPath = (tournamentId) => [TOURNAMENTS, tournamentId, SESSIONS]
export const sessionPath = (tournamentId, sessionId) => [TOURNAMENTS, tournamentId, SESSIONS, sessionId]

export const entriesCollectionPath = (tournamentId) => [TOURNAMENTS, tournamentId, ENTRIES]
export const entryPath = (tournamentId, entryId) => [TOURNAMENTS, tournamentId, ENTRIES, entryId]

export const tablesCollectionPath = (tournamentId) => [TOURNAMENTS, tournamentId, TABLES]
export const tablePath = (tournamentId, tableId) => [TOURNAMENTS, tournamentId, TABLES, tableId]

export const bountyDrawsCollectionPath = (tournamentId) => [TOURNAMENTS, tournamentId, BOUNTY_DRAWS]
export const bountyDrawPath = (tournamentId, drawId) => [TOURNAMENTS, tournamentId, BOUNTY_DRAWS, drawId]

// ── Subcollection paths (under players) ────────────────────────────────────

export const walletTransactionsCollectionPath = (playerId) => [PLAYERS, playerId, WALLET_TRANSACTIONS]
export const walletTransactionPath = (playerId, txId) => [PLAYERS, playerId, WALLET_TRANSACTIONS, txId]

export const ticketsCollectionPath = (playerId) => [PLAYERS, playerId, TICKETS]
export const ticketPath = (playerId, ticketId) => [PLAYERS, playerId, TICKETS, ticketId]
