// Dev-only floating role switcher. Visible only when VITE_USE_MOCK_DATA=true.
//
// Saves dev iteration time when hopping between persona landings: tap a role
// chip and the mock auth context flips, the sidebar refilters, and the role
// redirector at `/` sends you to the right landing on next navigation.
//
// Hidden entirely in production (real auth, real roles, real custom claims).

import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { USE_MOCK_DATA } from '../firebase/config'
import { ALL_ROLES, landingPathFor } from './nav'

export default function MockRoleSwitcher() {
  const { role, setMockRole } = useAuth()
  if (!USE_MOCK_DATA) return null
  if (!setMockRole) return null // safety: AuthProvider may not expose this in prod build

  return (
    <div className="fixed bottom-4 left-4 z-40 bg-felt-800/95 border border-gold-500/30 rounded-lg shadow-lg text-xs">
      <div className="px-3 py-2 border-b border-white/5 text-[10px] font-mono uppercase tracking-widest text-gold-400/80">
        Mock mode — switch role
      </div>
      <div className="p-2 flex gap-1">
        {ALL_ROLES.map((r) => {
          const active = r === role
          return (
            <Link
              key={r}
              to={landingPathFor(r)}
              onClick={() => setMockRole(r)}
              className={`px-2.5 py-1 rounded font-mono uppercase tracking-wider text-[10px] ${
                active
                  ? 'bg-gold-500/25 text-gold-300'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
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
