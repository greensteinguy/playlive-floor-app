// Venue PayID details for the wallet-deposit PayID wizard (task 3.6).
//
// PayID is a DEPOSIT-ONLY method (DECISIONS 27 May): a player transfers funds to
// the venue's PayID from their own banking app, and the cashier records the
// received amount as a wallet deposit. The Floor App never initiates or settles
// the transfer — it only displays the venue's receiving PayID so the cashier can
// read it out, then records that the money arrived (SOW §3.4, wallet-design §2.1).
//
// The details are venue deployment config, read from Vite env (kept out of code
// like the Firebase config). `resolveVenuePayId` is pure (takes an env object) so
// it's unit-testable; `getVenuePayId()` reads import.meta.env at call time.

/**
 * Resolve the venue PayID display details from an env-like object.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ payId: string|null, accountName: string|null, configured: boolean }}
 *   `configured` is true only when a PayID is set — the account name is optional.
 */
export function resolveVenuePayId(env = {}) {
  const payId = (env.VITE_VENUE_PAYID ?? '').trim()
  const accountName = (env.VITE_VENUE_PAYID_NAME ?? '').trim()
  return {
    payId: payId || null,
    accountName: accountName || null,
    configured: payId !== '',
  }
}

/** The venue PayID details for this build (reads import.meta.env). */
export function getVenuePayId() {
  return resolveVenuePayId(import.meta.env)
}
