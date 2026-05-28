# `src/lib/wallet/` — wallet ledger module

The append-only ledger that records every wallet movement. Sits on top of the data layer (`src/lib/firestore/`) and uses its Zod-validated transactions for atomicity. Every wallet operation in the app goes through this module — direct writes to `walletTransactions` or `players.walletBalance` from anywhere else are unsafe (risk of ledger/cache drift).

## What lives here

```
src/lib/wallet/
├── README.md
├── index.js                ← re-exports
├── _shared.js              ← helpers: audit-log emission, override validation, balance-delta math
├── errors.js               ← typed errors (WalletError + 6 specific subclasses)
│
├── deposit.js              ← recordDeposit (cash/EFTPOS/PayID)
├── payment.js              ← payViaExternalMethod / payViaWallet / payViaTicket
├── withdrawal.js           ← createWithdrawalRequest / completeWithdrawal / cancelWithdrawal
├── winCredit.js            ← confirmWinCredit / confirmBountyWinCredit
├── ticket.js               ← issueTicket  (use happens inside payViaTicket)
├── migration.js            ← recordOpeningBalance  (for Casinoware CSV import)
├── adjustment.js           ← writeAdjustment  (compensating ledger entry for fixing mistakes)
├── managerAdjustment.js    ← recordManagerCredit / recordManagerDebit  (intentional manager-authorized moves)
└── reconciliation.js       ← getReconciliationTotals / verifyBalanceMatchesLedger
```

## Operations

Every operation:
1. Runs inside `runValidatedTransaction` so all related writes (entries doc + walletTransactions row + player.balance update + ticket state change + withdrawalRequest state change + etc.) succeed atomically or not at all.
2. Validates inputs (positive amounts, recognized methods/roles).
3. Enforces relevant invariants.
4. Writes an audit log entry after success (best-effort, via `writeAuditLogSafe`).

### Money in

- **`recordDeposit({ playerId, amount, method, reference, actorId, actorRole, notes? })`** — cash, EFTPOS, or PayID. Credits walletBalance + totalDeposited.

### Tournament entry payment

Four methods (per wallet-design.md Q1):

- **`payViaExternalMethod({ entryData, totalCost, method, reference, actorId, actorRole })`** — `method: 'cash' | 'eftpos'`. Writes entry + walletTransactions(spend), no balance change.
- **`payViaWallet({ entryData, totalCost, actorId, actorRole })`** — debits walletBalance. **HARD invariant: throws `InsufficientWalletBalanceError` if balance < cost. No override.**
- **`payViaTicket({ entryData, totalCost, ticketId, topUp?, managerOverride?, actorId, actorRole })`** — marks the ticket used. If `topUp` is provided (cash/EFTPOS for the shortfall when faceValue < totalCost), that's recorded as a second walletTransactions row. If faceValue < totalCost and no topUp, `managerOverride={reason:"..."}` is required — recorded as `manager.override` in auditLog. Throws `TicketAlreadyUsedError` / `TicketBelowFaceValueError` as appropriate.

### Withdrawals (two-step pattern)

- **`createWithdrawalRequest({ playerId, amount, payoutMethod, actorId, actorRole })`** — Cashier or Manager. No wallet impact.
- **`completeWithdrawal({ requestId, actorId, actorRole, externalReference? })`** — **Manager only.** Atomically: state→completed, walletTransactions(withdrawalComplete), debit walletBalance. Throws `RoleNotAuthorizedError` for non-managers, `InsufficientWalletBalanceError` if balance < amount (HARD), `WithdrawalStateError` if request isn't pending.
- **`cancelWithdrawal({ requestId, actorId, actorRole, cancelReason })`** — Either role. No wallet impact.

### Winnings credit

- **`confirmWinCredit({ playerId, amount, relatedDocId?, actorId, actorRole, notes? })`** — cashier-confirmed payout (no auto-credit per wallet-design.md Q4).
- **`confirmBountyWinCredit({ tournamentId, drawId, playerId, amount, actorId, actorRole })`** — special case for Mystery Bounty draws; also sets the `bountyDraws.walletTransactionId` link.

### Tickets

- **`issueTicket({ playerId, faceValue, issuedReason?, issuedFromTournamentId?, actorId, actorRole })`** — credits ticketBalance.

### Migration

- **`recordOpeningBalance({ playerId, amount, actorId?, timestamp? })`** — used by the Casinoware CSV import (R1.0b). Defaults `actorId` to `'system'`.

### Corrections (fixing data-entry mistakes)

- **`writeAdjustment({ playerId, amount, direction: 'credit'|'debit', reason, relatedDocId?, actorId, actorRole })`** — compensating entry. Use when correcting a previous error (wrong player, wrong amount, etc.). Direction stored in `notes` (`"adjustment: credit — <reason>"`). Still enforces the HARD wallet ≥ 0 invariant on debit adjustments. Audit-logged as `wallet.adjustment`.

### Manager-authorized credits / debits (intentional moves)

Distinct from `writeAdjustment` — these are deliberate manager actions (comps, goodwill, recouping over-credits), not corrections of mistakes. Manager-only. Each requires a non-empty reason captured in the ledger and audit log. Reconciliation breaks them out as their own line items so managers can see "how much goodwill credit did we extend this week" vs "how many bookkeeping corrections did we make."

- **`recordManagerCredit({ playerId, amount, reason, actorId, actorRole })`** — adds money to a player's wallet with a manager's reason. `actorRole` must be `'manager'` (RoleNotAuthorizedError otherwise). Writes a `walletTransactions` row of type `managerCredit`. Audit-logged as `wallet.managerCredit`.
- **`recordManagerDebit({ playerId, amount, reason, actorId, actorRole })`** — symmetric. Manager-only. HARD wallet ≥ 0 still applies — a debit that would push balance negative throws `InsufficientWalletBalanceError`. Audit-logged as `wallet.managerDebit`.

### Reconciliation

- **`getReconciliationTotals({ since, until })`** — totals by method/type across all players for a window. Feeds the end-of-day reconciliation UI.
- **`verifyBalanceMatchesLedger(playerId)`** — rebuilds balance from the ledger and reports drift from the cache. Sanity check.

## Invariants

Two are HARD (no override path, ever — see canonical-schema.md §6.2):

1. **`players.walletBalance >= 0`** — wallet going negative would be venue liability, not a service-level favour.
2. **`walletTransactions.amount > 0`** — sign convention. The `type` determines whether the row credits or debits.

All other invariants have manager-override paths surfaced in the UI; this module accepts a `managerOverride={reason:"..."}` parameter where applicable, validates it, and emits a `manager.override` audit log entry.

## Audit log

Every wallet operation writes a `WELL_KNOWN_ACTION_TYPES` audit entry after the transaction commits. Writes are best-effort (via `writeAuditLogSafe`) — a failed audit log entry never breaks the user's flow. If a manager override is used, a separate `manager.override` entry is written.

## What this module does NOT do

- **UI flows.** Phase 3 (registration / wallet UI) and Phase 4 (payouts / withdrawals UI) call into this module from React components. The UI dance (form, confirmation step, error display) lives there.
- **Read-only views.** Use `walletTransactions.listWalletTransactions(...)` from the data layer directly.
- **Computing prize pools / payout shares.** That's the tournament module.
- **Authorization beyond role checks.** Custom claim checks live in `src/auth/`.

## Testing

Tier 1 (unit) tests live alongside the implementation files: `_shared.test.js`, `deposit.test.js`, `payment.test.js`, `withdrawal.test.js`, `winCredit.test.js`, `ticket.test.js`, `migration.test.js`, `adjustment.test.js`, `managerAdjustment.test.js`, `reconciliation.test.js`. Run with `npm test`.

Pattern: every test stubs the `../firestore` module (`vi.mock`) and replaces `runValidatedTransaction` with a callback that hands the wallet code a fake `tx` object. A small in-memory store in [_test-helpers.js](_test-helpers.js) lets tests seed Player / Ticket / WithdrawalRequest / BountyDraw docs and then assert on the resulting `set` / `update` calls. No real Firestore is hit; the unit suite runs in well under a second.

Coverage:
- Every operation's happy path
- Both HARD invariants (`walletBalance >= 0`, `amount > 0`) with no-override behaviour pinned down
- Ticket / withdrawal state transitions
- Role-gated operations (`recordManagerCredit`, `recordManagerDebit`, `completeWithdrawal`, `createWithdrawalRequest`, `cancelWithdrawal`)
- `payViaTicket` manager-override path (verifies the `manager.override` audit entry is written)
- Reconciliation aggregation across every type/method combination, plus drift detection by `verifyBalanceMatchesLedger`

Rules tests (tier 2) live separately at `tests/firestore-rules/` and run against the Firestore emulator via `npm run test:rules`. They cover the role-vs-collection access matrix, not wallet semantics.
