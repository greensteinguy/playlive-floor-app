import Placeholder from '../../shell/Placeholder'

export default function Withdrawals() {
  return (
    <Placeholder
      title="Withdrawals"
      phase="3 / 4"
      task="3.6 / 4.8"
      description="Two-step pattern: cashier creates a pending withdrawal request; manager completes it (atomic walletBalance debit). Either role can cancel a pending request."
    />
  )
}
