import Placeholder from '../../shell/Placeholder'

export default function Reconciliation() {
  return (
    <Placeholder
      title="Reconciliation"
      phase="4"
      task="4.9"
      description="End-of-day reconciliation report. Aggregates walletTransactions by method / type for the window, compares against bank / EFTPOS / till totals. Backed by wallet.getReconciliationTotals."
    />
  )
}
