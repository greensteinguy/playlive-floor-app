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
    <aside className="w-60 glass-rail border-r border-white/10 flex flex-col relative">
      {/* hairline red accent down the trailing edge */}
      <span className="pointer-events-none absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-brand-500/60 to-transparent" />

      {/* Brand */}
      <div className="px-6 py-6 border-b border-white/10">
        <span className="font-brand text-xl tracking-[0.13em] text-brand-400 [text-shadow:0_0_20px_rgba(239,43,43,0.55)] whitespace-nowrap">
          CHECK RAISE
        </span>
        <p className="text-[10px] font-mono text-white/35 mt-1 tracking-[0.35em] uppercase">
          Floor OS · by PlayLive
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {grouped.map((section) => (
          <div key={section.id}>
            <div className="px-3 mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-white/30">
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
                    `group relative flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-150 ${
                      isActive
                        ? 'bg-brand-500/[0.12] text-brand-300 font-medium'
                        : 'text-white/55 hover:text-white hover:bg-white/[0.06] active:translate-y-px'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-brand-500 shadow-[0_0_12px_2px_rgba(239,43,43,0.75)]" />
                      )}
                      <span
                        className={`text-base w-5 text-center transition ${
                          isActive
                            ? 'text-brand-400 [text-shadow:0_0_12px_rgba(239,43,43,0.7)]'
                            : 'text-white/40 group-hover:text-white/80'
                        }`}
                      >
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: current user + sign out */}
      <div className="px-3 py-4 border-t border-white/10 space-y-2">
        <div className="px-3 text-xs">
          <div className="text-white/70 font-mono truncate" title={user?.email ?? ''}>
            {user?.email ?? '(no user)'}
          </div>
          <div className="text-white/35 font-mono uppercase tracking-[0.25em] text-[10px] mt-0.5">
            {role ?? '(no role)'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-white/50 hover:text-white hover:bg-white/[0.06] active:translate-y-px transition-all duration-150"
        >
          <span className="text-base w-5 text-center">⎋</span>
          Sign out
        </button>
      </div>
    </aside>
  )
}
