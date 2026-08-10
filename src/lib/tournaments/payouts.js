// Payouts domain layer — tasks 4.4 (calculator) / 4.5 (deal-making) and the
// winner half of the results spine.
//
// How staged vs paid works (the 4.5 ↔ 4.7 reconciliation):
//   • STAGED — `entries/{id}.cashWinnings` is the recorded result (per the
//     canonical-schema design note Q4: "each affected entry's cashWinnings is
//     set directly"). The payout calculator's numbers are never persisted —
//     they're re-derived from the payoutStructure + prize pool on every render
//     (materializePayouts). A DEAL persists its agreed amounts by setting
//     cashWinnings on each affected entry (enterDeal below). Setting
//     cashWinnings also arms seating.js's RevertBlockedByPayoutError guard.
//   • PAID — a staged (or calculated) amount is not on the player's wallet
//     until the cashier confirms the row (task 4.7, wallet/winCredit.js
//     confirmEntryWinCredit): ONE transaction sets the entry's cashWinnings to
//     the paid amount, stamps `winningsPaidAt`, links
//     `winningsWalletTransactionId`, and credits the wallet. `winningsPaidAt`
//     is the paid marker — it survives reloads, distinguishes a staged deal
//     from a paid row, and is re-checked inside the confirm transaction so a
//     double-confirm race loses.
//
// Winner semantics: 1st place is NEVER assigned by a bust (seating.js refuses
// to eliminate the sole survivor). recordWinner here is the only assignment
// path — it requires exactly one alive entry and stamps finishingPlace=1 on it
// (the winner stays un-busted). revertWinner undoes that, refused once
// winnings are recorded/paid — symmetric with revertElimination's guard.
//
// Structure mirrors seating.js: pure planners (no Firestore) + impure ops
// ({actorId, actorRole}, full-doc re-validated transactions, best-effort audit,
// typed errors).

import {
  runValidatedTransaction,
  entries as entriesApi,
  auditLog,
  paths,
} from '../firestore'
import { Entry } from '../schema'
import { now, emitManagerOverride } from '../wallet/_shared'
import { materializePayouts } from '../payouts'
import { computeEntryCounters } from './registration'

// ── Typed errors ────────────────────────────────────────────────────────────

export class PayoutsError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PayoutsError'
  }
}
export class MultiplePlayersRemainError extends PayoutsError {
  constructor(aliveCount) {
    super(`${aliveCount} players are still in — the winner can only be recorded when exactly one remains.`)
    this.name = 'MultiplePlayersRemainError'
    this.aliveCount = aliveCount
  }
}
export class WinnerAlreadyRecordedError extends PayoutsError {
  constructor() {
    super('A winner is already recorded for this tournament — undo that first to change it.')
    this.name = 'WinnerAlreadyRecordedError'
  }
}
export class NoWinnerRecordedError extends PayoutsError {
  constructor() {
    super('No winner has been recorded for this tournament.')
    this.name = 'NoWinnerRecordedError'
  }
}
export class WinnerRevertBlockedError extends PayoutsError {
  constructor() {
    super("Winnings have already been recorded for the winner — undo those first (or adjust via a deal).")
    this.name = 'WinnerRevertBlockedError'
  }
}
export class DealRowAlreadyPaidError extends PayoutsError {
  constructor() {
    super('One of the players in this deal has already been paid out — a paid row cannot be re-staged.')
    this.name = 'DealRowAlreadyPaidError'
  }
}
export class DealTotalMismatchError extends PayoutsError {
  constructor({ grandTotal, prizePool }) {
    super(
      `The deal's payout total (${grandTotal} cents) does not match the prize pool (${prizePool} cents). ` +
      `A manager must acknowledge the difference with a reason to save it.`
    )
    this.name = 'DealTotalMismatchError'
    this.grandTotal = grandTotal
    this.prizePool = prizePool
  }
}

function requireActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new PayoutsError('actorId is required (non-empty string)')
  }
}

// ── Pure planners (no Firestore) ────────────────────────────────────────────

/** Non-voided, not-yet-busted entries — the players still in. */
export function aliveEntries(entries) {
  return (entries ?? []).filter((e) => e.voidedAt === null && e.bustedAt === null)
}

/** The recorded winner (finishingPlace 1 on a non-voided entry), or null. */
export function recordedWinner(entries) {
  return (entries ?? []).find((e) => e.voidedAt === null && e.finishingPlace === 1) ?? null
}

/** Has this entry's winnings payout been cashier-confirmed? */
export function isWinningsPaid(entry) {
  return entry?.winningsPaidAt != null
}

/**
 * Does this entry carry a staged-or-paid cash result? cashWinnings > 0 is the
 * staged marker (a deliberately-$0 deal allocation is indistinguishable from
 * "not staged" — acceptable: a $0 row has nothing to pay either way).
 */
export function isWinningsStaged(entry) {
  return (entry?.cashWinnings ?? 0) > 0 || isWinningsPaid(entry)
}

/**
 * The payouts screen's row model: the materialized per-place table joined to
 * the finishing order, followed by the entries OUTSIDE the paid table that
 * still matter — players still in (deal candidates) and any entry already
 * carrying winnings (a deal that reached past the paid places). Pure.
 *
 * Row shape:
 *   place            — 1..P from the payout table, or the entry's own
 *                      finishingPlace, or null (still in, unplaced)
 *   entry / entryId / playerId — the matched entry (null for an unfilled place)
 *   alive            — entry is still in (includes the recorded winner)
 *   calculatedAmount — materialized structure amount for this place (0 off-table)
 *   payableAmount    — staged cashWinnings when present, else calculatedAmount
 *   isStaged / isAdjusted / isPaid
 */
/**
 * Expand the STORED payout table (tournament.payoutTable — the venue engine's
 * run-once output) into per-place {place, amount} rows; band members each get
 * the band's amount. Pure. Returns [] when no table is stored.
 */
export function payoutTablePlaces(payoutTable) {
  if (!payoutTable?.rows?.length) return []
  return payoutTable.rows.flatMap((r) => {
    const places = []
    for (let place = r.fromPlace; place <= r.toPlace; place++) {
      places.push({ place, amount: r.amount })
    }
    return places
  })
}

export function buildPayoutRows({ tournament, entries }) {
  const live = (entries ?? []).filter((e) => e.voidedAt === null)
  // The stored venue table is the SSOT when present (Guy's run-once directive,
  // 10 Aug 2026); the embedded payoutStructure is the legacy/manual fallback.
  const table = tournament.payoutTable
    ? payoutTablePlaces(tournament.payoutTable)
    : materializePayouts(tournament.payoutStructure, tournament.totalPrizePool)
  const entryByPlace = new Map(live.filter((e) => e.finishingPlace != null).map((e) => [e.finishingPlace, e]))

  const placeRows = table.map(({ place, amount }) =>
    makeRow({ place, entry: entryByPlace.get(place) ?? null, calculatedAmount: amount })
  )

  const inTable = new Set(placeRows.map((r) => r.entryId).filter(Boolean))
  const registeredMs = (e) => e.registeredAt?.toMillis?.() ?? 0
  const extraRows = live
    .filter((e) => !inTable.has(e.id) && (e.bustedAt === null || isWinningsStaged(e)))
    .sort(
      (a, b) =>
        (a.finishingPlace ?? Infinity) - (b.finishingPlace ?? Infinity) ||
        registeredMs(a) - registeredMs(b)
    )
    .map((e) => makeRow({ place: e.finishingPlace ?? null, entry: e, calculatedAmount: 0 }))

  return [...placeRows, ...extraRows]
}

function makeRow({ place, entry, calculatedAmount }) {
  const staged = Boolean(entry && isWinningsStaged(entry))
  return {
    place,
    entry,
    entryId: entry?.id ?? null,
    playerId: entry?.playerId ?? null,
    alive: Boolean(entry && entry.bustedAt === null),
    calculatedAmount,
    payableAmount: staged ? entry.cashWinnings : calculatedAmount,
    isStaged: staged,
    isAdjusted: staged && entry.cashWinnings !== calculatedAmount,
    isPaid: Boolean(entry && isWinningsPaid(entry)),
  }
}

/** Sum of a row set's payable amounts (for the total-vs-pool display). */
export function payoutRowsTotal(rows) {
  return (rows ?? []).reduce((sum, r) => sum + (r.payableAmount ?? 0), 0)
}

// ── Impure ops ──────────────────────────────────────────────────────────────

/**
 * Record the tournament winner: assign finishingPlace 1 to the sole remaining
 * alive entry. THE only way 1st place is ever assigned (a bust never does it —
 * seating.js refuses to eliminate the last player standing). Refused when more
 * than one entry is alive, or when a winner is already recorded.
 *
 * Like eliminateEntry, the decision is made from fresh entry docs re-read
 * INSIDE the transaction (the entry ids are listed outside — a collection query
 * can't run in a Firestore transaction), so a concurrent eliminate/revert
 * serializes against this and the retry re-checks the alive count.
 *
 * @returns {Promise<{ ok: true, entryId: string, playerId: string }>}
 */
export async function recordWinner({ tournament, actorId, actorRole }) {
  requireActor(actorId)
  const timestamp = now()
  const allEntries = await entriesApi.listEntries(tournament.id)

  const result = await runValidatedTransaction(async (tx) => {
    const fresh = []
    for (const e of allEntries) {
      fresh.push(await tx.get(paths.entryPath(tournament.id, e.id), Entry))
    }
    const nonVoided = fresh.filter((e) => e.voidedAt === null)
    if (nonVoided.some((e) => e.finishingPlace === 1)) throw new WinnerAlreadyRecordedError()

    const alive = nonVoided.filter((e) => e.bustedAt === null)
    if (alive.length === 0) throw new PayoutsError('No remaining player to record as the winner.')
    if (alive.length > 1) throw new MultiplePlayersRemainError(alive.length)

    const winner = alive[0]
    // The winner stays un-busted (they never lost their chips) — finishingPlace
    // 1 with bustedAt null is the winner's canonical shape.
    tx.set(paths.entryPath(tournament.id, winner.id), Entry, {
      ...winner,
      finishingPlace: 1,
      updatedAt: timestamp,
    })
    return { entryId: winner.id, playerId: winner.playerId }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'entry.winnerRecorded',
    targetType: 'entry',
    targetId: result.entryId,
    timestamp,
    metadata: { tournamentId: tournament.id, playerId: result.playerId, place: 1 },
  })

  return { ok: true, ...result }
}

/**
 * Undo a recorded winner (clears finishingPlace 1). Refused once winnings are
 * recorded or paid on the winner's entry — symmetric with revertElimination's
 * RevertBlockedByPayoutError guard.
 *
 * @returns {Promise<{ ok: true, entryId: string }>}
 */
export async function revertWinner({ tournament, actorId, actorRole }) {
  requireActor(actorId)
  const timestamp = now()
  const allEntries = await entriesApi.listEntries(tournament.id)
  const current = recordedWinner(allEntries)
  if (!current) throw new NoWinnerRecordedError()

  const result = await runValidatedTransaction(async (tx) => {
    const target = await tx.get(paths.entryPath(tournament.id, current.id), Entry)
    if (target.voidedAt !== null || target.finishingPlace !== 1) throw new NoWinnerRecordedError()
    if (
      (target.cashWinnings ?? 0) > 0 ||
      (target.ticketWinnings ?? 0) > 0 ||
      target.winningsPaidAt !== null
    ) {
      throw new WinnerRevertBlockedError()
    }
    tx.set(paths.entryPath(tournament.id, target.id), Entry, {
      ...target,
      finishingPlace: null,
      updatedAt: timestamp,
    })
    return { entryId: target.id }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'entry.winnerReverted',
    targetType: 'entry',
    targetId: result.entryId,
    timestamp,
    metadata: { tournamentId: tournament.id },
  })

  return { ok: true, ...result }
}

/**
 * Enter a deal / adjust payouts (task 4.5): stage agreed per-player amounts by
 * setting each affected entry's cashWinnings — the recorded result per the
 * schema design note (no deals collection). Alive entries are fine (deals
 * happen among the last N standing); paid rows are refused. The audit row
 * `tournament.dealEntered` records the agreed table + why (metadata.payouts).
 *
 * Staging is NOT paying: the wallet is only credited when the cashier confirms
 * each row (wallet/winCredit.js confirmEntryWinCredit).
 *
 * Total guard: the grand total across ALL non-voided entries as they'd stand
 * after this deal (allocations override, untouched entries keep their staged
 * amounts) must equal the prize pool — recomputed from the fresh entry reads
 * via computeEntryCounters, the SSOT formula (entries × buy-in, hospitality
 * excluded). A mismatch is allowed only with actorRole 'manager' AND a
 * managerOverride {reason}; that emits an extra manager.override audit row.
 *
 * @param {object} args
 * @param {object} args.tournament
 * @param {Array<{entryId: string, amount: number}>} args.allocations  integer cents ≥ 0 (0 clears a staged row)
 * @param {string|null} [args.notes]                — why / what was agreed
 * @param {{reason: string}|null} [args.managerOverride]  — required when total ≠ prize pool
 * @param {string} args.actorId
 * @param {'manager'|'td'} args.actorRole
 *
 * @returns {Promise<{ ok: true, grandTotal: number, prizePool: number, delta: number, overrideUsed: boolean }>}
 */
export async function enterDeal({
  tournament,
  allocations,
  notes = null,
  managerOverride = null,
  actorId,
  actorRole,
}) {
  requireActor(actorId)
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new PayoutsError('a deal needs at least one payout allocation')
  }
  for (const a of allocations) {
    if (!a || typeof a.entryId !== 'string' || a.entryId.trim() === '') {
      throw new PayoutsError('every allocation needs an entryId')
    }
    if (!Number.isInteger(a.amount) || a.amount < 0) {
      throw new PayoutsError('every allocation amount must be integer cents ≥ 0')
    }
  }
  const ids = allocations.map((a) => a.entryId)
  if (new Set(ids).size !== ids.length) {
    throw new PayoutsError('an entry appears more than once in the deal allocations')
  }

  const timestamp = now()
  const amountById = new Map(allocations.map((a) => [a.entryId, a.amount]))
  const allEntries = await entriesApi.listEntries(tournament.id)
  let overrideUsed = false

  const result = await runValidatedTransaction(async (tx) => {
    // Fresh full-doc reads of every entry: the affected ones get guarded +
    // rewritten; the rest feed the grand-total / prize-pool computation from
    // the same consistent snapshot (venue field sizes keep this well inside
    // transaction limits — same call as eliminateEntry / recountTournamentEntries).
    const fresh = []
    for (const e of allEntries) {
      fresh.push(await tx.get(paths.entryPath(tournament.id, e.id), Entry))
    }
    const freshById = new Map(fresh.map((e) => [e.id, e]))

    for (const a of allocations) {
      const target = freshById.get(a.entryId)
      if (!target) throw new PayoutsError(`entry ${a.entryId} does not exist in this tournament`)
      if (target.voidedAt !== null) throw new PayoutsError('a voided entry cannot receive winnings')
      if (target.winningsPaidAt !== null) throw new DealRowAlreadyPaidError()
    }

    const nonVoided = fresh.filter((e) => e.voidedAt === null)
    const prizePool = computeEntryCounters(fresh, tournament.buyIn).totalPrizePool
    const grandTotal = nonVoided.reduce(
      (sum, e) => sum + (amountById.has(e.id) ? amountById.get(e.id) : (e.cashWinnings ?? 0)),
      0
    )
    if (grandTotal !== prizePool) {
      const reason = managerOverride?.reason
      if (actorRole !== 'manager' || typeof reason !== 'string' || reason.trim() === '') {
        throw new DealTotalMismatchError({ grandTotal, prizePool })
      }
      overrideUsed = true
    }

    const payoutsMeta = []
    for (const a of allocations) {
      const target = freshById.get(a.entryId)
      payoutsMeta.push({
        entryId: a.entryId,
        playerId: target.playerId,
        place: target.finishingPlace,
        previousAmount: target.cashWinnings,
        amount: a.amount,
      })
      tx.set(paths.entryPath(tournament.id, a.entryId), Entry, {
        ...target,
        cashWinnings: a.amount,
        updatedAt: timestamp,
      })
    }
    return { grandTotal, prizePool, payoutsMeta }
  })

  const delta = result.grandTotal - result.prizePool
  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'tournament.dealEntered',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: {
      payouts: result.payoutsMeta,
      notes,
      grandTotal: result.grandTotal,
      prizePool: result.prizePool,
      delta,
      override: overrideUsed,
    },
  })
  if (overrideUsed) {
    await emitManagerOverride({
      actorId,
      overrideType: 'dealTotalMismatch',
      reason: managerOverride.reason,
      targetType: 'tournament',
      targetId: tournament.id,
      context: { grandTotal: result.grandTotal, prizePool: result.prizePool, delta },
    })
  }

  return { ok: true, grandTotal: result.grandTotal, prizePool: result.prizePool, delta, overrideUsed }
}
