// Mystery Bounty draws — task 4.2.
//
// Per SOW / canonical-schema §5.4: on each knockout in a mysteryBounty
// tournament, a random UNDRAWN value from `bountyPoolConfig.bountyValues` is
// drawn, recorded as a `bountyDraws/{drawId}` row against the eliminator, and
// added to the eliminator entry's cumulative `bountyEarnings`. The WALLET
// crediting happens later, when the cashier confirms (wallet-design Q4 — no
// auto-credit; that surface is task 4.7's `confirmBountyWinCredit`).
//
// This module:
//   • pure helpers (no Firestore — unit-testable, reused by the bounty board
//     panel now and the Phase-5 TV display later): the undrawn-value multiset,
//     the remaining-pool summary, the board rows, and the random pick (rng
//     injectable like `randomEmptySeat`).
//   • one impure op ({actorId, actorRole}, audited, typed errors): drawBounty.
//
// ── Race safety: slot-addressed draw docs ────────────────────────────────────
// Each pool value bountyValues[i] has ONE well-known draw doc id, `slot-{i}`
// (DocumentId permits any non-empty string; canonical §1 allows non-UUID ids
// for a strong reason — this is one). "Value i is drawn" ⟺ its slot doc exists.
// The op probes its randomly-chosen slot with a tx.get INSIDE the transaction:
// a missing doc registers in the transaction's read set, so if a concurrent
// draw creates that slot doc first, Firestore aborts + retries this
// transaction, the probe now finds the slot taken, and the op re-picks another
// — two simultaneous knockouts can never draw the same pool value. (The
// re-read-the-listed-docs pattern used by eliminateEntry can't defend against
// concurrent CREATES; deterministic ids close that hole by construction.)

import {
  runValidatedTransaction,
  bountyDraws as bountyDrawsApi,
  auditLog,
  paths,
} from '../firestore'
import { Tournament, Entry, BountyDraw } from '../schema'
import { playerDisplayName } from '../players'
import { now } from '../wallet/_shared'
import { shuffle } from './seating'
import { TournamentError } from './errors'

// ── Typed errors ────────────────────────────────────────────────────────────

export class BountyError extends TournamentError {
  constructor(message) {
    super(message)
    this.name = 'BountyError'
  }
}
export class NotMysteryBountyError extends BountyError {
  constructor() {
    super('This tournament is not a Mystery Bounty — there is no bounty pool to draw from.')
    this.name = 'NotMysteryBountyError'
  }
}
export class NoBountiesRemainingError extends BountyError {
  constructor() {
    super('The bounty pool is empty — every bounty has already been drawn.')
    this.name = 'NoBountiesRemainingError'
  }
}
export class EliminatorNotAliveError extends BountyError {
  constructor() {
    super('The eliminator must still be in the tournament (not busted or voided).')
    this.name = 'EliminatorNotAliveError'
  }
}
export class BountyAlreadyDrawnError extends BountyError {
  constructor() {
    super('A bounty has already been drawn for this knockout.')
    this.name = 'BountyAlreadyDrawnError'
  }
}

function requireActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new BountyError('actorId is required (non-empty string)')
  }
}

// ── Pure helpers (no Firestore) ─────────────────────────────────────────────

/** True when the tournament runs a Mystery Bounty pool. */
export function isMysteryBounty(tournament) {
  return tournament?.gameType === 'mysteryBounty' && tournament?.bountyPoolConfig != null
}

const SLOT_PREFIX = 'slot-'

/** The pool index a slot-addressed draw doc id encodes, or null for legacy/foreign ids. */
export function slotIndexFromDrawId(drawId) {
  const m = /^slot-(\d+)$/.exec(drawId ?? '')
  return m ? Number(m[1]) : null
}

/** The well-known draw doc id for pool value index `i`. */
export function drawIdForSlot(i) {
  return `${SLOT_PREFIX}${i}`
}

/**
 * The pool indexes still undrawn: every index of `bountyValues` minus the
 * slot-addressed draws, minus (defensively) one index per legacy non-slot draw
 * matching its recorded value — so a hand-written / imported draw row still
 * consumes a pool value. Pure.
 */
export function undrawnSlotIndexes(bountyValues, draws) {
  const values = bountyValues ?? []
  const taken = new Set()
  const legacyValues = []
  for (const d of draws ?? []) {
    const i = slotIndexFromDrawId(d.id)
    if (i !== null && i < values.length) taken.add(i)
    else legacyValues.push(d.bountyValue)
  }
  const undrawn = values.map((_, i) => i).filter((i) => !taken.has(i))
  for (const v of legacyValues) {
    const at = undrawn.findIndex((i) => values[i] === v)
    if (at !== -1) undrawn.splice(at, 1)
  }
  return undrawn
}

/** The undrawn bounty VALUES (multiset — duplicates preserved). Pure. */
export function undrawnBountyValues(bountyValues, draws) {
  const values = bountyValues ?? []
  return undrawnSlotIndexes(values, draws).map((i) => values[i])
}

/**
 * Remaining-pool figure for the bounty board / Phase-5 TV display:
 * how many bounties are still in the pool and their combined value. Pure.
 *
 * @returns {{ count: number, total: number, drawnCount: number, drawnTotal: number }}
 */
export function remainingBountySummary(tournament, draws) {
  const values = tournament?.bountyPoolConfig?.bountyValues ?? []
  const undrawn = undrawnBountyValues(values, draws)
  const drawnTotal = (draws ?? []).reduce((sum, d) => sum + d.bountyValue, 0)
  return {
    count: undrawn.length,
    total: undrawn.reduce((sum, v) => sum + v, 0),
    drawnCount: (draws ?? []).length,
    drawnTotal,
  }
}

/**
 * Display rows for the bounty board (who drew what off whom, when), newest
 * first. Pure — the tables page renders these now; the Phase-5 TV display
 * reuses the same derivation.
 */
export function bountyBoardRows({ draws, entriesById, playersById }) {
  const nameFor = (entryId) => {
    const entry = entriesById?.[entryId]
    const player = entry ? playersById?.[entry.playerId] : null
    return player ? playerDisplayName(player) : '—'
  }
  return [...(draws ?? [])]
    .sort((a, b) => (b.drawnAt?.toMillis?.() ?? 0) - (a.drawnAt?.toMillis?.() ?? 0))
    .map((d) => ({
      id: d.id,
      bountyValue: d.bountyValue,
      drawnAt: d.drawnAt,
      knockerEntryId: d.knockerEntryId,
      knockedOutEntryId: d.knockedOutEntryId,
      knockerName: nameFor(d.knockerEntryId),
      knockedOutName: nameFor(d.knockedOutEntryId),
      isCredited: d.walletTransactionId !== null,
    }))
}

// ── The draw op ─────────────────────────────────────────────────────────────

/**
 * Draw a Mystery Bounty for a knockout: pick a uniformly-random undrawn value
 * from the published pool, record the `bountyDraws/slot-{i}` row against the
 * eliminator, and add the value to the eliminator entry's `bountyEarnings` /
 * `bountiesKnockoutCount` — one validated transaction (entry rewritten as a
 * full doc so its invariants re-validate). The wallet is NOT credited here
 * (cashier confirm, task 4.7).
 *
 * Race-safe per the module header: the chosen slot doc is probed inside the
 * transaction, so a concurrent draw taking the same value forces a retry that
 * re-picks from what actually remains. rng is injectable for tests.
 *
 * @param {object} args
 * @param {object} args.tournament          the tournament doc (id + fast pre-checks; re-read fresh inside)
 * @param {string} args.eliminatorEntryId   the knocker (must be alive)
 * @param {string} args.eliminatedEntryId   the knocked-out entry (must be busted)
 * @param {string} args.actorId
 * @param {'manager'|'td'|'cashier'} args.actorRole
 * @param {string|null} [args.notes]
 * @param {() => number} [args.rng]         uniform [0,1), injectable for tests
 *
 * @returns {Promise<{ drawId: string, bountyValue: number, remainingCount: number, remainingTotal: number }>}
 */
export async function drawBounty({
  tournament,
  eliminatorEntryId,
  eliminatedEntryId,
  actorId,
  actorRole,
  notes = null,
  rng = Math.random,
}) {
  requireActor(actorId)
  if (!isMysteryBounty(tournament)) throw new NotMysteryBountyError()
  if (!eliminatorEntryId || !eliminatedEntryId) {
    throw new BountyError('both the eliminator and the eliminated entry are required')
  }
  if (eliminatorEntryId === eliminatedEntryId) {
    throw new BountyError('a player cannot draw a bounty off their own knockout')
  }

  // One draw per knockout (best-effort pre-check from the committed draws; the
  // UI filters already-drawn knockouts out of its pickers too).
  const existingDraws = await bountyDrawsApi.listBountyDraws(tournament.id)
  if (existingDraws.some((d) => d.knockedOutEntryId === eliminatedEntryId)) {
    throw new BountyAlreadyDrawnError()
  }

  const timestamp = now()

  const result = await runValidatedTransaction(async (tx) => {
    // Fresh tournament (pool config could have been edited since the caller's
    // snapshot) — re-assert the format against the doc of record.
    const fresh = await tx.get(paths.tournamentPath(tournament.id), Tournament)
    if (!isMysteryBounty(fresh)) throw new NotMysteryBountyError()
    const values = fresh.bountyPoolConfig.bountyValues

    // Eliminated entry must be a recorded knockout (fresh read).
    const eliminated = await tx.get(paths.entryPath(tournament.id, eliminatedEntryId), Entry)
    if (eliminated.voidedAt !== null || eliminated.bustedAt === null) {
      throw new BountyError('the knocked-out player must be eliminated before their bounty is drawn')
    }

    // Eliminator must still be in the field (fresh read).
    const eliminator = await tx.get(paths.entryPath(tournament.id, eliminatorEntryId), Entry)
    if (eliminator.voidedAt !== null || eliminator.bustedAt !== null) {
      throw new EliminatorNotAliveError()
    }

    // Random pick over the undrawn slots, probing each candidate's slot doc
    // inside the transaction (see module header). The shuffle randomizes the
    // probe ORDER, so the first free slot is a uniform pick over what actually
    // remains even when the pre-transaction list was stale.
    const candidates = shuffle(undrawnSlotIndexes(values, existingDraws), rng)
    const probedTaken = new Set()
    let slot = null
    for (const i of candidates) {
      try {
        await tx.get(paths.bountyDrawPath(tournament.id, drawIdForSlot(i)), BountyDraw)
        probedTaken.add(i) // doc exists — a concurrent draw took this slot; try the next
      } catch (e) {
        if (e?.name !== 'NotFoundError') throw e
        slot = i
        break
      }
    }
    if (slot === null) throw new NoBountiesRemainingError()

    const drawId = drawIdForSlot(slot)
    const bountyValue = values[slot]

    tx.set(paths.bountyDrawPath(tournament.id, drawId), BountyDraw, {
      id: drawId,
      tournamentId: tournament.id,
      bountyValue,
      drawnAt: timestamp,
      drawnBy: actorId,
      knockedOutEntryId: eliminatedEntryId,
      knockerEntryId: eliminatorEntryId,
      walletTransactionId: null,
      notes,
    })

    // Full-doc rewrite so the Entry invariants re-validate as a whole.
    tx.set(paths.entryPath(tournament.id, eliminatorEntryId), Entry, {
      ...eliminator,
      bountyEarnings: eliminator.bountyEarnings + bountyValue,
      bountiesKnockoutCount: eliminator.bountiesKnockoutCount + 1,
      updatedAt: timestamp,
    })

    // Remaining figure AFTER this draw (from the same fresh values + the
    // committed-draw snapshot, minus the slot just taken and any slots the
    // probe found concurrently taken).
    const remaining = candidates.filter((i) => i !== slot && !probedTaken.has(i)).map((i) => values[i])
    return {
      drawId,
      bountyValue,
      remainingCount: remaining.length,
      remainingTotal: remaining.reduce((sum, v) => sum + v, 0),
    }
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'bounty.drawn',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: {
      drawId: result.drawId,
      bountyValue: result.bountyValue,
      knockerEntryId: eliminatorEntryId,
      knockedOutEntryId: eliminatedEntryId,
    },
  })

  return result
}
