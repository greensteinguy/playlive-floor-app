// Tournament registration (Phase 3 tasks 3.4 + 3.5). Orchestrates taking a
// player into a tournament: it plans the entry (initial vs re-entry, with a
// duplicate guard), then calls the appropriate wallet payment op — which writes
// the entry doc + the ledger rows ATOMICALLY in one transaction — and finally
// recomputes the tournament's denormalized counters from the entries
// subcollection (the wallet ops deliberately don't touch the tournament doc;
// prize pools / counts are the tournament module's concern).
//
// The four payment methods (cash / EFTPOS / wallet / ticket) and the ticket
// equal-or-greater rule + top-up + manager-override are all already implemented
// and tested in the wallet module — this layer just selects the right one and
// builds the entryData the wallet op expects. Pure planning helpers
// (totalEntryCost / registrationOpen / registrableSessions / planEntry /
// computeEntryCounters) live here too so the page + the unit tests can reason
// about registration without a renderer.

import { entries as entriesApi, runValidatedTransaction, paths } from '../firestore'
import { Tournament, Entry } from '../schema'
import { now } from '../wallet/_shared'
import {
  payViaExternalMethod,
  payViaWallet,
  payViaTicket,
  voidEntryWithRefund,
  RegistrationClosedError,
} from '../wallet'
import { TournamentError } from './errors'

// ── Pure planning helpers ──────────────────────────────────────────────────

/** What the player pays to enter: buy-in + hospitality (no rake at this venue). */
export function totalEntryCost(tournament) {
  return (tournament?.buyIn ?? 0) + (tournament?.hospitalityCost ?? 0)
}

/** Registration is open while the tournament is taking entries (pre-reg or late reg). */
export function registrationOpen(tournament) {
  return tournament?.status === 'scheduled' || tournament?.status === 'lateRegOpen'
}

/**
 * The sessions a NEW entry can originate in — the earliest stage (Day 1 flights).
 * A session is an entry point when no other session converges INTO it; survivors
 * then progress along the convergesIntoSessionId chain. Cancelled sessions are
 * excluded. Sorted by day then label for a stable picker.
 */
export function registrableSessions(sessions) {
  const list = sessions ?? []
  const downstream = new Set(list.map((s) => s.convergesIntoSessionId).filter(Boolean))
  return list
    .filter((s) => !downstream.has(s.id) && s.status !== 'cancelled')
    .sort(
      (a, b) =>
        (a.dayNumber ?? 0) - (b.dayNumber ?? 0) ||
        (a.sessionLabel ?? '').localeCompare(b.sessionLabel ?? '')
    )
}

/**
 * Decide the entry type + number for a player given their existing entries in
 * this tournament, or a human-readable blockedReason when they can't register.
 *
 * - No prior entry → initial #1.
 * - Already has a still-alive entry → blocked (can't register twice at once).
 * - Busted out, freezeout → blocked (no re-entry).
 * - Busted out, re-entry/rebuy allowed → a new entry, subject to
 *   maxReentries / maxRebuys.
 *
 * entryNumber is the max across ALL of the player's entries INCLUDING voided
 * ones, +1 — never a reused number. Entry doc ids are deterministic
 * (`{playerId}_{entryNumber}`, see registerEntry), so a voided entry's doc
 * still occupies its id and its number must stay retired. Re-entry LIMITS,
 * by contrast, only count non-voided entries (a voided buy-in never happened).
 *
 * @returns {{ entryType: string|null, entryNumber: number|null, blockedReason: string|null }}
 */
export function planEntry({ playerEntries, reentryConfig }) {
  const all = playerEntries ?? []
  const pe = all.filter((e) => e.voidedAt === null)
  // Count is the floor so a fixture/legacy row without entryNumber still advances.
  const nextNumber = all.reduce((max, e) => Math.max(max, e.entryNumber ?? 0), all.length) + 1
  if (pe.length === 0) {
    return { entryType: 'initial', entryNumber: nextNumber, blockedReason: null }
  }
  if (pe.some((e) => e.bustedAt === null)) {
    return {
      entryType: null,
      entryNumber: null,
      blockedReason: 'This player already has an active entry in this tournament.',
    }
  }
  const type = reentryConfig?.type
  if (type === 'freezeout') {
    return {
      entryType: null,
      entryNumber: null,
      blockedReason: 'This is a freezeout — the player has already busted and re-entry is not allowed.',
    }
  }
  const priorReentries = pe.filter((e) => e.entryType !== 'initial').length
  const max = type === 'rebuy' ? reentryConfig?.maxRebuys : reentryConfig?.maxReentries
  if (max != null && priorReentries >= max) {
    return { entryType: null, entryNumber: null, blockedReason: `Re-entry limit reached (max ${max}).` }
  }
  return {
    entryType: type === 'rebuy' ? 'rebuy' : 'reentry',
    entryNumber: nextNumber,
    blockedReason: null,
  }
}

/**
 * Recompute the tournament's denormalized counters from its entries. Voided
 * entries don't count; remaining = not-yet-busted; prize pool = entries × buy-in
 * (the whole buy-in enters the pool — hospitality does not).
 */
export function computeEntryCounters(allEntries, buyIn) {
  const live = (allEntries ?? []).filter((e) => e.voidedAt === null)
  const entryCount = live.length
  return {
    entryCount,
    uniquePlayerCount: new Set(live.map((e) => e.playerId)).size,
    remainingPlayerCount: live.filter((e) => e.bustedAt === null).length,
    totalPrizePool: entryCount * (buyIn ?? 0),
  }
}

// ── Operations ──────────────────────────────────────────────────────────────

/**
 * Recompute + persist a tournament's entry counters from its entries subcollection.
 * Read-modify-write so the whole doc re-validates. Returns the new counters.
 * (The entries list is read outside the transaction — a collection read can't run
 * inside one — which is safe because the counters are a cache: this is idempotent
 * and self-healing, so a stale read just gets corrected on the next recount.)
 */
export async function recountTournamentEntries({ tournamentId }) {
  if (typeof tournamentId !== 'string' || tournamentId.trim() === '') {
    throw new TournamentError('tournamentId is required (non-empty string)')
  }
  const allEntries = await entriesApi.listEntries(tournamentId)
  return runValidatedTransaction(async (tx) => {
    const t = await tx.get(paths.tournamentPath(tournamentId), Tournament)
    const counters = computeEntryCounters(allEntries, t.buyIn)
    tx.set(paths.tournamentPath(tournamentId), Tournament, { ...t, ...counters, updatedAt: now() })
    return counters
  })
}

/**
 * Register a player into a tournament and take the buy-in.
 *
 * Validates the registration is allowed (open status, not a duplicate/over-limit
 * entry), builds the entryData, and delegates to the matching wallet op (which
 * does the atomic entry + ledger write). Then recomputes the tournament counters
 * (best-effort — they're a rebuildable cache, so a recount failure never undoes a
 * committed registration). Throws TournamentError for a planning/validation
 * failure (before any write) and propagates the wallet module's typed errors
 * (InsufficientWalletBalanceError, TicketBelowFaceValueError, …) from the payment.
 *
 * @param {object} args
 * @param {object} args.tournament
 * @param {string} args.originSessionId          — which flight/session the entry joins
 * @param {object} args.player                   — the selected Player doc
 * @param {Array<object>} args.playerEntries     — this player's existing entries in this tournament
 * @param {'cash'|'eftpos'|'wallet'|'ticket'} args.paymentMethod
 * @param {string|null} [args.reference]         — EFTPOS approval / note (cash/eftpos)
 * @param {string|null} [args.ticketId]          — ticket to redeem (ticket method)
 * @param {{method:'cash'|'eftpos', reference:string|null}|null} [args.topUp]  — covers a ticket shortfall
 * @param {{reason:string}|null} [args.managerOverride]  — use a ticket below face value
 * @param {'upper'|'main'|null} [args.lastLongerDeck]  — optional last-longer deck pick (tournaments with hasUpperDeckMainDeck)
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 */
export async function registerEntry({
  tournament,
  originSessionId,
  player,
  playerEntries,
  paymentMethod,
  reference = null,
  ticketId = null,
  topUp = null,
  managerOverride = null,
  lastLongerDeck = null,
  actorId,
  actorRole,
}) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new TournamentError('actorId is required (non-empty string)')
  }
  if (!tournament || typeof tournament.id !== 'string') {
    throw new TournamentError('tournament is required')
  }
  if (!player || typeof player.id !== 'string') {
    throw new TournamentError('a player must be selected')
  }
  if (typeof originSessionId !== 'string' || originSessionId.trim() === '') {
    throw new TournamentError('a flight/session must be chosen for the entry')
  }
  if (!registrationOpen(tournament)) {
    throw new TournamentError(`Registration is not open for this tournament (status: ${tournament.status}).`)
  }
  if (lastLongerDeck !== null) {
    if (lastLongerDeck !== 'upper' && lastLongerDeck !== 'main') {
      throw new TournamentError(`unknown last-longer deck "${lastLongerDeck}"`)
    }
    if (!tournament.hasUpperDeckMainDeck) {
      throw new TournamentError('This tournament does not have the Upper Deck / Main Deck split.')
    }
  }

  const plan = planEntry({ playerEntries: playerEntries ?? [], reentryConfig: tournament.reentryConfig })
  if (plan.blockedReason) {
    throw new TournamentError(plan.blockedReason)
  }

  const totalCost = totalEntryCost(tournament)
  if (totalCost <= 0) {
    throw new TournamentError('This tournament has no buy-in to charge.')
  }

  // Deterministic entry id — the duplicate/idempotency gate. Two devices
  // registering the same player compute the same next entryNumber and collide
  // on this id inside the payment transaction (one commits, the other gets a
  // DuplicateEntryError instead of charging again); a timeout-retry of the SAME
  // gesture finds its own committed entry and replays the result.
  const entryId = `${player.id}_${plan.entryNumber}`

  const entryData = {
    tournamentId: tournament.id,
    playerId: player.id,
    originSessionId,
    entryType: plan.entryType,
    entryNumber: plan.entryNumber,
    registeredAt: now(),
    registeredBy: actorId,
  }

  // Business-rule re-checks on FRESH reads inside the payment transaction —
  // the checks above ran on the desk's snapshot, which can be minutes old.
  // Runs after the duplicate probe (a replay skips it: that registration
  // already happened under the rules of its moment) and before any write.
  const inTransactionGuard = async (tx) => {
    const freshTournament = await tx.get(paths.tournamentPath(tournament.id), Tournament)
    if (!registrationOpen(freshTournament)) {
      throw new RegistrationClosedError({
        tournamentId: tournament.id,
        status: freshTournament.status,
      })
    }
    // Re-read the entries the plan was based on. New entries by OTHER devices
    // are caught by the deterministic-id probe, so re-reading the known set is
    // enough to re-validate the plan (alive entry, re-entry limits, numbering).
    const freshEntries = []
    for (const e of playerEntries ?? []) {
      const fresh = await tx.getOptional(paths.entryPath(tournament.id, e.id), Entry)
      if (fresh) freshEntries.push(fresh)
    }
    const freshPlan = planEntry({
      playerEntries: freshEntries,
      reentryConfig: freshTournament.reentryConfig,
    })
    if (freshPlan.blockedReason) throw new TournamentError(freshPlan.blockedReason)
    if (freshPlan.entryType !== plan.entryType || freshPlan.entryNumber !== plan.entryNumber) {
      throw new TournamentError(
        "This player's entries changed while confirming — refresh and try again."
      )
    }
  }

  let walletResult
  if (paymentMethod === 'cash' || paymentMethod === 'eftpos') {
    walletResult = await payViaExternalMethod({
      entryData,
      totalCost,
      method: paymentMethod,
      reference: reference ?? null,
      actorId,
      actorRole,
      entryId,
      inTransactionGuard,
    })
  } else if (paymentMethod === 'wallet') {
    walletResult = await payViaWallet({ entryData, totalCost, actorId, actorRole, entryId, inTransactionGuard })
  } else if (paymentMethod === 'ticket') {
    if (typeof ticketId !== 'string' || ticketId.trim() === '') {
      throw new TournamentError('a ticket must be selected for ticket payment')
    }
    walletResult = await payViaTicket({
      entryData,
      totalCost,
      ticketId,
      topUp,
      managerOverride,
      actorId,
      actorRole,
      entryId,
      inTransactionGuard,
    })
  } else {
    throw new TournamentError(`unknown payment method "${paymentMethod}"`)
  }

  // Record the optional last-longer deck pick on the fresh entry. The wallet ops
  // create every entry with lastLongerDeck: null (payment is their concern, not
  // the side bet), so the pick is a follow-up validated full-doc write. Best-effort
  // AFTER the committed registration — a failure here must not look like a failed
  // buy-in (the desk would re-charge the player); the caller gets
  // lastLongerDeckApplied: false and can warn instead.
  let lastLongerDeckApplied = null
  if (lastLongerDeck !== null && !walletResult.alreadyRegistered) {
    try {
      await runValidatedTransaction(async (tx) => {
        const fresh = await tx.get(paths.entryPath(tournament.id, walletResult.entryId), Entry)
        tx.set(paths.entryPath(tournament.id, walletResult.entryId), Entry, {
          ...fresh,
          lastLongerDeck,
          updatedAt: now(),
        })
      })
      lastLongerDeckApplied = true
    } catch {
      lastLongerDeckApplied = false
    }
  }

  // Refresh the cached counters from the source of truth. Best-effort.
  let counters = null
  try {
    counters = await recountTournamentEntries({ tournamentId: tournament.id })
  } catch {
    counters = null
  }

  return {
    ...walletResult,
    entryType: plan.entryType,
    entryNumber: plan.entryNumber,
    totalCost,
    counters,
    lastLongerDeck,
    lastLongerDeckApplied,
  }
}

/**
 * Void a mistaken entry and reverse its payment — the desk's escape valve for
 * a wrong buy-in. Delegates the atomic void+refund to the wallet module
 * (voidEntryWithRefund: wallet credit-back / external cash-EFTPOS refund row /
 * ticket reinstatement, refused once the entry is busted or paid out), then
 * best-effort recounts the tournament's cached counters (like registerEntry —
 * a recount failure never undoes the committed void).
 *
 * @param {object} args
 * @param {object} args.tournament
 * @param {object} args.entry
 * @param {string} args.reason
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 */
export async function voidEntry({ tournament, entry, reason, actorId, actorRole }) {
  if (!tournament || typeof tournament.id !== 'string') {
    throw new TournamentError('tournament is required')
  }
  if (!entry || typeof entry.id !== 'string') {
    throw new TournamentError('an entry must be selected')
  }

  const result = await voidEntryWithRefund({
    tournamentId: tournament.id,
    entryId: entry.id,
    reason,
    actorId,
    actorRole,
  })

  let counters = null
  try {
    counters = await recountTournamentEntries({ tournamentId: tournament.id })
  } catch {
    counters = null
  }

  return { ...result, counters }
}
