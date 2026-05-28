// Duplicate-player detection. Pure functions — no Firestore access here.
// The dedupe page passes in the player list and gets candidate pairs back.
//
// Heuristic (v1): normalized-phone match. Strip every non-digit, then drop a
// leading country-code "61" so "+61 4 1234 5678", "0412345678", and
// "412345678" all collapse to the same key.
//
// We deliberately ignore already-merged players so the same source doesn't
// keep showing up after it's been resolved.

/**
 * Normalize a phone number to a comparison key. Returns null when the input
 * isn't a usable phone string (so callers can skip the row rather than
 * grouping every "no phone" player together).
 *
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 7) return null // too short to be a real Australian mobile
  // Drop AU country code if present (61 followed by 9-10 digits).
  if (digits.startsWith('61') && digits.length >= 11) {
    return digits.slice(2)
  }
  // Drop leading 0 on local-format numbers ("0412345678" → "412345678").
  if (digits.startsWith('0') && digits.length >= 10) {
    return digits.slice(1)
  }
  return digits
}

/**
 * Group players by normalized phone and return groups of 2+ as candidate
 * duplicate pairs. Each group is sorted by createdAt ASC so the oldest record
 * is first (a natural "keep this, merge the others in" default).
 *
 * @param {Array<object>} players — validated Player docs
 * @returns {Array<{
 *   key: string,
 *   members: object[],     // 2+ players
 * }>}
 */
export function findDuplicateCandidates(players) {
  const groups = new Map() // key → members[]

  for (const p of players) {
    if (p.isMerged) continue // already resolved
    const key = normalizePhone(p.phone)
    if (key === null) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  const out = []
  for (const [key, members] of groups) {
    if (members.length < 2) continue
    members.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0
      const bMs = b.createdAt?.toMillis?.() ?? 0
      return aMs - bMs
    })
    out.push({ key, members })
  }
  // Group by group size descending — biggest collisions first.
  out.sort((a, b) => b.members.length - a.members.length)
  return out
}
