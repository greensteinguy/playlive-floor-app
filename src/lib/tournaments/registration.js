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
import { payViaExternalMethod, payViaWallet, payViaTicket } from '../wallet'
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
 * - Busted out, re-entry/rebuy allowed → a new entry (number = prior count + 1),
 *   subject to maxReentries / maxRebuys.
 *
 * @returns {{ entryType: string|null, entryNumber: number|null, blockedReason: string|null }}
 */
export function planEntry({ playerEntries, reentryConfig }) {
  const pe = (playerEntries ?? []).filter((e) => e.voidedAt === null)
  if (pe.length === 0) {
    return { entryType: 'initial', entryNumber: 1, blockedReason: null }
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
    entryNumber: pe.length + 1,
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

  const entryData = {
    tournamentId: tournament.id,
    playerId: player.id,
    originSessionId,
    entryType: plan.entryType,
    entryNumber: plan.entryNumber,
    registeredAt: now(),
    registeredBy: actorId,
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
    })
  } else if (paymentMethod === 'wallet') {
    walletResult = await payViaWallet({ entryData, totalCost, actorId, actorRole })
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
  if (lastLongerDeck !== null) {
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
