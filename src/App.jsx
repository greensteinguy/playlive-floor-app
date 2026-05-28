// App shell. Wraps the route tree with the auth provider.
//
// Routes:
//   /          — protected; home (placeholder until Phase 1 task 1.5 builds the persona-tailored landing)
//   /login     — public
//   /forbidden — public
//   /display   — public (venue TV; doesn't authenticate)
//
// The Home page below carries a small "signed in as ... — sign out" affordance
// just to prove auth integration works. Task 1.5 replaces Home with the real
// persona-tailored layout (TD landing + Registration Desk landing).

import { Routes, Route, Link } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { useAuth } from './auth/useAuth'
import Login from './pages/Login'
import Forbidden from './pages/Forbidden'

function Home() {
  const { user, role, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
  }

  return (
    <div className="min-h-screen bg-felt-900 text-white p-8 font-body">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl text-gold-500 mb-2">PlayLive Floor App</h1>
          <p className="text-white/60 text-sm">Scaffold only — built out in Phases 1 through 6.</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-white/80 font-mono">{user?.email ?? '(no user)'}</div>
          <div className="text-white/60 font-mono mb-2">{role ?? '(no role)'}</div>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-gold-400 hover:text-gold-500 underline text-xs"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-white/80">
          See <code className="text-gold-400">CLAUDE.md</code> for project context.
        </p>
        <p className="text-white/80">
          See <code className="text-gold-400">docs/HANDOFF.md</code> for where to start.
        </p>
        <p className="text-white/80">
          See <code className="text-gold-400">docs/02_Action_Plan.md</code> for the phase plan.
        </p>
      </div>

      <nav className="mt-12 flex gap-4 text-sm">
        <Link to="/display" className="text-gold-400 hover:text-gold-500 underline">/display (placeholder)</Link>
      </nav>
    </div>
  )
}

function Display() {
  return (
    <div className="min-h-screen bg-felt-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h2 className="font-display text-6xl text-gold-500 mb-4">Venue Display</h2>
        <p className="text-white/60">Phase 5 builds this out as the cycling TV view.</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forbidden" element={<Forbidden />} />
        <Route path="/display" element={<Display />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
