// Persistent left sidebar — visible on PC, drawer-from-left on iPad.
//
// Visual style lifted from playlive-analytics/src/components/ui/Sidebar.jsx;
// nav items are permission-filtered by role via src/shell/nav.js.

import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useToast } from './useToast'
import { NAV_SECTIONS, visibleNavItems } from './nav'

export default function Sidebar({ onNavigate }) {
  const { user, role, signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const items = visibleNavItems(role)

  // Group visible items by section, preserving NAV_SECTIONS order.
  const grouped = NAV_SECTIONS.map((section) => ({
    ...section,
    items: items.filter((i) => i.section === section.id),
  })).filter((s) => s.items.length > 0)

  async function handleSignOut() {
    try {
      await signOut()
      navigate('/login')
    } catch (e) {
      toast.error(`Sign out failed: ${e.message}`)
    }
  }

  return (
    <aside className="w-60 bg-felt-900 border-r border-white/5 flex flex-col">
      {/* Brand */}
      <div className="px-6 py-6 border-b border-white/5">
        <span className="font-display text-xl text-gold-400 tracking-wide">PlayLive</span>
        <p className="text-[10px] font-mono text-white/40 mt-0.5 tracking-widest uppercase">
          Floor
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {grouped.map((section) => (
          <div key={section.id}>
            <div className="px-3 mb-2 text-[10px] font-mono uppercase tracking-widest text-white/30">
              {section.label}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/desk' || item.to === '/td'}
                  onClick={onNavigate}
                  // py-3 = ~44px tap target per iOS HIG.
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors duration-150 ${
                      isActive
                        ? 'bg-gold-500/10 text-gold-400 font-medium'
                        : 'text-white/60 hover:text-white hover:bg-white/5 active:bg-white/10'
                    }`
                  }
                >
                  <span className="text-base w-5 text-center">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: current user + sign out */}
      <div className="px-3 py-4 border-t border-white/5 space-y-2">
        <div className="px-3 text-xs">
          <div className="text-white/70 font-mono truncate" title={user?.email ?? ''}>
            {user?.email ?? '(no user)'}
          </div>
          <div className="text-white/40 font-mono uppercase tracking-widest text-[10px] mt-0.5">
            {role ?? '(no role)'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/5 active:bg-white/10 transition-colors duration-150"
        >
          <span className="text-base w-5 text-center">⎋</span>
          Sign out
        </button>
      </div>
    </aside>
  )
}
