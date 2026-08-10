// Dev-only floating role switcher. Visible only when VITE_USE_MOCK_DATA=true.
//
// Saves dev iteration time when hopping between persona landings: tap a role
// chip and the mock auth context flips, the sidebar refilters, and the role
// redirector at `/` sends you to the right landing on next navigation.
//
// Minimizable — collapses to a small corner pill so it's out of the way during
// testing + presentations. The collapsed state persists in localStorage so it
// stays tucked away across reloads.
//
// Hidden entirely in production (real auth, real roles, real custom claims).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { USE_MOCK_DATA } from '../firebase/config'
import { ALL_ROLES, landingPathFor } from './nav'

const STORE_KEY = 'playlive.mockSwitcher.collapsed'

export default function MockRoleSwitcher() {
  const { role, setMockRole } = useAuth()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORE_KEY) === '1'
    } catch {
      return false
    }
  })

  if (!USE_MOCK_DATA) return null
  if (!setMockRole) return null // safety: AuthProvider may not expose this in prod build

  const persist = (v) => {
    setCollapsed(v)
    try {
      localStorage.setItem(STORE_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  // Collapsed → a small glass pill showing the active role; click to expand.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => persist(false)}
        title="Show mock role switcher"
        className="fixed bottom-4 left-4 z-40 glass rounded-full pl-2.5 pr-3 py-1.5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/75 hover:text-white transition"
      >
        <span className="w-2 h-2 rounded-full bg-brand-500 shadow-[0_0_10px_2px_rgba(239,43,43,0.7)]" />
        {role ?? 'dev'}
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 glass rounded-xl text-xs overflow-hidden">
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-brand-400/90">
          Mock mode — switch role
        </span>
        <button
          type="button"
          onClick={() => persist(true)}
          aria-label="Minimize"
          title="Minimize"
          className="-mr-1 w-5 h-5 grid place-items-center rounded text-white/55 hover:text-white hover:bg-white/10 text-base leading-none"
        >
          –
        </button>
      </div>
      <div className="p-2 flex gap-1">
        {ALL_ROLES.map((r) => {
          const active = r === role
          return (
            <Link
              key={r}
              to={landingPathFor(r)}
              onClick={() => setMockRole(r)}
              className={`px-2.5 py-1 rounded-lg font-mono uppercase tracking-wider text-[10px] transition ${
                active
                  ? 'bg-brand-500/25 text-brand-300 shadow-[0_0_16px_-4px_rgba(239,43,43,0.7)]'
                  : 'titanium text-white/70 hover:text-white'
              }`}
            >
              {r}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
