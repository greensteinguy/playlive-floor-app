// "You don't have access" page. Shown when ProtectedRoute's requiredRoles
// check fails — i.e., the user is signed in but their role isn't in the
// allowed list for this area.

import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

export default function Forbidden() {
  const { user, role, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
  }

  return (
    <div className="min-h-screen bg-felt-900 text-white flex items-center justify-center p-6 font-body">
      <div className="max-w-md text-center space-y-6">
        <h1 className="font-display text-4xl text-gold-500">No access</h1>
        <p className="text-white/80">
          Your account doesn’t have permission to view this area.
        </p>
        <p className="text-white/70 text-sm">
          Signed in as <span className="font-mono">{user?.email}</span>
          {role ? <> (<span className="font-mono">{role}</span>)</> : null}.
        </p>
        <div className="flex flex-col gap-3 pt-4">
          <Link
            to="/"
            className="bg-felt-800 hover:bg-felt-700 active:bg-felt-700 text-white rounded-lg px-4 py-3 text-base transition-colors"
          >
            Back to home
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="bg-gold-500 hover:bg-gold-600 active:bg-gold-600 text-felt-950 font-semibold rounded-lg px-4 py-3 text-base transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
