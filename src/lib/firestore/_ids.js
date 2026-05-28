// Document ID generator. UUID v4 via the Web Crypto API — built into modern
// browsers and Node 19+. No external dependency.
//
// Per canonical-schema.md §1: all new document IDs are UUID v4. Legacy import
// records preserve their Casinoware ID in the `legacyId` field but get a fresh
// UUID for the actual document id.

export function generateId() {
  // crypto.randomUUID exists in:
  //   - All browsers since 2022 (Chrome 92, Firefox 95, Safari 15.4)
  //   - Node 19.0+
  // The Floor App's target environments (modern browser + recent Node) cover this.
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error(
      'crypto.randomUUID is not available. Required for document ID generation. ' +
      'Check your browser/Node version.'
    )
  }
  return crypto.randomUUID()
}
