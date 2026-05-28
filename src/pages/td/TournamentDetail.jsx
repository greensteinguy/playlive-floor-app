import { useParams } from 'react-router-dom'
import Placeholder from '../../shell/Placeholder'

export default function TournamentDetail() {
  const { id } = useParams()
  return (
    <Placeholder
      title={`Tournament ${id ?? ''}`}
      phase="2 / 3"
      task="2.x / 3.2"
      description="Single tournament view. From here you'll see entries, seating, the clock, and the structure; cashiers will use the 'Register player' action on this page to add a player to this tournament (player search inline → buy-in → seat assignment)."
    />
  )
}
