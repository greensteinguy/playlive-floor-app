// Sign-in page. Email + password. Dark-felt styling consistent with the
// rest of the app. Touch-friendly: large hit targets, no hover-only affordances.
//
// On success, navigates to the page the user was trying to reach (preserved by
// ProtectedRoute in location.state.from), or to / by default.

import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

const ERROR_MESSAGES = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/user-disabled': 'This account has been disabled. Contact a manager.',
  'auth/user-not-found': 'No account with that email. Contact a manager.',
  'auth/wrong-password': 'Wrong password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many sign-in attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Can’t reach the server. Check the venue internet connection.',
}

function friendlyError(e) {
  if (!e) return 'Something went wrong.'
  if (e.code && ERROR_MESSAGES[e.code]) return ERROR_MESSAGES[e.code]
  return e.message || 'Sign-in failed.'
}

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const fromPath = location.state?.from || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate(fromPath, { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-felt-900 text-white flex items-center justify-center p-6 font-body">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl text-gold-500 mb-1">PlayLive Floor</h1>
          <p className="text-white/60 text-sm">Sign in to continue.</p>
        </div>

        <label className="block">
          <span className="block text-sm text-white/80 mb-2">Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="w-full bg-felt-800 border border-felt-700 rounded-lg px-4 py-3 text-base text-white placeholder-white/40 focus:outline-none focus:border-gold-500 disabled:opacity-50"
            placeholder="you@playlive.com.au"
          />
        </label>

        <label className="block">
          <span className="block text-sm text-white/80 mb-2">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            className="w-full bg-felt-800 border border-felt-700 rounded-lg px-4 py-3 text-base text-white placeholder-white/40 focus:outline-none focus:border-gold-500 disabled:opacity-50"
          />
        </label>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-200 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full bg-gold-500 hover:bg-gold-600 active:bg-gold-600 text-felt-950 font-semibold rounded-lg px-4 py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="text-center text-xs text-white/40">
          Need access? Talk to a manager — accounts are provisioned by venue staff.
          <br />
          <Link to="/display" className="text-gold-400 hover:text-gold-500 underline">
            Open venue display
          </Link>
        </div>
      </form>
    </div>
  )
}
