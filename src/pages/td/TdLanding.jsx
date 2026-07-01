// Tournament Floor (TD) persona landing.
//
// Audience: td, manager, readonly. Tile visibility mirrors the sidebar via
// `roleCanSee` so a cashier landing here (e.g. when navigating around) sees the
// same options as in the sidebar.

import { useAuth } from '../../auth/useAuth'
import { roleCanSee, NAV_ITEMS } from '../../shell/nav'
import LandingTile from '../../shell/LandingTile'

const TILES = [
  {
    navPath: '/td/tournaments',
    icon: '▦',
    label: 'Tournaments',
    description: 'Browse running, scheduled, and finished tournaments.',
    badge: 'Phase 2',
  },
  {
    navPath: '/td/tournaments/new',
    icon: '＋',
    label: 'Create tournament',
    description: 'Set up a new single-day, multi-day, multi-flight, or satellite event.',
    badge: 'Phase 2',
  },
  {
    navPath: '/td/tables',
    icon: '⊞',
    label: 'Tables & seating',
    description: 'Open tables, seat players, balance, and break.',
    badge: 'Phase 3',
  },
  // Live clock tile removed — the clock runs per-tournament (open a tournament →
  // Open clock). Mystery bounty + Payouts are Phase-4 placeholders, removed for now.
]

export default function TdLanding() {
  const { role } = useAuth()

  const visible = TILES.filter((tile) => {
    const navItem = NAV_ITEMS.find((n) => n.to === tile.navPath)
    return navItem ? roleCanSee(role, navItem) : true
  })

  return (
    <div className="px-6 py-8 md:px-10 md:py-12 max-w-6xl">
      <div className="mb-8">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gold-400/70 mb-1">
          Tournament floor
        </p>
        <h1 className="font-display text-3xl md:text-4xl text-white">
          Run the room.
        </h1>
        <p className="text-white/50 text-sm mt-2">
          Tournament setup, the live clock, seating, and payouts.
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
