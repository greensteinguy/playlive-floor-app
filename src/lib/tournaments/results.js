// Final results derivations — Phase 4 task 4.10.
//
// The results page is the end-of-night artifact: what happened, who won what.
// EVERYTHING here is derived from data other ops already wrote (entries,
// tournament counters, audit rows) — no Firestore, no writes, no new ops.
// Pure and unit-tested; the page (pages/td/TournamentResults.jsx) only renders.
//
// Standings grouping (the mid-tournament honesty rule): a results page opened
// while play is still running must not pretend the tournament is decided, so
// entries split into four explicit groups instead of one forced ranking:
//   placed        — finishingPlace recorded (1st = the recorded winner: the
//                   non-voided finishingPlace-1 entry, per payouts.js
//                   recordedWinner; every other place comes from bust-outs)
//   ticketWinners — satellite milestone winners: finishingPlace null with
//                   ticketWinnings > 0 (canonical §5.2 — a milestone exit is a
//                   win, not a finishing position)
//   stillIn       — alive and unplaced (tournament still running)
//   unplaced      — busted with no finishingPlace recorded (pre-places busts)
//
// Paid marker: `winningsPaidAt` is the cashier-confirmed flag (see payouts.js
// header). A row with winnings but no winningsPaidAt is staged — "Awaiting
// cashier". Zero-winnings rows carry no marker. Note the deliberate coarseness:
// mystery-bounty credits are confirmed per DRAW (bountyDraws.walletTransactionId),
// not via winningsPaidAt, so a bounty-only row can read "Awaiting cashier"
// after its draws were credited — acceptable for v1; the payouts screen is the
// operational source of truth for per-row payment state.

import { entryWinnings } from '../entryDisplay'
import { isWinningsPaid } from './payouts'

// ── Header facts ─────────────────────────────────────────────────────────────

/**
 * Entry counts for the header, voided excluded: total entries (the same count
 * that feeds the prize-pool SSOT — computeEntryCounters counts every live
 * entry), initial entries, and re-entries (everything non-initial: reentry /
 * rebuy / add-on rows). Pure.
 */
export function entryTypeCounts(entries) {
  const live = (entries ?? []).filter((e) => e.voidedAt === null)
  const initial = live.filter((e) => e.entryType === 'initial').length
  return { total: live.length, initial, reentries: live.length - initial }
}

/**
 * Guarantee met/missed, or null when the tournament has no guarantee.
 * Compares against totalPrizePool — the denormalized prize-pool SSOT
 * (entries × buy-in, hospitality excluded). Pure.
 *
 * @returns {{ guarantee:number, prizePool:number, met:boolean, shortfall:number }|null}
 */
export function guaranteeStatus(tournament) {
  const guarantee = tournament?.guarantee ?? 0
  if (guarantee <= 0) return null
  const prizePool = tournament?.totalPrizePool ?? 0
  return {
    guarantee,
    prizePool,
    met: prizePool >= guarantee,
    shortfall: Math.max(0, guarantee - prizePool),
  }
}

// ── Standings ────────────────────────────────────────────────────────────────

/** Display labels for the standings groups, in render order. */
export const RESULTS_GROUP_LABEL = {
  placed: 'Final standings',
  ticketWinners: 'Ticket winners',
  stillIn: 'Still in play',
  unplaced: 'Busted — no place recorded',
}

/**
 * Paid/staged marker for a standings row, derived from winningsPaidAt (the
 * cashier-confirm stamp): 'paid' | 'staged' | null (no winnings — unmarked).
 * Pure.
 */
export function resultPaidState(entry) {
  if (entryWinnings(entry) === 0) return null
  return isWinningsPaid(entry) ? 'paid' : 'staged'
}

/** Row-marker labels: paid rows "Paid", staged-but-unpaid "Awaiting cashier". */
export const RESULT_PAID_STATE_LABEL = {
  paid: 'Paid',
  staged: 'Awaiting cashier',
}

const registeredMs = (e) => e.registeredAt?.toMillis?.() ?? 0
const bustedMs = (e) => e.bustedAt?.toMillis?.() ?? 0

function resultRow(entry, group) {
  return {
    group,
    entry,
    entryId: entry.id,
    playerId: entry.playerId,
    place: entry.finishingPlace ?? null,
    cash: entry.cashWinnings ?? 0,
    bounty: entry.bountyEarnings ?? 0,
    ticket: entry.ticketWinnings ?? 0,
    total: entryWinnings(entry),
    paidState: resultPaidState(entry),
  }
}

/**
 * The standings model (see module header for the grouping rules). Voided
 * entries are excluded everywhere. Ordering: placed by place ascending (1st
 * first); ticketWinners by when they reached the milestone (bustedAt, the
 * milestone exit stamp), earliest first; stillIn by registration order;
 * unplaced by bust time, earliest first (matches seating.js finishingOrder's
 * null-place tiebreak). Pure.
 *
 * @returns {{ placed:Array, ticketWinners:Array, stillIn:Array, unplaced:Array }}
 */
export function buildResultsStandings(entries) {
  const live = (entries ?? []).filter((e) => e.voidedAt === null)

  const placed = live
    .filter((e) => e.finishingPlace != null)
    .sort((a, b) => a.finishingPlace - b.finishingPlace)
    .map((e) => resultRow(e, 'placed'))

  const ticketWinners = live
    .filter((e) => e.finishingPlace == null && (e.ticketWinnings ?? 0) > 0)
    .sort((a, b) => bustedMs(a) - bustedMs(b) || registeredMs(a) - registeredMs(b))
    .map((e) => resultRow(e, 'ticketWinners'))

  const stillIn = live
    .filter((e) => e.finishingPlace == null && e.bustedAt === null && (e.ticketWinnings ?? 0) === 0)
    .sort((a, b) => registeredMs(a) - registeredMs(b))
    .map((e) => resultRow(e, 'stillIn'))

  const unplaced = live
    .filter((e) => e.finishingPlace == null && e.bustedAt !== null && (e.ticketWinnings ?? 0) === 0)
    .sort((a, b) => bustedMs(a) - bustedMs(b))
    .map((e) => resultRow(e, 'unplaced'))

  return { placed, ticketWinners, stillIn, unplaced }
}

/**
 * The standings groups flattened to one list in render order (placed →
 * ticketWinners → stillIn → unplaced) — feeds the table body and the CSV
 * export from a single derivation. Pure.
 */
export function flattenStandings(standings) {
  if (!standings) return []
  return [
    ...(standings.placed ?? []),
    ...(standings.ticketWinners ?? []),
    ...(standings.stillIn ?? []),
    ...(standings.unplaced ?? []),
  ]
}

// ── Deal note ────────────────────────────────────────────────────────────────

/**
 * The newest tournament.dealEntered audit row for this tournament, surfaced as
 * a display note, or null when no deal was recorded. The page queries the
 * auditLog by (targetType 'tournament', targetId, timestamp desc) — the
 * composite index that already exists — and filters the actionType here, so no
 * new index is needed. Pure.
 *
 * @returns {{ timestamp:object|null, grandTotal:number|null, prizePool:number|null,
 *             delta:number|null, notes:string|null, override:boolean,
 *             playerCount:number|null }|null}
 */
export function latestDealFromAudit(auditRows, tournamentId) {
  const deal = (auditRows ?? [])
    .filter((r) => r.actionType === 'tournament.dealEntered' && r.targetId === tournamentId)
    .sort((a, b) => (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0))[0]
  if (!deal) return null
  const meta = deal.metadata ?? {}
  return {
    timestamp: deal.timestamp ?? null,
    grandTotal: meta.grandTotal ?? null,
    prizePool: meta.prizePool ?? null,
    delta: meta.delta ?? null,
    notes: meta.notes ?? null,
    override: meta.override === true,
    playerCount: Array.isArray(meta.payouts) ? meta.payouts.length : null,
  }
}
