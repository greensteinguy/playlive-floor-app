// Satellite milestone — task 4.2.
//
// A satellite awards a tournament TICKET (satelliteConfig.ticketReward, cents)
// to each player whose stack reaches the milestone threshold. The app has no
// live chip counts, so "auto-removal" means: the TD sees the stack cross the
// line and taps "milestone reached"; the app then does everything else in one
// atomic op — frees the seat, removes the player from the live field, and
// records the ticket win on the entry.
//
// How the exit is recorded (the alive-count contract): the milestone exit sets
// the SAME bust fields eliminateEntry sets (bustedAt + bustedInSessionId, seat
// cleared) plus ticketWinnings = ticketReward. Every alive-count rule in the
// app — computeEntryCounters' remainingPlayerCount, nextFinishingPlace's place
// assignment, isSeatable / the waitlist — keys off bustedAt, so a milestone
// winner immediately stops counting as alive everywhere without any new field
// or forked rule. finishingPlace stays NULL: per canonical-schema §5.2 it is
// "null while alive or for satellite ticket winners" — a milestone exit is a
// WIN, not a finishing position, and must not consume a place (later real
// bust-outs still get alive-count places, which shrink correctly because the
// winner left the field). `ticketWinnings > 0` is what distinguishes a
// milestone winner from a busted player on a satellite roster.
//
// The wallet-side ticket is NOT issued here — `ticketWinnings` on the entry is
// the record of the win; ticket issuance (wallet `issueTicket`) happens at the
// cashier-confirm surface (task 4.7), consistent with wallet-design Q4's
// no-auto-credit principle.

import { runValidatedTransaction, auditLog, paths } from '../firestore'
import { Table, Entry } from '../schema'
import { now } from '../wallet/_shared'
import { AlreadyBustedError, EntryNotSeatableError } from './seating'
import { recountTournamentEntries } from './registration'
import { TournamentError } from './errors'

// ── Typed errors ────────────────────────────────────────────────────────────

export class SatelliteError extends TournamentError {
  constructor(message) {
    super(message)
    this.name = 'SatelliteError'
  }
}
export class NotSatelliteError extends SatelliteError {
  constructor() {
    super('This tournament is not a satellite — there is no ticket milestone to reach.')
    this.name = 'NotSatelliteError'
  }
}

function requireActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new SatelliteError('actorId is required (non-empty string)')
  }
}

// ── Pure helpers (no Firestore) ─────────────────────────────────────────────

/** True when the tournament is a satellite with a configured ticket reward. */
export function isSatellite(tournament) {
  return tournament?.gameType === 'satellite' && tournament?.satelliteConfig != null
}

/**
 * The chip-stack milestone at which a player wins their ticket, derived (not
 * persisted — canonical §3.1): threshold = (ticketReward / buyIn) × startingStack.
 * Pure. Returns null when the tournament isn't a satellite or buyIn is 0.
 */
export function satelliteMilestoneThreshold(tournament) {
  if (!isSatellite(tournament)) return null
  const { buyIn, startingStack } = tournament
  if (!buyIn || buyIn <= 0) return null
  return Math.round((tournament.satelliteConfig.ticketReward / buyIn) * startingStack)
}

/**
 * A milestone winner: out of the live field (bustedAt set) with a recorded
 * ticket win. Distinguishes ticket winners from ordinary bust-outs on a
 * satellite roster. Pure.
 */
export function isMilestoneWinner(entry) {
  return (
    entry.voidedAt === null && entry.bustedAt !== null && (entry.ticketWinnings ?? 0) > 0
  )
}

/** The milestone winners among `entries` (any session). Pure. */
export function milestoneWinners(entries) {
  return (entries ?? []).filter(isMilestoneWinner)
}

// ── The milestone op ────────────────────────────────────────────────────────

/**
 * Record that a satellite player's stack reached the milestone: frees their
 * seat (if seated), removes them from the live field (bustedAt +
 * bustedInSessionId — see the module header for why the bust fields are the
 * right marker), and records ticketWinnings = satelliteConfig.ticketReward —
 * one validated transaction (entry rewritten as a full doc so its invariants
 * re-validate). finishingPlace stays null (a milestone exit is a win, not a
 * finishing position). The wallet-side ticket is issued at cashier confirm
 * (task 4.7), not here. Then a best-effort recount drops remainingPlayerCount.
 *
 * Unlike eliminateEntry there is no last-player guard: a satellite routinely
 * ends with the final survivor ALSO reaching the milestone.
 *
 * @returns {Promise<{ ok: true, ticketReward: number }>}
 */
export async function reachSatelliteMilestone({ tournament, entry, sessionId, actorId, actorRole }) {
  requireActor(actorId)
  if (!isSatellite(tournament)) throw new NotSatelliteError()
  if (entry.voidedAt) throw new EntryNotSeatableError()
  if (entry.bustedAt) throw new AlreadyBustedError()
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new SatelliteError('a session is required to record a milestone')
  }
  const ticketReward = tournament.satelliteConfig.ticketReward
  if (!ticketReward || ticketReward <= 0) {
    throw new SatelliteError('this satellite has no ticket reward configured')
  }
  const timestamp = now()

  await runValidatedTransaction(async (tx) => {
    // Fresh entry — the caller's snapshot can be stale (concurrent bust / void).
    const target = await tx.get(paths.entryPath(tournament.id, entry.id), Entry)
    if (target.voidedAt) throw new EntryNotSeatableError()
    if (target.bustedAt) throw new AlreadyBustedError()

    // Free the seat if the player is seated (clear by entryId, like eliminateEntry).
    if (target.currentTableId) {
      const table = await tx.get(paths.tablePath(tournament.id, target.currentTableId), Table)
      tx.set(paths.tablePath(tournament.id, target.currentTableId), Table, {
        ...table,
        seats: table.seats.map((s) => (s.entryId === target.id ? { ...s, entryId: null } : s)),
        updatedAt: timestamp,
      })
    }

    tx.set(paths.entryPath(tournament.id, target.id), Entry, {
      ...target,
      currentTableId: null,
      currentSeatNumber: null,
      bustedAt: timestamp,
      bustedInSessionId: sessionId,
      ticketWinnings: ticketReward,
      updatedAt: timestamp,
    })
  })

  // Best-effort counter refresh (remainingPlayerCount drops by one) — the
  // counters are a rebuildable cache; a recount failure never undoes the exit.
  try {
    await recountTournamentEntries({ tournamentId: tournament.id })
  } catch {
    /* counters self-heal on the next recount */
  }

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'entry.satelliteMilestone',
    targetType: 'entry',
    targetId: entry.id,
    timestamp,
    metadata: { tournamentId: tournament.id, sessionId, ticketReward },
  })

  return { ok: true, ticketReward }
}
