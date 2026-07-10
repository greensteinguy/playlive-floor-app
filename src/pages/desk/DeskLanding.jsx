// Registration Desk persona landing.
//
// Audience: cashier, manager. Read-only role gets a stripped-down view (no
// mutate-bound tiles). Tile visibility uses the same `roleCanSee` map as the
// sidebar so they stay in sync.

import { useAuth } from '../../auth/useAuth'
import { roleCanSee, NAV_ITEMS } from '../../shell/nav'
import LandingTile from '../../shell/LandingTile'

// Order matters — first tile is the primary action. Registration starts at the
// tournament list (pick tournament → register player to it), not as a standalone
// flow (per Guy's UX direction).
const TILES = [
  {
    navPath: '/td/tournaments',
    icon: '▦',
    label: 'Tournaments',
    description: 'Open a tournament to register players, view entries, and take buy-ins.',
    badge: 'Phase 2 / 3',
  },
  {
    navPath: '/desk/players',
    icon: '♟',
    label: 'Player search',
    description: 'Look up an existing player by name, phone, or email — independent of a tournament.',
    badge: 'Phase 3',
  },
  {
    navPath: '/desk/deposit',
    icon: '↘',
    label: 'Wallet deposit',
    description: 'Record cash / EFTPOS / PayID added to a player wallet.',
    badge: 'Phase 3',
  },
  {
    navPath: '/desk/withdrawals',
    icon: '↖',
    label: 'Withdrawals',
    description: 'Queue withdrawal requests; a manager completes them once the money is paid out.',
    badge: 'Phase 4',
  },
  // Tickets tile removed — that page is a Phase-4 placeholder.
]

export default function DeskLanding() {
  const { role } = useAuth()

  // Filter tiles to ones the current role can see (mirrors sidebar visibility).
  const visible = TILES.filter((tile) => {
    const navItem = NAV_ITEMS.find((n) => n.to === tile.navPath)
    return navItem ? roleCanSee(role, navItem) : true
  })

  return (
    <div className="px-6 py-8 md:px-10 md:py-12 max-w-6xl">
      <div className="mb-8">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gold-400/70 mb-1">
          Registration desk
        </p>
        <h1 className="font-display text-3xl md:text-4xl text-white">
          What would you like to do?
        </h1>
        <p className="text-white/50 text-sm mt-2">
          Player-facing operations — registration, wallet, payouts.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((tile) => (
          <LandingTile
            key={tile.navPath}
            to={tile.navPath}
            icon={tile.icon}
            label={tile.label}
            description={tile.description}
            badge={tile.badge}
          />
        ))}
      </div>
    </div>
  )
}
