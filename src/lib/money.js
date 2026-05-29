// Money + numeric form helpers. Money is stored as integer cents (AUD); forms
// edit it in dollars as strings (so decimal entry isn't fought by re-renders).
//
// Conversion happens at the form/storage boundary: centsToStr on load,
// dollarsToCents on save. formatMoney is for read-only display.

/** Cents (integer) → display string, e.g. 10000 → "$100.00". */
export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

/**
 * Cents → editable dollar string for a form field. Zero becomes '' so the
 * input shows its placeholder rather than a literal "0".
 */
export function centsToStr(cents) {
  return cents === 0 ? '' : (cents / 100).toString()
}

/** Dollar string from a form field → integer cents. Blank/garbage → 0. */
export function dollarsToCents(str) {
  const n = parseFloat(str)
  return Number.isNaN(n) ? 0 : Math.round(n * 100)
}

/** Numeric string → integer, or null when blank/garbage (e.g. "unlimited"). */
export function intOrNull(str) {
  if (str === '' || str === null || str === undefined) return null
  const n = parseInt(str, 10)
  return Number.isNaN(n) ? null : n
}

/** Numeric string → integer, defaulting to 0 when blank/garbage. */
export function intOf(str) {
  const n = parseInt(str, 10)
  return Number.isNaN(n) ? 0 : n
}
