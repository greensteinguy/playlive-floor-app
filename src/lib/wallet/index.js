// Single import point for the wallet module.
//
// Usage:
//   import { recordDeposit, payViaWallet, completeWithdrawal } from '../lib/wallet'

// Money in
export { recordDeposit } from './deposit'

// Tournament entry payment (four methods — see canonical-schema.md §3.4)
export { payViaExternalMethod, payViaWallet, payViaTicket } from './payment'

// Withdrawals (two-step pattern)
export {
  createWithdrawalRequest,
  completeWithdrawal,
  cancelWithdrawal,
} from './withdrawal'

// Winnings credit (cashier-confirmed; no auto-credit per wallet-design.md Q4)
export { confirmWinCredit, confirmBountyWinCredit } from './winCredit'

// Ticket issuance (ticket USE happens inside payViaTicket)
export { issueTicket } from './ticket'

// Migration import (Casinoware → canonical opening balances)
export { recordOpeningBalance } from './migration'

// Compensating adjustments (fixing data-entry mistakes)
export { writeAdjustment } from './adjustment'

// Manager-authorized credits and debits (intentional moves — comps, recouping, etc.)
export { recordManagerCredit, recordManagerDebit } from './managerAdjustment'

// Reconciliation helpers
export {
  getReconciliationTotals,
  verifyBalanceMatchesLedger,
} from './reconciliation'

// Typed errors (for catch blocks)
export {
  WalletError,
  InsufficientWalletBalanceError,
  TicketBelowFaceValueError,
  TicketAlreadyUsedError,
  WithdrawalStateError,
  RoleNotAuthorizedError,
  InvalidOverrideError,
} from './errors'
