// End-of-day reconciliation view (Phase 4 task 4.9).
//
// Cashier + manager. Fetches every walletTransaction in the selected window
// (collection-group query via useReconciliation) and shows:
//   - Headline external totals per method (cash / EFTPOS / PayID) — the line
//     the cashier holds against the till count, the EFTPOS settlement, and
//     the bank statement. This is the whole point of the page.
//   - Money in (deposits + external buy-ins), wallet activity, money out.
//   - A raw detail table of every transaction in range.
//   - CSV export: summary and detail as two files.
//
// All categorization comes from the pure `buildReconciliationReport`
// (src/lib/wallet/reconciliationReport.js); signs come from walletTxDelta.

import { useMemo, useState } from 'react'
import { useReconciliation } from '../../hooks/useReconciliation'
import { useToast } from '../../shell/useToast'
import { downloadCsv, csvFilename } from '../../lib/csv'
import { formatMoney } from '../../lib/money'
import {
  buildReconciliationReport,
  summaryCsvRows,
  reconDateRange,
  RECON_DATE_PRESETS,
} from '../../lib/wallet'
import { ledgerTypeLabel, ledgerMethodLabel } from '../../lib/walletLedger'

const SUMMARY_CSV_COLUMNS = [
  { key: 'section', label: 'Section' },
  { key: 'line', label: 'Line' },
  { key: 'count', label: 'Count' },
  { key: 'amount', label: 'Amount (AUD)' },
]

const DETAIL_CSV_COLUMNS = [
  { key: 'timestamp', label: 'Timestamp' }, // default formatter → ISO
  { key: 'type', label: 'Type', format: (_, row) => ledgerTypeLabel(row) },
  { key: 'playerId', label: 'Player ID' },
  { key: 'method', label: 'Method', format: (_, row) => ledgerMethodLabel(row) },
  { key: 'amount', label: 'Amount (AUD)', format: (v) => (v / 100).toFixed(2) },
  { key: 'reference', label: 'Reference' },
  { key: 'notes', label: 'Notes' },
]

export default function Reconciliation() {
  const toast = useToast()

  const [datePresetId, setDatePresetId] = useState('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // Memoized so the relative "now" baseline is stable across renders (same
  // reasoning as the audit log — a fresh Date each paint would restart the
  // hook's fetch effect every tick).
  const { since, until } = useMemo(
    () => reconDateRange(datePresetId, { customFrom, customTo }),
    [datePresetId, customFrom, customTo]
  )

  const { transactions, loading, error, mockMode, reload } = useReconciliation({ since, until })

  const report = useMemo(() => buildReconciliationReport(transactions), [transactions])

  function handleExportSummary() {
    if (transactions.length === 0) {
      toast.info('Nothing to export — the selected window has no transactions.')
      return
    }
    downloadCsv(summaryCsvRows(report), SUMMARY_CSV_COLUMNS, csvFilename('reconciliation-summary'))
    toast.success('Exported reconciliation summary to CSV.')
  }

  function handleExportDetail() {
    if (transactions.length === 0) {
      toast.info('Nothing to export — the selected window has no transactions.')
      return
    }
    downloadCsv(transactions, DETAIL_CSV_COLUMNS, csvFilename('reconciliation-detail'))
    toast.success(
      `Exported ${transactions.length} transaction${transactions.length === 1 ? '' : 's'} to CSV.`
    )
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-7xl">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">Reconciliation</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 4 — task 4.9
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        End-of-day totals to hold against the till count, EFTPOS settlement, and bank statement.
        The app records money movement — the till, terminal, and bank are the source of the cash.
      </p>

      {/* Filter bar */}
      <div className="bg-felt-800 border border-white/5 rounded-lg p-4 md:p-5 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 mr-2">Date</span>
          {RECON_DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDatePresetId(p.id)}
              className={
                'px-3 py-2 rounded-full text-xs font-mono uppercase tracking-wider ' +
                (datePresetId === p.id
                  ? 'bg-gold-500/20 text-gold-300'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white active:bg-white/15')
              }
            >
              {p.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={reload}
              disabled={loading || mockMode}
              className="px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/5 active:bg-white/10 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={handleExportSummary}
              disabled={loading || mockMode}
              className={
                'px-3 py-2 rounded-lg text-xs font-medium ' +
                (loading || mockMode
                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                  : 'bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35')
              }
            >
              Export summary CSV
            </button>
            <button
              type="button"
              onClick={handleExportDetail}
              disabled={loading || mockMode}
              className={
                'px-3 py-2 rounded-lg text-xs font-medium ' +
                (loading || mockMode
                  ? 'bg-white/5 text-white/30 cursor-not-allowed'
                  : 'bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35')
              }
            >
              Export detail CSV
            </button>
          </div>
        </div>

        {datePresetId === 'custom' && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-white/60 flex items-center gap-2">
              From
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-white/60 flex items-center gap-2">
              To
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-felt-900 border border-white/10 rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
        )}
      </div>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no wallet data available."
          body="Set VITE_USE_MOCK_DATA=false in .env.local (and configure a real Firebase project) to read live walletTransactions."
        />
      ) : error ? (
        <EmptyState title="Couldn't load transactions." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          {/* Headline: totals per external method — the reconciliation line */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <HeadlineCard
              label="Cash taken"
              sub="hold against till count"
              cents={report.externalTotals.cash}
            />
            <HeadlineCard
              label="EFTPOS taken"
              sub="hold against settlement"
              cents={report.externalTotals.eftpos}
            />
            <HeadlineCard
              label="PayID taken"
              sub="hold against bank statement"
              cents={report.externalTotals.payid}
            />
            <HeadlineCard
              label="Withdrawals paid"
              sub="money out — till / bank"
              cents={report.moneyOut.total}
              tone="out"
            />
          </div>

          {/* Summary sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <SummaryCard title="Money in — external">
              <SummaryRow label="Deposits — cash" bucket={report.moneyIn.deposits.cash} />
              <SummaryRow label="Deposits — EFTPOS" bucket={report.moneyIn.deposits.eftpos} />
              <SummaryRow label="Deposits — PayID" bucket={report.moneyIn.deposits.payid} />
              <SummaryRow label="Buy-ins — cash" bucket={report.moneyIn.buyIns.cash} />
              <SummaryRow label="Buy-ins — EFTPOS" bucket={report.moneyIn.buyIns.eftpos} />
              <TotalRow label="Total external in" cents={report.moneyIn.total} />
            </SummaryCard>

            <SummaryCard title="Wallet activity">
              <SummaryRow label="Wallet-paid buy-ins" bucket={report.walletActivity.walletBuyIns} />
              <SummaryRow label="Ticket-paid buy-ins" bucket={report.walletActivity.ticketBuyIns} />
              <SummaryRow label="Win credits" bucket={report.walletActivity.winCredits} />
              <SummaryRow
                label="Withdrawals completed"
                bucket={report.walletActivity.withdrawalsCompleted}
              />
              <SummaryRow label="Manager credits" bucket={report.walletActivity.managerCredits} />
              <SummaryRow label="Manager debits" bucket={report.walletActivity.managerDebits} />
              <SummaryRow
                label="Adjustments — credit"
                bucket={report.walletActivity.adjustmentsCredit}
              />
              <SummaryRow
                label="Adjustments — debit"
                bucket={report.walletActivity.adjustmentsDebit}
              />
              <TotalRow
                label="Net wallet change"
                cents={report.walletActivity.netWalletChange}
                signed
              />
            </SummaryCard>
          </div>

          {/* Non-money rows, shown only when present */}
          {(report.other.openingBalances.count > 0 ||
            report.other.withdrawalRequests.count > 0 ||
            report.other.withdrawalCancels.count > 0) && (
            <SummaryCard title="Other ledger rows (no money movement today)" className="mb-4">
              <SummaryRow label="Opening balances" bucket={report.other.openingBalances} />
              <SummaryRow label="Withdrawal requests" bucket={report.other.withdrawalRequests} />
              <SummaryRow label="Withdrawal cancellations" bucket={report.other.withdrawalCancels} />
            </SummaryCard>
          )}

          {/* Detail table */}
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-display text-xl text-white">
              Transactions
              <span className="ml-2 text-sm font-body text-white/40">
                {report.transactionCount} in range
              </span>
            </h2>
          </div>
          {transactions.length === 0 ? (
            <EmptyState
              title="No transactions in the selected window."
              body="Try widening the date range."
            />
          ) : (
            <DetailTable transactions={transactions} />
          )}
        </>
      )}
    </div>
  )
}

// ── Components ───────────────────────────────────────────────────────────────

function HeadlineCard({ label, sub, cents, tone = 'in' }) {
  const amountClass = tone === 'out' ? 'text-red-300' : 'text-gold-300'
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">{label}</div>
      <div className={`font-display text-2xl md:text-3xl mt-1 ${amountClass}`}>
        {formatMoney(cents)}
      </div>
      <div className="text-[11px] text-white/40 mt-1">{sub}</div>
    </div>
  )
}

function SummaryCard({ title, children, className = '' }) {
  return (
    <div className={`bg-felt-800 border border-white/5 rounded-lg p-4 md:p-5 ${className}`}>
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-3">{title}</h3>
      <div className="divide-y divide-white/5">{children}</div>
    </div>
  )
}

function SummaryRow({ label, bucket }) {
  const muted = bucket.count === 0
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className={muted ? 'text-white/30' : 'text-white/70'}>{label}</span>
      <span className="flex items-baseline gap-3">
        <span className={`text-xs font-mono ${muted ? 'text-white/20' : 'text-white/40'}`}>
          ×{bucket.count}
        </span>
        <span className={`font-mono ${muted ? 'text-white/30' : 'text-white/90'}`}>
          {formatMoney(bucket.total)}
        </span>
      </span>
    </div>
  )
}

function TotalRow({ label, cents, signed = false }) {
  const cls = !signed
    ? 'text-gold-300'
    : cents > 0
      ? 'text-emerald-300'
      : cents < 0
        ? 'text-red-300'
        : 'text-white/70'
  const text = signed && cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents)
  return (
    <div className="flex items-center justify-between py-2 text-sm border-t border-white/10">
      <span className="text-white/80 font-medium">{label}</span>
      <span className={`font-mono font-medium ${cls}`}>{text}</span>
    </div>
  )
}

function EmptyState({ title, body, tone = 'neutral' }) {
  const border = tone === 'error' ? 'border-red-500/30' : 'border-white/5'
  return (
    <div className={`bg-felt-800 border ${border} rounded-lg p-8 text-center`}>
      <div className="font-display text-lg text-white mb-1">{title}</div>
      {body && <p className="text-sm text-white/50 max-w-md mx-auto">{body}</p>}
    </div>
  )
}

function DetailTable({ transactions }) {
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
            <tr>
              <th className="text-left px-4 py-2 whitespace-nowrap">Timestamp</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Type</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Player</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Method</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={`${tx.playerId}-${tx.id}`} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 font-mono text-xs text-white/70 whitespace-nowrap">
                  {tx.timestamp?.toDate?.().toISOString?.() ?? '—'}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-gold-300/90 font-mono">
                  {ledgerTypeLabel(tx)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span
                    className="font-mono text-xs text-white/80 truncate inline-block max-w-[12rem]"
                    title={tx.playerId}
                  >
                    {tx.playerId}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-white/60">
                  {ledgerMethodLabel(tx)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-white/90 whitespace-nowrap">
                  {formatMoney(tx.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
