// Last-longer (Upper Deck / Main Deck) settlement — Phase 4 task 4.3.
//
// The venue mechanic: when a tournament has hasUpperDeckMainDeck, players may
// opt into a deck ('upper' | 'main') at registration; within each deck the
// player who lasts longest wins that deck's side pot. The app only RECORDS the
// side bet and its winner — the money is handled at the venue (no side-pot
// ledger in v1; walletTransactions are never touched).
//
// This module is the settlement domain layer:
//   • pure helpers (no Firestore): who's in a deck, and the winner-apparent
//     derived from the entries — exactly one player still alive wins; if the
//     whole deck has busted, the LOWEST finishingPlace wins. Anything else
//     (nobody opted in, multiple still alive, missing/tied finishing places)
//     is "not yet determinable" and the settle op refuses.
//   • impure ops ({actorId, actorRole}, manager + TD, audited, typed errors):
//     settleLastLonger sets isLastLongerWinner on the winning entry (with an
//     explicit-override path when the TD picks a different winner than the
//     derived one — floor reality: busts recorded out of order can make the
//     derivation wrong); unsettleLastLonger clears the flag to correct a
//     mistake. Each deck settles independently.

import { runValidatedTransaction, auditLog, paths } from '../firestore'
import { Entry } from '../schema'
import { now } from '../wallet/_shared'
import { TournamentError } from './errors'

/** The two decks, in display order. */
export const LAST_LONGER_DECKS = ['upper', 'main']

const DECK_LABEL = { upper: 'Upper Deck', main: 'Main Deck' }

/** 'upper' → 'Upper Deck', 'main' → 'Main Deck'. */
export function lastLongerDeckLabel(deck) {
  return DECK_LABEL[deck] ?? deck
}

// ── Typed errors ────────────────────────────────────────────────────────────

export class LastLongerError extends TournamentError {
  constructor(message) {
    super(message)
    this.name = 'LastLongerError'
  }
}
export class LastLongerNotDeterminableError extends LastLongerError {
  constructor(reason) {
    super(
      reason === 'noParticipants'
        ? 'No entries opted into this deck — there is nothing to settle.'
        : 'The winner cannot be determined yet — settle when one player is left in the deck (or pick the winner manually).'
    )
    this.name = 'LastLongerNotDeterminableError'
    this.reason = reason
  }
}
export class LastLongerAlreadySettledError extends LastLongerError {
  constructor() {
    super('This deck is already settled — undo the current winner first to change it.')
    this.name = 'LastLongerAlreadySettledError'
  }
}
export class LastLongerNotSettledError extends LastLongerError {
  constructor() {
    super('This deck has no settled winner to undo.')
    this.name = 'LastLongerNotSettledError'
  }
}

function requireActor(actorId, actorRole) {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new LastLongerError('actorId is required (non-empty string)')
  }
  if (actorRole !== 'manager' && actorRole !== 'td') {
    throw new LastLongerError('Only a manager or TD can settle a last-longer side bet.')
  }
}

function requireDeck(deck) {
  if (!LAST_LONGER_DECKS.includes(deck)) {
    throw new LastLongerError(`unknown last-longer deck "${deck}"`)
  }
}

// ── Pure helpers (no Firestore) ─────────────────────────────────────────────

/** The entries opted into `deck` (voided excluded — a voided entry never counts). */
export function lastLongerParticipants(entries, deck) {
  return (entries ?? []).filter((e) => e.voidedAt === null && e.lastLongerDeck === deck)
}

/**
 * Derive a deck's settlement state from the entries snapshot.
 *
 * Winner-apparent rule: among the deck's participants, the one alive the
 * longest — exactly one still alive (not busted) wins outright; if ALL are
 * busted, the unique LOWEST finishingPlace wins. Edge cases are not yet
 * determinable: no participants, more than one still alive, a busted entry
 * with no finishingPlace recorded yet, or a tie at the lowest place.
 *
 * @returns {{
 *   deck: 'upper'|'main',
 *   participants: Array<object>,
 *   settledWinner: object|null,     // entry with isLastLongerWinner === true
 *   derivedWinner: object|null,     // winner-apparent from the rule above
 *   determinable: boolean,
 *   reason: 'ok'|'noParticipants'|'multipleAlive'|'missingPlaces'|'tiedPlaces',
 * }}
 */
export function deriveLastLongerStatus(entries, deck) {
  const participants = lastLongerParticipants(entries, deck)
  const settledWinner = participants.find((e) => e.isLastLongerWinner === true) ?? null
  const base = { deck, participants, settledWinner }

  if (participants.length === 0) {
    return { ...base, derivedWinner: null, determinable: false, reason: 'noParticipants' }
  }
  const alive = participants.filter((e) => e.bustedAt === null)
  if (alive.length === 1) {
    return { ...base, derivedWinner: alive[0], determinable: true, reason: 'ok' }
  }
  if (alive.length > 1) {
    return { ...base, derivedWinner: null, determinable: false, reason: 'multipleAlive' }
  }
  // Everybody busted — the lowest finishingPlace lasted longest. An entry with
  // no place recorded could be the longest-lasting, so any gap blocks derivation.
  if (participants.some((e) => e.finishingPlace == null)) {
    return { ...base, derivedWinner: null, determinable: false, reason: 'missingPlaces' }
  }
  const best = Math.min(...participants.map((e) => e.finishingPlace))
  const atBest = participants.filter((e) => e.finishingPlace === best)
  if (atBest.length > 1) {
    return { ...base, derivedWinner: null, determinable: false, reason: 'tiedPlaces' }
  }
  return { ...base, derivedWinner: atBest[0], determinable: true, reason: 'ok' }
}

/** Staff-readable line for an undeterminable deck (panel copy). */
export function lastLongerReasonLabel(reason) {
  switch (reason) {
    case 'noParticipants':
      return 'Nobody opted into this deck.'
    case 'multipleAlive':
      return 'More than one player is still in — undetermined until one remains.'
    case 'missingPlaces':
      return 'All busted, but some finishing places are missing — record them, or pick the winner manually.'
    case 'tiedPlaces':
      return 'Tied at the best finishing place — pick the winner manually.'
    default:
      return ''
  }
}

// ── Impure ops ──────────────────────────────────────────────────────────────

/**
 * Settle a deck: mark the winning entry `isLastLongerWinner = true` (validated
 * full-doc transaction, audited as tournament.lastLongerSettled). Manager + TD.
 *
 * By default the winner is the derived winner-apparent, and the op refuses
 * (LastLongerNotDeterminableError) when it isn't determinable. Passing
 * `chosenEntryId` settles a specific participant instead — the manual-override
 * path for when the derivation is wrong (busts recorded out of order); the
 * audit records both the derived and the chosen winner. The `entries` snapshot
 * is the page's roster; the winner's doc is re-read and re-checked inside the
 * transaction so a concurrent settle/void loses cleanly.
 *
 * @returns {Promise<{ deck:string, winnerEntryId:string, override:boolean }>}
 */
export async function settleLastLonger({ tournament, deck, entries, chosenEntryId = null, actorId, actorRole }) {
  requireActor(actorId, actorRole)
  requireDeck(deck)
  if (!tournament?.hasUpperDeckMainDeck) {
    throw new LastLongerError('This tournament does not have the Upper Deck / Main Deck split.')
  }

  const status = deriveLastLongerStatus(entries, deck)
  if (status.settledWinner) throw new LastLongerAlreadySettledError()

  let winner
  let override = false
  if (chosenEntryId != null) {
    winner = status.participants.find((e) => e.id === chosenEntryId) ?? null
    if (!winner) {
      throw new LastLongerError('The chosen winner is not a participant in this deck.')
    }
    override = status.derivedWinner?.id !== winner.id
  } else {
    if (!status.determinable) throw new LastLongerNotDeterminableError(status.reason)
    winner = status.derivedWinner
  }

  const timestamp = now()
  await runValidatedTransaction(async (tx) => {
    const fresh = await tx.get(paths.entryPath(tournament.id, winner.id), Entry)
    if (fresh.voidedAt !== null) throw new LastLongerError('The chosen winner has been voided.')
    if (fresh.lastLongerDeck !== deck) {
      throw new LastLongerError('The chosen winner is no longer in this deck.')
    }
    if (fresh.isLastLongerWinner) throw new LastLongerAlreadySettledError()
    tx.set(paths.entryPath(tournament.id, winner.id), Entry, {
      ...fresh,
      isLastLongerWinner: true,
      updatedAt: timestamp,
    })
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'tournament.lastLongerSettled',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: {
      deck,
      winnerEntryId: winner.id,
      winnerPlayerId: winner.playerId,
      participantCount: status.participants.length,
      derivedWinnerEntryId: status.derivedWinner?.id ?? null,
      override,
    },
  })

  return { deck, winnerEntryId: winner.id, override }
}

/**
 * Undo a deck's settlement: clear `isLastLongerWinner` on the settled entry
 * (validated full-doc transaction, audited as tournament.lastLongerUnsettled).
 * Manager + TD. The deck can then be re-settled with the correct winner.
 *
 * @returns {Promise<{ deck:string, winnerEntryId:string }>}
 */
export async function unsettleLastLonger({ tournament, deck, entries, actorId, actorRole }) {
  requireActor(actorId, actorRole)
  requireDeck(deck)

  const status = deriveLastLongerStatus(entries, deck)
  const settled = status.settledWinner
  if (!settled) throw new LastLongerNotSettledError()

  const timestamp = now()
  await runValidatedTransaction(async (tx) => {
    const fresh = await tx.get(paths.entryPath(tournament.id, settled.id), Entry)
    if (!fresh.isLastLongerWinner) throw new LastLongerNotSettledError()
    tx.set(paths.entryPath(tournament.id, settled.id), Entry, {
      ...fresh,
      isLastLongerWinner: false,
      updatedAt: timestamp,
    })
  })

  await auditLog.writeAuditLogSafe({
    actorId,
    actorRole,
    actionType: 'tournament.lastLongerUnsettled',
    targetType: 'tournament',
    targetId: tournament.id,
    timestamp,
    metadata: { deck, winnerEntryId: settled.id, winnerPlayerId: settled.playerId },
  })

  return { deck, winnerEntryId: settled.id }
}
