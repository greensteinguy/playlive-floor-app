// Phone matching for account auto-link. Player-doc phones are stored
// AS-ENTERED (canonical-schema.md §3.2 — no E.164 normalization in v1), while
// Firebase phone auth verifies E.164 (+61400123456). So matching works on a
// normalized "significant digits" form.

/** Digits only, dropping a leading australian country code or trunk zero. */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return ''
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('61') && digits.length > 9) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

/**
 * True when two raw phone strings denote the same subscriber number.
 * Requires at least 8 significant digits so junk data can't collide.
 */
export function phonesMatch(a, b) {
  const na = normalizePhone(a)
  const nb = normalizePhone(b)
  return na.length >= 8 && na === nb
}

/**
 * Find link candidates for a verified phone among player docs.
 * Excludes merged and archived players. Returns { linkable, candidates }:
 * linkable = exactly one candidate that is unlinked OR already linked to
 * selfUid (retry self-heal: if the claim write failed after the doc linked,
 * the re-call must succeed, not dead-end in the desk queue).
 */
export function findLinkCandidates(verifiedPhone, players, selfUid = null) {
  const candidates = (players ?? []).filter(
    (p) => !p.isMerged && p.archivedAt == null && phonesMatch(verifiedPhone, p.phone)
  )
  if (candidates.length === 1 && (candidates[0].authUid == null || candidates[0].authUid === selfUid)) {
    return { linkable: true, reason: null, candidates }
  }
  if (candidates.length === 0) return { linkable: false, reason: 'noMatch', candidates }
  if (candidates.length > 1) return { linkable: false, reason: 'multipleMatches', candidates }
  return { linkable: false, reason: 'matchedPlayerAlreadyLinked', candidates }
}
