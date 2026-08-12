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

/** Registration is open while the tournament is taking entries (pre-reg or late reg). */
export function registrationOpen(tournament) {
  return tournament?.status === 'scheduled' || tournament?.status === 'lateRegOpen'
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
