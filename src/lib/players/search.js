// Player search — pure, Firestore-free ranking over a list of Player docs.
// The search page (task 3.2) fetches the players collection once and calls this
// to filter/rank as the cashier types. Kept pure (like duplicates.js) so it's
// unit-testable and reusable by the inline search in tournament registration
// (task 3.4).
//
// Matching is AND across whitespace-separated tokens: every token must match
// SOMETHING — a name/email substring, or (for digit tokens) the player's phone
// digits. Phone matching ignores formatting via digit-only comparison, so
// "0412", "412", and "+61 412 …" all line up. Ranking favours name-prefix hits
// and phone matches so the most likely player surfaces first; ties break
// alphabetically by last then first name.

import { normalizePhone } from './duplicates'

// The name shown for a player: an explicit displayName wins, else "First Last".
export function playerDisplayName(p) {
  const dn = (p.displayName ?? '').trim()
  if (dn) return dn
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()
}

function digitsOf(s) {
  return (s ?? '').replace(/\D/g, '')
}

function cmpName(a, b) {
  return (
    (a.lastName ?? '').localeCompare(b.lastName ?? '') ||
    (a.firstName ?? '').localeCompare(b.firstName ?? '')
  )
}

// Score a single player against the parsed query. 0 = no match (every token must
// hit something). Higher = better. Phone matching has two layers: a raw-digit
// substring (catches partials like "412") AND an AU-normalized compare via
// normalizePhone (so a typed "0412345678" lines up with a stored "+61 412 …",
// where the leading 0 ↔ 61 country code would otherwise break a substring).
function scorePlayer(p, tokens, queryNorm) {
  const names = [p.firstName, p.lastName, p.displayName].filter(Boolean).map((s) => s.toLowerCase())
  const email = (p.email ?? '').toLowerCase()
  const phoneDigits = digitsOf(p.phone)
  const phoneNorm = normalizePhone(p.phone) // AU-normalized (0/+61 stripped), or null
  const haystack = [...names, playerDisplayName(p).toLowerCase(), email].join(' ')

  let score = 0
  for (const t of tokens) {
    const tDigits = digitsOf(t)
    const tNorm = normalizePhone(t) // null for short / non-phone tokens
    const inText = t !== '' && haystack.includes(t)
    const inPhone =
      (tDigits.length >= 3 && phoneDigits.includes(tDigits)) ||
      (tNorm !== null && phoneNorm !== null && phoneNorm.includes(tNorm))
    if (!inText && !inPhone) return 0 // AND semantics — one miss disqualifies
    score += 1
    if (names.some((n) => n.startsWith(t))) score += 3 // prefix hit ranks higher
    if (inPhone) score += 2
  }
  // Whole-query phone match (AU-normalized so 0-prefixed and +61 numbers align).
  if (queryNorm !== null && phoneNorm !== null && phoneNorm.includes(queryNorm)) score += 3
  return score
}

/**
 * Filter + rank players by a free-text query. Merged source records are excluded
 * (they redirect to their target). An empty query returns everyone, sorted by
 * name. Results are capped at `limit`.
 *
 * @param {Array<object>} players  — validated Player docs
 * @param {string} rawQuery
 * @param {{ limit?: number }} [opts]
 * @returns {Array<object>}
 */
export function searchPlayers(players, rawQuery, { limit = 50 } = {}) {
  const pool = (players ?? []).filter((p) => !p.isMerged)
  const q = (rawQuery ?? '').trim().toLowerCase()

  if (q === '') {
    return [...pool].sort(cmpName).slice(0, limit)
  }

  const tokens = q.split(/\s+/).filter(Boolean)
  const queryNorm = normalizePhone(rawQuery)

  const scored = []
  for (const p of pool) {
    const score = scorePlayer(p, tokens, queryNorm)
    if (score > 0) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score || cmpName(a.p, b.p))
  return scored.slice(0, limit).map((s) => s.p)
}
