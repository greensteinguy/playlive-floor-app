// PURE registration planning logic — a deploy-bundle copy of the same
// helpers in src/lib/tournaments/registration.js.
//
// WHY A COPY: Cloud Functions deploy only the functions/ directory, so this
// package cannot import from src/. The copy is kept honest by a parity test
// in the main suite (src/lib/tournaments/registrationFunctionsParity.test.js)
// that runs both implementations over the same input matrix and requires
// identical outputs. Edit BOTH files together or that gate fails.

/** What the player pays to enter: buy-in + hospitality (no rake at this venue). */
export function totalEntryCost(tournament) {
  return (tournament?.buyIn ?? 0) + (tournament?.hospitalityCost ?? 0)
}

/**
 * True once play has moved PAST the end of `cutoffLevel` (a blindNumber).
 *
 * Cutoffs are expressed as "closes at the END of level X", so:
 *  - sitting ON level n  → passed when n > X
 *  - sitting on a BREAK  → the preceding level is complete, so passed when that
 *                          level's number >= X
 *  - clock not started   → nothing has passed
 */
export function passedEndOfLevel(tournament, cutoffLevel) {
  if (cutoffLevel == null) return false
  const idx = tournament?.currentStructureIndex
  if (idx == null) return false
  const structure = tournament?.structure ?? []
  const entry = structure[idx]
  if (!entry) return false
  if (entry.type === 'level') return entry.blindNumber > cutoffLevel
  for (let i = idx - 1; i >= 0; i--) {
    if (structure[i].type === 'level') return structure[i].blindNumber >= cutoffLevel
  }
  return false
}

/**
 * Is the tournament taking THIS KIND of entry right now?
 *
 * The venue's rule is asymmetric (Guy, 24 Aug 2026): closing late registration
 * shuts the door on players who have never entered, but a player who already
 * entered and busted may keep re-entering until `reentryCutoffLevel`. So a
 * `lateRegClosed` tournament can still be open to re-entries and closed to
 * initial buy-ins at the same moment.
 *
 * `reentryCutoffLevel === null` means "re-entry closes with late registration"
 * — the behaviour every tournament had before the field existed.
 *
 * @param entryType 'initial' | 'reentry' | 'rebuy' (defaults to the strictest)
 */
export function registrationOpen(tournament, entryType = 'initial') {
  const status = tournament?.status
  if (status === 'scheduled' || status === 'lateRegOpen') return true
  if (status !== 'lateRegClosed') return false
  if (entryType !== 'reentry' && entryType !== 'rebuy') return false
  const cutoff = tournament?.reentryCutoffLevel ?? null
  // null = re-entry closes WITH late registration (pre-field behaviour). Note
  // this is the opposite polarity to passedEndOfLevel's null, which means
  // "no cutoff to pass" — hence the explicit branch rather than a bare negation.
  if (cutoff === null) return false
  return !passedEndOfLevel(tournament, cutoff)
}

/** Floor-readable explanation for why `registrationOpen` said no. */
export function registrationClosedReason(tournament, entryType) {
  if (tournament?.status === 'lateRegClosed') {
    if (entryType !== 'reentry' && entryType !== 'rebuy') {
      return 'Late registration has closed — new entries are no longer accepted.'
    }
    const cutoff = tournament?.reentryCutoffLevel ?? null
    if (cutoff === null) return 'Late registration has closed, and re-entry closed with it.'
    return `Re-entry closed at the end of level ${cutoff}.`
  }
  return `Registration is not open for this tournament (status: ${tournament?.status}).`
}

/**
 * The sessions a NEW entry can originate in — the earliest stage (Day 1
 * flights). A session is an entry point when no other session converges INTO
 * it. Cancelled sessions excluded; sorted by day then label.
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
 * Decide the entry type + number for a player given their existing entries,
 * or a blockedReason. entryNumber counts ALL entries including voided (ids
 * are deterministic and never reused); re-entry LIMITS count non-voided only.
 */
export function planEntry({ playerEntries, reentryConfig }) {
  const all = playerEntries ?? []
  const pe = all.filter((e) => e.voidedAt === null)
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
 * entries don't count; remaining = not-yet-busted; prize pool = entries ×
 * buy-in (hospitality never enters the pool).
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
