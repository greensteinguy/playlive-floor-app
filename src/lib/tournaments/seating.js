// Seating — task 3.7 (seat assignment: random draw, manual override, seat list).
//
// Tables are per-session (canonical-schema §5.3): a fresh set of `tables` docs is
// created for each session, each carrying a fixed-length `seats` array of
// { seatNumber, entryId|null }. An entry's live seat is denormalized onto the
// entry doc as currentTableId / currentSeatNumber (both-or-neither). Seat moves
// touch two table docs + the entry in ONE transaction (canonical §6.1 #6).
//
// This module is the seating domain layer:
//   • pure planners (no Firestore — unit-testable): who's seatable, how many
//     tables, the even-distribution split, the shuffle, the random draw, and the
//     flat seat-list rows for display/printing (printing itself is Phase 5).
//   • impure ops ({actorId, actorRole}, audited, typed errors): drawSeats (initial
//     random draw), clearSeating (tear the room down), seatEntry (manual move /
//     assign to a specific seat), unseatEntry.
//
// Balancing (3.8), breaking (3.9) and alternates (3.10) build on these primitives.

import {
  runValidatedTransaction,
  runValidatedBatch,
  tables as tablesApi,
  generateId,
  auditLog,
  paths,
} from '../firestore'
import { Table } from '../schema'
import { playerDisplayName } from '../players'
import { now } from '../wallet/_shared'

export const DEFAULT_SEAT_COUNT = 9 // 9-handed NLH; configurable per draw

// ── Typed errors ────────────────────────────────────────────────────────────

export class SeatingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SeatingError'
  }
}
export class TablesExistError extends SeatingError {
  constructor() {
    super('Tables already exist for this session — clear the seating first to redraw.')
    this.name = 'TablesExistError'
  }
}
export class NoSeatableEntriesError extends SeatingError {
  constructor() {
    super('No players to seat — every entry is busted, voided, or in another session.')
    this.name = 'NoSeatableEntriesError'
  }
}
export class SeatOccupiedError extends SeatingError {
  constructor() {
    super('That seat is already taken. Pick an empty seat, or move the player there first.')
    this.name = 'SeatOccupiedError'
  }
}
export class SeatOutOfRangeError extends SeatingError {
  constructor() {
    super('That seat number does not exist on this table.')
    this.name = 'SeatOutOfRangeError'
  }
}
export class EntryNotSeatableError extends SeatingError {
  constructor() {
    super('This entry can no longer be seated (it is busted or voided).')
    this.name = 'EntryNotSeatableError'
  }
}

function requireActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new SeatingError('actorId is required (non-empty string)')
  }
}

// ── Pure planners (no Firestore) ────────────────────────────────────────────

/** A live entry that can hold a seat: not busted, not voided. */
export function isSeatable(entry) {
  return entry.voidedAt === null && entry.bustedAt === null
}

/** The seatable entries belonging to a session (its Day-1 flight pool). */
export function seatableEntries(entries, sessionId) {
  return entries.filter((e) => e.originSessionId === sessionId && isSeatable(e))
}

/** Tables needed for `playerCount` players at `seatCount`-handed: ceil, min 1. */
export function tableCountFor(playerCount, seatCount = DEFAULT_SEAT_COUNT) {
  if (playerCount <= 0) return 0
  return Math.max(1, Math.ceil(playerCount / seatCount))
}

/**
 * Spread `playerCount` players across `tableCount` tables as evenly as possible
 * (poker balances tables from the start). e.g. (19, 3) → [7, 6, 6].
 */
export function distributeCounts(playerCount, tableCount) {
  if (tableCount <= 0) return []
  const base = Math.floor(playerCount / tableCount)
  const extra = playerCount % tableCount
  return Array.from({ length: tableCount }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Fisher–Yates shuffle returning a NEW array. rng() ∈ [0,1), injectable for tests. */
export function shuffle(arr, rng = Math.random) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Plan a random seat draw: shuffle the entries, distribute them evenly across
 * the tables, and fill seats 1..k on each. Pure — returns table specs +
 * per-entry assignments; the op turns these into Firestore writes. rng is
 * injectable so tests are deterministic.
 *
 * @returns {{ tables: Array<{tableNumber:number, seatCount:number, seats:Array<{seatNumber:number, entryId:string|null}>}>,
 *             assignments: Array<{entryId:string, tableNumber:number, seatNumber:number}> }}
 */
export function planSeatDraw({ entries, seatCount = DEFAULT_SEAT_COUNT, tableNumberStart = 1, rng = Math.random }) {
  const players = shuffle(entries, rng)
  const tableCount = tableCountFor(players.length, seatCount)
  const counts = distributeCounts(players.length, tableCount)
  const tables = []
  const assignments = []
  let cursor = 0
  for (let t = 0; t < tableCount; t++) {
    const tableNumber = tableNumberStart + t
    const occupants = counts[t]
    const seats = Array.from({ length: seatCount }, (_, s) => {
      const seatNumber = s + 1
      if (seatNumber <= occupants) {
        const entry = players[cursor++]
        assignments.push({ entryId: entry.id, tableNumber, seatNumber })
        return { seatNumber, entryId: entry.id }
      }
      return { seatNumber, entryId: null }
    })
    tables.push({ tableNumber, seatCount, seats })
  }
  return { tables, assignments }
}

/** Occupied seat count on a table. */
export function occupiedSeatCount(table) {
  return table.seats.filter((s) => s.entryId !== null).length
}

/**
 * Flat seat-card rows for display / CSV / the (Phase-5) thermal print job, sorted
 * by table then seat. One row per OCCUPIED seat. Seat-card fields per DECISIONS
 * 29 May: player name, table & seat #, tournament name + start, starting stack.
 */
export function buildSeatList({ tables, entriesById, playersById, tournament }) {
  const rows = []
  for (const table of [...tables].sort((a, b) => a.tableNumber - b.tableNumber)) {
    for (const seat of [...table.seats].sort((a, b) => a.seatNumber - b.seatNumber)) {
      if (!seat.entryId) continue
      const entry = entriesById[seat.entryId]
      const player = entry ? playersById[entry.playerId] : null
      rows.push({
        entryId: seat.entryId,
        tableNumber: table.tableNumber,
        seatNumber: seat.seatNumber,
        playerName: player ? playerDisplayName(player) : '—',
        startingStack: tournament?.startingStack ?? null,
        tournamentName: tournament?.name ?? null,
        scheduledStartTime: tournament?.scheduledStartTime ?? null,
      })
    }
  }
  return rows
}

// ── Impure ops ──────────────────────────────────────────────────────────────

async function listSessionTables(tournamentId, sessionId) {
  const all = await tablesApi.listTables(tournamentId)
  return all.filter((t) => t.sessionId === sessionId)
}

/**
 * Initial random draw for a session: create the tables and seat every seatable
 * entry, in one atomic batch (table sets are whole-doc validated; entry updates
 * set currentTableId + currentSeatNumber together, so the both-or-neither seat
 * invariant holds by construction). Refuses if tables already exist for the
 * session — clear them first to redraw.
 *
 * @returns {Promise<{ tableCount:number, seatedCount:number }>}
 */
export async function drawSeats({
  tournament,
  sessionId,
  entries,
  seatCount = DEFAULT_SEAT_COUNT,
  actorId,
  actorRole,
  rng,
}) {
  requireActor(actorId)
  const pool = seatableEntries(entries, sessionId)
  if (pool.length === 0) throw new NoSeatableEntriesError()

  const existing = await listSessionTables(tournament.id, sessionId)
  if (existing.length > 0) throw new TablesExistError()

  const plan = planSeatDraw({ entries: pool, seatCount, rng })
  const timestamp = now()
  const tableDocs = plan.tables.map((t) => ({ ...t, id: generateId() }))
  const idByNumber = Object.fromEntries(tableDocs.map((t) => [t.tableNumber, t.id]))

  await runValidatedBatch((batch) => {
    for (const t of tableDocs) {
      batch.set(paths.tablePath(tournament.id, t.id), Table, {
        id: t.id,
        tournamentId: tournament.id,
        sessionId,
        tableNumber: t.tableNumber,
        seatCount: t.seatCount,
        openedAt: null,
        closedAt: null,
        status: 'open',
        seats: t.seats,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    for (const a of plan.assignments) {
      batch.update(paths.entryPath(tournament.id, a.entryId), {
        currentTableId: idByNumber[a.tableNumber],
        currentSeatNumber: a.seatNumber,
        updatedAt: timestamp,
      })
    }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'seating.drawn',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: { sessionId, tableCount: tableDocs.length, playerCount: pool.length, seatCount },
  })

  return { tableCount: tableDocs.length, seatedCount: plan.assignments.length }
}

/**
 * Tear down a session's seating: delete its table docs and clear
 * currentTableId / currentSeatNumber on every entry seated in them, atomically.
 *
 * @returns {Promise<{ tablesRemoved:number, entriesUnseated:number }>}
 */
export async function clearSeating({ tournament, sessionId, actorId, actorRole }) {
  requireActor(actorId)
  const sessionTables = await listSessionTables(tournament.id, sessionId)
  if (sessionTables.length === 0) throw new SeatingError('No tables to clear for this session.')

  const timestamp = now()
  const seatedEntryIds = sessionTables.flatMap((t) => t.seats.map((s) => s.entryId).filter(Boolean))

  await runValidatedBatch((batch) => {
    for (const t of sessionTables) batch.delete(paths.tablePath(tournament.id, t.id))
    for (const entryId of seatedEntryIds) {
      batch.update(paths.entryPath(tournament.id, entryId), {
        currentTableId: null,
        currentSeatNumber: null,
        updatedAt: timestamp,
      })
    }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'seating.cleared',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: { sessionId, tablesRemoved: sessionTables.length, entriesUnseated: seatedEntryIds.length },
  })

  return { tablesRemoved: sessionTables.length, entriesUnseated: seatedEntryIds.length }
}

/**
 * Manually seat / move an entry to a specific (table, seat). One transaction over
 * the target table, the source table (if the entry was seated elsewhere), and the
 * entry — table writes re-validate the whole doc, the entry update sets both seat
 * fields together. Refuses if the target seat is held by a different entry.
 *
 * @returns {Promise<{ tableNumber:number, seatNumber:number }>}
 */
export async function seatEntry({ tournament, entry, targetTableId, targetSeatNumber, actorId, actorRole }) {
  requireActor(actorId)
  if (!isSeatable(entry)) throw new EntryNotSeatableError()
  const timestamp = now()

  const result = await runValidatedTransaction(async (tx) => {
    const target = await tx.get(paths.tablePath(tournament.id, targetTableId), Table)
    const targetSeat = target.seats.find((s) => s.seatNumber === targetSeatNumber)
    if (!targetSeat) throw new SeatOutOfRangeError()
    if (targetSeat.entryId !== null && targetSeat.entryId !== entry.id) throw new SeatOccupiedError()

    const sourceTableId = entry.currentTableId
    // If the entry currently sits at a DIFFERENT table, free that seat (read first).
    if (sourceTableId && sourceTableId !== targetTableId) {
      const source = await tx.get(paths.tablePath(tournament.id, sourceTableId), Table)
      tx.set(paths.tablePath(tournament.id, sourceTableId), Table, {
        ...source,
        seats: source.seats.map((s) => (s.entryId === entry.id ? { ...s, entryId: null } : s)),
        updatedAt: timestamp,
      })
    }

    // Set the target seat; if moving within the same table, clear the old seat too.
    tx.set(paths.tablePath(tournament.id, targetTableId), Table, {
      ...target,
      seats: target.seats.map((s) => {
        if (s.seatNumber === targetSeatNumber) return { ...s, entryId: entry.id }
        if (sourceTableId === targetTableId && s.entryId === entry.id) return { ...s, entryId: null }
        return s
      }),
      updatedAt: timestamp,
    })

    tx.update(paths.entryPath(tournament.id, entry.id), {
      currentTableId: targetTableId,
      currentSeatNumber: targetSeatNumber,
      updatedAt: timestamp,
    })

    return { tableNumber: target.tableNumber, seatNumber: targetSeatNumber }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'seating.seatAssigned',
    targetType: 'entry',
    targetId: entry.id,
    timestamp,
    metadata: { tournamentId: tournament.id, targetTableId, targetSeatNumber },
  })

  return result
}

/**
 * Remove an entry from its seat (clear the table seat + the entry's seat fields).
 * One transaction. No-op-safe callers should check entry.currentTableId first.
 *
 * @returns {Promise<{ ok: true }>}
 */
export async function unseatEntry({ tournament, entry, actorId, actorRole }) {
  requireActor(actorId)
  if (!entry.currentTableId) throw new SeatingError('This entry is not seated.')
  const timestamp = now()

  await runValidatedTransaction(async (tx) => {
    const table = await tx.get(paths.tablePath(tournament.id, entry.currentTableId), Table)
    tx.set(paths.tablePath(tournament.id, entry.currentTableId), Table, {
      ...table,
      seats: table.seats.map((s) => (s.entryId === entry.id ? { ...s, entryId: null } : s)),
      updatedAt: timestamp,
    })
    tx.update(paths.entryPath(tournament.id, entry.id), {
      currentTableId: null,
      currentSeatNumber: null,
      updatedAt: timestamp,
    })
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'seating.unseated',
    targetType: 'entry',
    targetId: entry.id,
    timestamp,
    metadata: { tournamentId: tournament.id },
  })

  return { ok: true }
}
