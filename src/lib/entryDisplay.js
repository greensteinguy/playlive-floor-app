// Pure display + summary helpers for tournament entries, shared by the tournament
// detail Players tab (the registered-roster) and the player-profile Activity tab
// (tournaments played + buy-in/winnings totals). No Firestore/React — unit-tested.

export const PAYMENT_METHOD_LABEL = {
  cash: 'Cash',
  eftpos: 'EFTPOS',
  wallet: 'Wallet',
  ticket: 'Ticket',
}
export function paymentMethodLabel(m) {
  return PAYMENT_METHOD_LABEL[m] ?? m
}

export const ENTRY_TYPE_LABEL = {
  initial: 'Initial',
  reentry: 'Re-entry',
  rebuy: 'Rebuy',
  addOn: 'Add-on',
}
export function entryTypeLabel(t) {
  return ENTRY_TYPE_LABEL[t] ?? t
}

/** Total winnings on a single entry: cash + ticket + bounty earnings. */
export function entryWinnings(e) {
  return (e?.cashWinnings ?? 0) + (e?.ticketWinnings ?? 0) + (e?.bountyEarnings ?? 0)
}

/** 1 → "1st", 2 → "2nd", 23 → "23rd". */
export function ordinal(n) {
  if (n == null || !Number.isFinite(n)) return ''
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/**
 * Human-readable outcome of an entry for a table cell.
 * Voided → "Voided"; busted → "Out — Nth" (or "Busted" with no place);
 * seated → "Seated"; otherwise still in but not yet seated → "In".
 */
export function entryResultLabel(e) {
  if (!e) return ''
  if (e.voidedAt) return 'Voided'
  if (e.bustedAt) return e.finishingPlace ? `Out — ${ordinal(e.finishingPlace)}` : 'Busted'
  if (e.currentSeatNumber != null) return 'Seated'
  return 'In'
}

/**
 * Totals across a set of entries (voided excluded): how many were played, total
 * paid in buy-ins, and total winnings. Used for the player-profile summary.
 */
export function summarizeEntries(entries) {
  const live = (entries ?? []).filter((e) => e.voidedAt === null)
  return {
    played: live.length,
    totalSpent: live.reduce((sum, e) => sum + (e.paymentAmount ?? 0), 0),
    totalWinnings: live.reduce((sum, e) => sum + entryWinnings(e), 0),
  }
}
