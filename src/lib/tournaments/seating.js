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
  validatedSet,
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
export class CannotBreakTableError extends SeatingError {
  constructor() {
    super('Not enough empty seats on the other tables to break this one.')
    this.name = 'CannotBreakTableError'
  }
}
export class NoAlternatesError extends SeatingError {
  constructor() {
    super('No alternates are waiting to be seated.')
    this.name = 'NoAlternatesError'
  }
}
export class NoOpenSeatError extends SeatingError {
  constructor() {
    super('No open seat available — every open table is full.')
    this.name = 'NoOpenSeatError'
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
 * The tables that can receive players: open AND active. Random seating and
 * balancing only ever touch these — a deactivated table (active === false) is
 * open/dealer-ready but skipped until the TD activates it. `active !== false`
 * treats a missing flag as active (pre-field docs default to active).
 */
export function fillableTables(tables) {
  return tables.filter((t) => t.status === 'open' && t.active !== false)
}

/**
 * A uniformly random empty seat among the fillable (open + active) tables — the
 * default placement for an auto-seated player (off the waitlist or a new entry),
 * like drawing a seat card. Pure; rng injectable for tests. Returns
 * { tableId, tableNumber, seatNumber } or null when no active table has room.
 */
export function randomEmptySeat(tables, rng = Math.random) {
  const seats = fillableTables(tables).flatMap((t) =>
    t.seats
      .filter((s) => s.entryId === null)
      .map((s) => ({ tableId: t.id, tableNumber: t.tableNumber, seatNumber: s.seatNumber }))
  )
  return seats.length === 0 ? null : seats[Math.floor(rng() * seats.length)]
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

// ── Balancing (task 3.8) ─────────────────────────────────────────────────────

/** Occupied-seat counts of the fillable (open + active) tables, in display order. */
export function tableSizes(tables) {
  return fillableTables(tables)
    .sort((a, b) => a.tableNumber - b.tableNumber)
    .map((t) => ({ tableNumber: t.tableNumber, size: occupiedSeatCount(t), seatCount: t.seatCount }))
}

/** True when the fillable (open + active) tables are within ±1 (or there are fewer than 2). */
export function isBalanced(tables) {
  const sizes = tableSizes(tables).map((s) => s.size)
  if (sizes.length < 2) return true
  return Math.max(...sizes) - Math.min(...sizes) <= 1
}

/**
 * Plan the minimum set of moves to bring the OPEN tables within ±1 of each other
 * — move a player off the fullest table into the emptiest, repeat until balanced.
 * Pure (no Firestore); balanceTables re-plans inside its transaction from fresh
 * reads and applies the result.
 *
 * Player-selection rule (v1): the player in the HIGHEST-numbered occupied seat of
 * the fullest table moves to the LOWEST-numbered empty seat of the emptiest table.
 * Deterministic and simple — NOT position-aware (real rooms often move the next
 * big blind). Flagged for the floor-staff walkthrough; the TD can hand-adjust with
 * a manual move afterward.
 *
 * @returns {Array<{entryId:string, fromTableId:string, fromTableNumber:number, fromSeatNumber:number,
 *                   toTableId:string, toTableNumber:number, toSeatNumber:number}>}
 */
export function planBalance(tables) {
  const state = fillableTables(tables)
    .map((t) => ({
      id: t.id,
      tableNumber: t.tableNumber,
      occupied: t.seats.filter((s) => s.entryId !== null).map((s) => ({ seatNumber: s.seatNumber, entryId: s.entryId })),
      empty: t.seats.filter((s) => s.entryId === null).map((s) => s.seatNumber),
    }))
  const moves = []
  const size = (t) => t.occupied.length
  // Guard bounds the loop far above any real table-count × seat-count.
  for (let guard = 0; guard < 10_000; guard++) {
    if (state.length < 2) break
    const largest = [...state].sort((a, b) => size(b) - size(a))[0]
    const smallest = [...state]
      .sort((a, b) => size(a) - size(b))
      .find((t) => t.id !== largest.id && t.empty.length > 0)
    if (!smallest || size(largest) - size(smallest) <= 1) break

    const moving = [...largest.occupied].sort((a, b) => b.seatNumber - a.seatNumber)[0]
    const toSeatNumber = [...smallest.empty].sort((a, b) => a - b)[0]
    moves.push({
      entryId: moving.entryId,
      fromTableId: largest.id,
      fromTableNumber: largest.tableNumber,
      fromSeatNumber: moving.seatNumber,
      toTableId: smallest.id,
      toTableNumber: smallest.tableNumber,
      toSeatNumber,
    })
    largest.occupied = largest.occupied.filter((o) => o.entryId !== moving.entryId)
    largest.empty.push(moving.seatNumber)
    smallest.occupied.push({ seatNumber: toSeatNumber, entryId: moving.entryId })
    smallest.empty = smallest.empty.filter((s) => s !== toSeatNumber)
  }
  return moves
}

/**
 * Balance a session's open tables to within ±1, atomically. Re-reads the tables
 * inside the transaction and re-plans from that consistent snapshot (so a
 * concurrent bust/move can't make the applied moves stale), then writes every
 * touched table + repoints every moved entry. A no-op (already balanced) returns
 * an empty move list without writing or auditing.
 *
 * @returns {Promise<{ moves: Array<object> }>}
 */
export async function balanceTables({ tournament, sessionId, actorId, actorRole }) {
  requireActor(actorId)
  const sessionTables = await listSessionTables(tournament.id, sessionId)
  const openIds = sessionTables.filter((t) => t.status === 'open').map((t) => t.id)
  if (openIds.length < 2) return { moves: [] }

  const timestamp = now()
  const result = await runValidatedTransaction(async (tx) => {
    const fresh = []
    for (const id of openIds) fresh.push(await tx.get(paths.tablePath(tournament.id, id), Table))
    const moves = planBalance(fresh)
    if (moves.length === 0) return { moves: [] }

    const byId = Object.fromEntries(fresh.map((t) => [t.id, t]))
    for (const m of moves) {
      byId[m.fromTableId].seats = byId[m.fromTableId].seats.map((s) =>
        s.seatNumber === m.fromSeatNumber ? { ...s, entryId: null } : s
      )
      byId[m.toTableId].seats = byId[m.toTableId].seats.map((s) =>
        s.seatNumber === m.toSeatNumber ? { ...s, entryId: m.entryId } : s
      )
    }
    const touched = new Set(moves.flatMap((m) => [m.fromTableId, m.toTableId]))
    for (const id of touched) tx.set(paths.tablePath(tournament.id, id), Table, { ...byId[id], updatedAt: timestamp })
    for (const m of moves) {
      tx.update(paths.entryPath(tournament.id, m.entryId), {
        currentTableId: m.toTableId,
        currentSeatNumber: m.toSeatNumber,
        updatedAt: timestamp,
      })
    }
    return { moves }
  })

  if (result.moves.length > 0) {
    await auditLog.writeAuditLogSafe({
      actorId,
      actorRole,
      actionType: 'seating.balanced',
      targetType: 'tournament',
      targetId: tournament.id,
      timestamp,
      metadata: { sessionId, moveCount: result.moves.length },
    })
  }
  return result
}

// ── Breaking (task 3.9) ──────────────────────────────────────────────────────

/**
 * Plan breaking a table: its seated players fill empty seats on the OTHER open
 * tables, emptiest-first (which keeps the room roughly balanced). Pure. Returns
 * the move list ([] if the table is already empty — still breakable), or `null`
 * if the other open tables don't have enough empty seats to absorb its players.
 *
 * @returns {Array<{entryId,fromTableId,fromTableNumber,fromSeatNumber,toTableId,toTableNumber,toSeatNumber}>|null}
 */
export function planBreak(tables, tableId) {
  const open = tables.filter((t) => t.status === 'open')
  const broken = open.find((t) => t.id === tableId)
  if (!broken) return null
  const movers = broken.seats
    .filter((s) => s.entryId !== null)
    .map((s) => ({ seatNumber: s.seatNumber, entryId: s.entryId }))
  // Players from a closed table go to the OTHER active (fillable) tables.
  const dest = fillableTables(tables)
    .filter((t) => t.id !== tableId)
    .map((t) => ({
      id: t.id,
      tableNumber: t.tableNumber,
      occupied: occupiedSeatCount(t),
      empty: t.seats.filter((s) => s.entryId === null).map((s) => s.seatNumber).sort((a, b) => a - b),
    }))
  const totalEmpty = dest.reduce((sum, d) => sum + d.empty.length, 0)
  if (totalEmpty < movers.length) return null

  const moves = []
  for (const mover of movers) {
    dest.sort((a, b) => a.occupied - b.occupied || a.tableNumber - b.tableNumber)
    const target = dest.find((d) => d.empty.length > 0)
    const toSeatNumber = target.empty.shift()
    moves.push({
      entryId: mover.entryId,
      fromTableId: broken.id,
      fromTableNumber: broken.tableNumber,
      fromSeatNumber: mover.seatNumber,
      toTableId: target.id,
      toTableNumber: target.tableNumber,
      toSeatNumber,
    })
    target.occupied += 1
  }
  return moves
}

/** Can this open table be broken — i.e. do the OTHER open tables have room? */
export function canBreakTable(tables, tableId) {
  return planBreak(tables, tableId) !== null
}

/**
 * Break a table: move its players to empty seats on the other open tables, then
 * close it (status 'broken' + closedAt; its seats cleared). Atomic — re-reads the
 * open tables inside the transaction and re-plans, then writes every receiving
 * table + the broken table + repoints every moved entry (canonical §6.1). Refuses
 * if fewer than two tables are open or the others can't absorb the players.
 *
 * @returns {Promise<{ moves: Array<object>, brokenTableNumber: number }>}
 */
export async function breakTable({ tournament, sessionId, tableId, actorId, actorRole }) {
  requireActor(actorId)
  const sessionTables = await listSessionTables(tournament.id, sessionId)
  const open = sessionTables.filter((t) => t.status === 'open')
  if (!open.some((t) => t.id === tableId)) throw new SeatingError('That table is not open.')

  const timestamp = now()
  const result = await runValidatedTransaction(async (tx) => {
    const fresh = []
    for (const t of open) fresh.push(await tx.get(paths.tablePath(tournament.id, t.id), Table))
    // planBreak returns [] for an empty table (always closeable) or null for an
    // occupied one the active tables can't absorb.
    const moves = planBreak(fresh, tableId)
    if (moves === null) throw new CannotBreakTableError()

    const byId = Object.fromEntries(fresh.map((t) => [t.id, t]))
    for (const m of moves) {
      byId[m.toTableId].seats = byId[m.toTableId].seats.map((s) =>
        s.seatNumber === m.toSeatNumber ? { ...s, entryId: m.entryId } : s
      )
    }
    const broken = byId[tableId]
    // Close the table: clear its seats, mark broken. The Table schema requires
    // closedAt ⇒ openedAt and status 'broken' ⇒ closedAt, so stamp openedAt too
    // if the table was drawn but never formally opened (its dealerMinutes → 0).
    const closed = {
      ...broken,
      seats: broken.seats.map((s) => ({ ...s, entryId: null })),
      status: 'broken',
      openedAt: broken.openedAt ?? timestamp,
      closedAt: timestamp,
      updatedAt: timestamp,
    }

    const touchedDest = new Set(moves.map((m) => m.toTableId))
    for (const id of touchedDest) tx.set(paths.tablePath(tournament.id, id), Table, { ...byId[id], updatedAt: timestamp })
    tx.set(paths.tablePath(tournament.id, tableId), Table, closed)
    for (const m of moves) {
      tx.update(paths.entryPath(tournament.id, m.entryId), {
        currentTableId: m.toTableId,
        currentSeatNumber: m.toSeatNumber,
        updatedAt: timestamp,
      })
    }
    return { moves, brokenTableNumber: broken.tableNumber }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'seating.tableBroken',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: {
      sessionId,
      tableId,
      brokenTableNumber: result.brokenTableNumber,
      moveCount: result.moves.length,
    },
  })
  return result
}

// ── Alternates / waitlist (task 3.10) ────────────────────────────────────────

const registeredMs = (e) => e.registeredAt?.toMillis?.() ?? 0

/**
 * The alternates waiting for a seat: seatable entries in the session that aren't
 * currently seated, ordered FIFO by registration time (so the earliest-waiting is
 * #1 = next to be seated; late registrants queue at the back). Pure. The index +1
 * is the alternate's queue number (their alternate-ticket number — printing is
 * Phase 5; this captures the order). `seatedEntryIds` is the set of entryIds
 * currently in a seat.
 */
export function waitlist(entries, sessionId, seatedEntryIds) {
  const seated = seatedEntryIds instanceof Set ? seatedEntryIds : new Set(seatedEntryIds)
  return seatableEntries(entries, sessionId)
    .filter((e) => !seated.has(e.id))
    .sort((a, b) => registeredMs(a) - registeredMs(b))
}

/**
 * The emptiest active table's lowest empty seat. Random placement
 * (`randomEmptySeat`) is the default for auto-seating; this deterministic variant
 * stays for the "is there room?" check and as a Phase-4 hook (a bust frees the
 * short table's seat). Pure. Returns the seat or null when no active table has room.
 */
export function firstEmptySeat(tables) {
  const candidate = fillableTables(tables)
    .map((t) => ({
      t,
      occupied: occupiedSeatCount(t),
      emptySeats: t.seats.filter((s) => s.entryId === null).map((s) => s.seatNumber).sort((a, b) => a - b),
    }))
    .filter((c) => c.emptySeats.length > 0)
    .sort((a, b) => a.occupied - b.occupied || a.t.tableNumber - b.t.tableNumber)[0]
  return candidate ? { tableId: candidate.t.id, tableNumber: candidate.t.tableNumber, seatNumber: candidate.emptySeats[0] } : null
}

/**
 * Seat the next waiting alternate (FIFO) into a RANDOM active seat — the manual
 * version of "auto-assign on the next bust" (Phase 4 wires the bust to call this,
 * or `seatEntry` into the freed seat directly). Delegates the actual placement to
 * `seatEntry`, which is atomic and re-checks the seat is free inside its
 * transaction. `rng` is injectable for tests. Throws NoAlternatesError /
 * NoOpenSeatError when there's nobody to seat or no active table has room.
 *
 * @returns {Promise<{ entryId:string, tableNumber:number, seatNumber:number }>}
 */
export async function seatNextAlternate({ tournament, sessionId, entries, tables, actorId, actorRole, rng }) {
  requireActor(actorId)
  const openTables = tables.filter((t) => t.status === 'open')
  const seatedIds = new Set(openTables.flatMap((t) => t.seats.map((s) => s.entryId).filter(Boolean)))
  const queue = waitlist(entries, sessionId, seatedIds)
  if (queue.length === 0) throw new NoAlternatesError()
  // Random seat among the active tables (like drawing a seat card), not deterministic.
  const seat = randomEmptySeat(openTables, rng)
  if (!seat) throw new NoOpenSeatError()

  const res = await seatEntry({
    tournament,
    entry: queue[0],
    targetTableId: seat.tableId,
    targetSeatNumber: seat.seatNumber,
    actorId,
    actorRole,
  })
  return { entryId: queue[0].id, ...res }
}

// ── Table lifecycle: open / activate (task: open-close-activate-deactivate) ───

/**
 * Open a new table for a session — a dealer is ready. Starts **deactivated** by
 * default (open but not yet filled; the TD activates it when ready) and takes the
 * next table number after the session's existing tables. Seat count defaults to
 * the tournament's `maxSeatsPerTable`.
 *
 * @returns {Promise<{ tableId: string, tableNumber: number }>}
 */
export async function openTable({ tournament, sessionId, seatCount, active = false, actorId, actorRole }) {
  requireActor(actorId)
  const seats = seatCount ?? tournament.maxSeatsPerTable ?? DEFAULT_SEAT_COUNT
  const existing = await listSessionTables(tournament.id, sessionId)
  const tableNumber = existing.reduce((max, t) => Math.max(max, t.tableNumber), 0) + 1
  const id = generateId()
  const timestamp = now()

  await validatedSet(paths.tablePath(tournament.id, id), Table, {
    id,
    tournamentId: tournament.id,
    sessionId,
    tableNumber,
    seatCount: seats,
    openedAt: null,
    closedAt: null,
    status: 'open',
    active,
    seats: Array.from({ length: seats }, (_, i) => ({ seatNumber: i + 1, entryId: null })),
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'seating.tableOpened',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: { sessionId, tableId: id, tableNumber, active },
  })
  return { tableId: id, tableNumber }
}

/**
 * Activate or deactivate an open table (RMW). Deactivating leaves any seated
 * players where they are — it only stops the table being a seating / balancing
 * target until it's re-activated.
 *
 * @returns {Promise<{ active: boolean }>}
 */
export async function setTableActive({ tournament, tableId, active, actorId, actorRole }) {
  requireActor(actorId)
  const timestamp = now()

  await runValidatedTransaction(async (tx) => {
    const table = await tx.get(paths.tablePath(tournament.id, tableId), Table)
    if (table.status !== 'open') throw new SeatingError('Only an open table can be activated or deactivated.')
    tx.set(paths.tablePath(tournament.id, tableId), Table, { ...table, active, updatedAt: timestamp })
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'seating.tableActivated',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: { tableId, active },
  })
  return { active }
}
