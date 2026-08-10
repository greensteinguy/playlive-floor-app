// Stored payout table — the run-once wiring around the pure payout engine
// (src/lib/payoutEngine.js; spec: docs/payouts/venue-payout-engine-spec.md).
//
// Guy's architecture directive (10 Aug 2026): the engine's output is computed
// once per tournament, STORED on the tournament doc, and every screen reads
// the stored table. Entry events refresh it, but throttled — at most once per
// 5 minutes (his failsafe) — and the table FREEZES once late reg closes
// (recompute after that only via an explicit manager/td force).
//
// There is no server here: the throttle rides inside the transactions the
// entry ops already run, so "every 5 minutes" costs nothing when the desk is
// quiet and at most one extra doc-field write when it's busy.

import { runValidatedTransaction, auditLog, paths } from '../firestore'
import { Tournament } from '../schema'
import { computeVenuePayouts } from '../payoutEngine'
import { now } from '../wallet/_shared'
import { TournamentError } from './errors'

export const PAYOUT_REFRESH_MIN_INTERVAL_MS = 5 * 60_000

// Statuses where the table is frozen (recompute only via force).
const FROZEN_STATUSES = ['lateRegClosed', 'finished', 'cancelled']

/** Map the tournament doc onto the engine's inputs. Pure. */
export function engineInputsFromTournament(tournament) {
  const cfg = tournament.payoutConfig
  return {
    entries: tournament.entryCount,
    buyInCents: tournament.buyIn,
    hospitalityCents: tournament.hospitalityCost,
    addOnCount: cfg.addOnCount,
    addOnPriceCents: tournament.reentryConfig?.addOnCost ?? 0,
    // Handedness follows the tournament's table size; the sheet's "Mix Max"
    // variant has no v1 tournament format — revisit if the venue runs one.
    handedness: tournament.maxSeatsPerTable <= 6 ? '6handed' : '9handed',
    spotsRatio: cfg.spotsRatio,
    minCashMultiplier: cfg.minCashMultiplier,
    guaranteeCents: tournament.guarantee,
    equityRefundsCents: cfg.equityRefunds,
    includePoints: cfg.seriesEvent,
  }
}

/**
 * The refresh policy, pure so it's testable:
 * missing table (with entries) → yes; frozen status → no; unchanged entry
 * count → no; fresher than the 5-minute throttle → no; otherwise yes.
 */
export function shouldRefreshPayoutTable(tournament, nowMs) {
  if (!tournament || tournament.entryCount < 1) return false
  if (FROZEN_STATUSES.includes(tournament.status)) return false
  const table = tournament.payoutTable
  if (!table) return true
  if (table.entryCountAtCompute === tournament.entryCount) return false
  const computedMs = table.computedAt?.toMillis?.() ?? 0
  return nowMs - computedMs >= PAYOUT_REFRESH_MIN_INTERVAL_MS
}

/** Engine result → the stored PayoutTable shape. Pure. */
export function tableFromEngineResult(result, { entryCount, seriesEvent, extraWarnings = [] }) {
  return {
    computedAt: now(),
    entryCountAtCompute: entryCount,
    placesPaid: result.placesPaid,
    minCash: result.minCashCents,
    adjPrizePool: result.adjPrizePoolCents,
    tailRatio: result.tailRatio,
    ratioFlag: result.ratioFlag,
    seriesEvent,
    warnings: [...result.warnings, ...extraWarnings],
    rows: result.rows.map((r) => ({
      fromPlace: r.fromPlace,
      toPlace: r.toPlace,
      size: r.size,
      amount: r.amountCents,
      rowTotal: r.rowTotalCents,
      points: r.points,
    })),
  }
}

/**
 * Recompute + store the payout table from FRESH in-transaction reads.
 * Policy-gated unless `force` (the screen's explicit Recompute button).
 * Returns { refreshed, table, skippedReason? }.
 */
export async function refreshPayoutTable({ tournamentId, actorId, actorRole, force = false }) {
  if (typeof tournamentId !== 'string' || tournamentId === '') {
    throw new TournamentError('tournamentId is required')
  }

  const outcome = await runValidatedTransaction(async (tx) => {
    const fresh = await tx.get(paths.tournamentPath(tournamentId), Tournament)

    if (!force && !shouldRefreshPayoutTable(fresh, Date.now())) {
      return { refreshed: false, table: fresh.payoutTable, skippedReason: 'policy' }
    }
    if (fresh.entryCount < 1) {
      if (force) throw new TournamentError('No entries yet — nothing to compute a payout table from.')
      return { refreshed: false, table: fresh.payoutTable, skippedReason: 'noEntries' }
    }

    const result = computeVenuePayouts(engineInputsFromTournament(fresh))
    if (result.rows.length === 0) {
      throw new TournamentError(`Payout calculation failed: ${result.warnings.join('; ')}`)
    }
    if (result.rows.some((r) => r.amountCents < 0)) {
      throw new TournamentError(
        'Payout calculation produced a negative payout — check the pool vs min-cash configuration.'
      )
    }

    // The engine derives the pool from entries × buyIn per the sheet; the app
    // tracks the REAL pool from actual payments. Surface any drift instead of
    // hiding it (comps, mixed pricing, and manual adjustments can cause it).
    const extraWarnings = []
    if (fresh.totalPrizePool > 0 && result.prizePoolCents !== fresh.totalPrizePool) {
      extraWarnings.push(
        `engine pool (${result.prizePoolCents}) differs from tracked prize pool (${fresh.totalPrizePool}) — table is based on the engine's sheet math`
      )
    }

    const table = tableFromEngineResult(result, {
      entryCount: fresh.entryCount,
      seriesEvent: fresh.payoutConfig.seriesEvent,
      extraWarnings,
    })
    tx.set(paths.tournamentPath(tournamentId), Tournament, {
      ...fresh,
      payoutTable: table,
      updatedAt: now(),
    })
    return { refreshed: true, table }
  })

  if (outcome.refreshed) {
    await auditLog.writeAuditLogSafe({
      actionType: 'tournament.payoutTableComputed',
      actorId,
      actorRole,
      targetType: 'tournament',
      targetId: tournamentId,
      metadata: {
        placesPaid: outcome.table.placesPaid,
        entryCountAtCompute: outcome.table.entryCountAtCompute,
        adjPrizePool: outcome.table.adjPrizePool,
        ratioFlag: outcome.table.ratioFlag,
        forced: force,
        warnings: outcome.table.warnings,
      },
    })
  }
  return outcome
}

/**
 * Update the payout knobs and recompute in the SAME transaction, so the
 * stored table can never disagree with the stored config.
 */
export async function updatePayoutConfig({ tournamentId, patch, actorId, actorRole }) {
  if (typeof tournamentId !== 'string' || tournamentId === '') {
    throw new TournamentError('tournamentId is required')
  }

  const outcome = await runValidatedTransaction(async (tx) => {
    const fresh = await tx.get(paths.tournamentPath(tournamentId), Tournament)
    const payoutConfig = { ...fresh.payoutConfig, ...patch }

    let table = fresh.payoutTable
    if (fresh.entryCount >= 1) {
      const result = computeVenuePayouts(
        engineInputsFromTournament({ ...fresh, payoutConfig })
      )
      if (result.rows.length === 0) {
        throw new TournamentError(`Payout calculation failed: ${result.warnings.join('; ')}`)
      }
      if (result.rows.some((r) => r.amountCents < 0)) {
        throw new TournamentError(
          'These settings produce a negative payout — check the pool vs min-cash configuration.'
        )
      }
      table = tableFromEngineResult(result, {
        entryCount: fresh.entryCount,
        seriesEvent: payoutConfig.seriesEvent,
      })
    }

    tx.set(paths.tournamentPath(tournamentId), Tournament, {
      ...fresh,
      payoutConfig,
      payoutTable: table,
      updatedAt: now(),
    })
    return { payoutConfig, table }
  })

  await auditLog.writeAuditLogSafe({
    actionType: 'tournament.payoutConfigChanged',
    actorId,
    actorRole,
    targetType: 'tournament',
    targetId: tournamentId,
    metadata: { patch, recomputed: outcome.table !== null },
  })
  return outcome
}
