// Chip denominations — which chips physically exist at the venue, and which of
// them are still on the table at each step of a blind structure.
//
// Model (Guy, 6 Oct 2026): the venue defines its chip set once (Admin →
// Settings). A structure names its SMALLEST chip at the start — every smaller
// chip in the venue set is out of play. Each colour-up break then removes the
// smallest chip still in play. A blind or ante that isn't a multiple of the
// smallest chip in play can't be posted with real chips (e.g. a 750 small blind
// once only 100s and up remain), so the structure editor flags it.

// The venue's chips today, plus 10s/50s for small-starting-stack events.
export const DEFAULT_CHIP_DENOMINATIONS = [10, 50, 100, 500, 1000, 5000, 25000, 100000]

/** Unique, positive whole numbers, ascending. Anything else is dropped. */
export function normaliseChips(list) {
  const clean = (list ?? []).filter((n) => Number.isInteger(n) && n > 0)
  return [...new Set(clean)].sort((a, b) => a - b)
}

/**
 * The smallest chip in play for every entry in `structure` (same length,
 * index-aligned). A colour-up break drops the smallest remaining chip for the
 * entries AFTER it — the break itself still shows the pre-colour-up chip.
 *
 * Returns all nulls when there's nothing to check against: no `smallestChip`,
 * or an empty chip set. Once every chip has been coloured up the value stays at
 * the largest chip rather than vanishing — the TD has over-coloured, and the
 * biggest chip is still the best guess at what's on the table.
 */
export function smallestChipByIndex(structure, chips, smallestChip) {
  const entries = structure ?? []
  if (!Number.isInteger(smallestChip) || smallestChip <= 0) return entries.map(() => null)
  // The named starting chip is in play even if the settings list lacks it.
  const inPlay = normaliseChips([smallestChip, ...normaliseChips(chips).filter((c) => c >= smallestChip)])
  let pos = 0
  return entries.map((e) => {
    const current = inPlay[pos]
    if (e.type === 'break' && e.isColorUp && pos < inPlay.length - 1) pos++
    return current
  })
}

/** Can `amount` be made from chips no smaller than `chip`? Zero always can. */
export function isPostable(amount, chip) {
  if (chip == null || !Number.isFinite(amount) || amount === 0) return true
  return amount % chip === 0
}

/** The auto-blinds rule: small blind is half the big blind, ante equals it. */
export function autoBlindsFor(bigBlind) {
  return { smallBlind: Math.floor(bigBlind / 2), ante: bigBlind }
}

/** True when every level already follows the auto-blinds rule. */
export function followsAutoBlinds(structure) {
  const levels = (structure ?? []).filter((e) => e.type === 'level')
  return (
    levels.length > 0 &&
    levels.every((e) => {
      const want = autoBlindsFor(e.bigBlind)
      return e.smallBlind === want.smallBlind && e.ante === want.ante
    })
  )
}
