import { useParams } from 'react-router-dom'
import Placeholder from '../../shell/Placeholder'

export default function TournamentRegister() {
  const { id } = useParams()
  return (
    <Placeholder
      title={`Register player → tournament ${id ?? ''}`}
      phase="3"
      task="3.2 / 3.4"
      description="Tournament-anchored registration. Player search/create inline, then take the buy-in (cash / EFTPOS / wallet / ticket). Calls the wallet module for atomic entry + walletTransactions writes. Available to cashier and manager."
    />
  )
}
