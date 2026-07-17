# Known Gaps — what's intentionally not built yet

So testing energy goes where it helps: everything below is **known and
planned**, not broken. If you hit one of these, no need to report it.

## Coming in Phase 5 (weeks 10–11)

- **TV display** — the full-screen blinds/prize-pool screen for the venue
  TVs. The `/display` link exists but is a placeholder.
- **Thermal printing** — seat cards and alternate tickets currently export as
  CSV; printing to the venue's thermal printer is Phase 5.
- **iPad deep polish** — the app works on tablets today (and phones), but the
  dedicated iPad pass (older-device performance, edge cases) is Phase 5.

## Coming in Phase 6 (week 12)

- **Analytics dashboard + Player App updates** — the other two apps don't
  read the new tournament data yet. Separate work, planned.

## Coming in Rollout

- **Your real player base** — the Casinoware player import (names, contact
  details, opening wallet balances) happens in Rollout, right before
  training. Today's player list is test data only.
- **Operator handbook + training.**

## Parked to v1.5 (by decision)

- **ICM deal calculator** — deals are fully supported with manually agreed
  amounts; the automatic ICM math is a v1.5 candidate.
- Cash games, packages, ID scanning, loyalty, multi-venue.

## Small known items

- **Ticket issuance UI** — redeeming a ticket at registration works;
  a dedicated screen for *issuing* tickets outside a satellite win is not
  built yet.
- **Payout auto-fill curve** — uses a placeholder formula until the venue's
  real payout table is supplied; manual override of every payout row already
  works.
- **Google sign-in** — the button is live but the option needs to be switched
  on in the project settings; email + password always works.
- **Winner payouts credit the wallet only** — paying a winner in till cash as
  a recorded alternative is a known open question for v1.

## Deliberate design decisions (not gaps)

- **Online-only.** If the venue internet drops, the app stops accepting
  changes rather than risk conflicting data. The venue mitigates with a
  reliable connection / 4G failover.
- **The app never moves money.** It records what the till, EFTPOS terminal,
  and PayID did. This keeps it out of the payment-compliance critical path.
- **No bulk payout button.** Every win credit requires a cashier confirming
  that specific player, on purpose.
