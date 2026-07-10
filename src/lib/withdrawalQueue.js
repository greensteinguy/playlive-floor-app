// Withdrawal-queue display helpers (task 4.8). Pure — no Firestore, no React —
// so the filter/sort/CSV logic behind /desk/withdrawals is unit-testable.
//
// The queue page fetches the whole withdrawalRequests collection (one-shot via
// useWithdrawals, single-field orderBy — no composite index) and shapes it here:
// filter chips with counts (Pending / Completed / Cancelled / All, matching the
// tournament-list + wallet-ledger chip pattern), a queue-first sort (pending
// requests always float to the top), and CSV row building for export.

import { formatMoney } from './money'

// ── Labels ────────────────────────────────────────────────────────────────────

export const PAYOUT_METHOD_LABEL = {
  cash: 'Cash',
  eftposRefund: 'EFTPOS refund',
  bankTransfer: 'Bank transfer',
}

export function payoutMethodLabel(method) {
  return PAYOUT_METHOD_LABEL[method] ?? method
}

export const WITHDRAWAL_STATE_LABEL = {
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function withdrawalStateLabel(state) {
  return WITHDRAWAL_STATE_LABEL[state] ?? state
}

// ── Filter chips ──────────────────────────────────────────────────────────────

// Pending leads (it's the working queue); All closes the row, mirroring how the
// floor thinks: "what needs doing" first, history after.
export const WITHDRAWAL_FILTERS = [
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
]

export function withdrawalFilterMatch(filter, state) {
  return filter.id === 'all' || filter.id === state
}

/** Per-chip counts, keyed by filter id — for the chip labels. */
export function countWithdrawalsByFilter(requests) {
  const counts = {}
  for (const f of WITHDRAWAL_FILTERS) {
    counts[f.id] = requests.filter((r) => withdrawalFilterMatch(f, r.state)).length
  }
  return counts
}

// ── Sorting ───────────────────────────────────────────────────────────────────

// Tolerant of Firestore Timestamp, Date, or null (matches the tournament list's
// toMillis approach).
function toMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  if (ts instanceof Date) return ts.getTime()
  return 0
}

/**
 * Queue-first ordering: pending requests before resolved ones, newest-first
 * within each group. Returns a new array (input untouched).
 */
export function sortWithdrawals(requests) {
  return [...requests].sort((a, b) => {
    const aPending = a.state === 'pending' ? 0 : 1
    const bPending = b.state === 'pending' ? 0 : 1
    if (aPending !== bPending) return aPending - bPending
    return toMillis(b.requestedAt) - toMillis(a.requestedAt)
  })
}

// ── CSV export ────────────────────────────────────────────────────────────────

export const WITHDRAWAL_CSV_COLUMNS = [
  { key: 'id', label: 'Request ID' },
  { key: 'player', label: 'Player' },
  { key: 'playerId', label: 'Player ID' },
  { key: 'amount', label: 'Amount' },
  { key: 'payoutMethod', label: 'Payout method' },
  { key: 'state', label: 'State' },
  { key: 'requestedBy', label: 'Requested by' },
  { key: 'requestedAt', label: 'Requested at' }, // Timestamp → ISO via csv defaultCellFormat
  { key: 'completedBy', label: 'Completed by' },
  { key: 'completedAt', label: 'Completed at' },
  { key: 'externalReference', label: 'External reference' },
  { key: 'cancelledBy', label: 'Cancelled by' },
  { key: 'cancelledAt', label: 'Cancelled at' },
  { key: 'cancelReason', label: 'Cancel reason' },
]

/**
 * Shape withdrawal requests into CSV-ready rows (pairs with
 * WITHDRAWAL_CSV_COLUMNS). `nameOf(playerId)` resolves the display name; unknown
 * players fall back to the raw id so the export is still traceable.
 */
export function buildWithdrawalCsvRows(requests, nameOf) {
  return requests.map((r) => ({
    id: r.id,
    player: nameOf(r.playerId) || r.playerId,
    playerId: r.playerId,
    amount: formatMoney(r.amount),
    payoutMethod: payoutMethodLabel(r.payoutMethod),
    state: withdrawalStateLabel(r.state),
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt,
    completedBy: r.completedBy,
    completedAt: r.completedAt,
    externalReference: r.externalReference,
    cancelledBy: r.cancelledBy,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
  }))
}
