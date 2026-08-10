// Sign-in page. Google (staff Workspace accounts) or email + password
// (provisioned/test accounts). Dark-felt styling consistent with the rest of
// the app. Touch-friendly: large hit targets, no hover-only affordances.
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
  'auth/popup-blocked': 'The sign-in popup was blocked. Allow popups for this site and try again.',
  'auth/operation-not-allowed':
    'This sign-in method isn’t enabled yet. Contact your system administrator.',
  'auth/unauthorized-domain':
    'This address isn’t authorized for sign-in. Contact your system administrator.',
  'auth/account-exists-with-different-credential':
    'An account with this email already exists with a different sign-in method. Contact a manager.',
}

// The user closing/re-triggering the Google popup isn't an error worth showing.
const SILENT_ERRORS = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request']

function friendlyError(e) {
  if (!e) return 'Something went wrong.'
  if (e.code && ERROR_MESSAGES[e.code]) return ERROR_MESSAGES[e.code]
  return e.message || 'Sign-in failed.'
}

export default function Login() {
  const { signIn, signInWithGoogle } = useAuth()
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

  async function handleGoogle() {
    setError(null)
    setSubmitting(true)
    try {
      await signInWithGoogle()
      navigate(fromPath, { replace: true })
    } catch (err) {
      if (!SILENT_ERRORS.includes(err?.code)) setError(friendlyError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-felt-900 text-white flex items-center justify-center p-6 font-body">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl text-gold-500 mb-1">Check Raise</h1>
          <p className="text-white/70 text-sm">Sign in to continue.</p>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={submitting}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-white/90 active:bg-white/90 text-felt-950 font-semibold rounded-lg px-4 py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Sign in with Google
        </button>

        <div className="flex items-center gap-3 text-white/55 text-xs">
          <span className="flex-1 border-t border-white/10" />
          or use an email account
          <span className="flex-1 border-t border-white/10" />
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
            className="w-full bg-felt-800 border border-felt-700 rounded-lg px-4 py-3 text-base text-white placeholder-white/55 focus:outline-none focus:border-gold-500 disabled:opacity-50"
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
            className="w-full bg-felt-800 border border-felt-700 rounded-lg px-4 py-3 text-base text-white placeholder-white/55 focus:outline-none focus:border-gold-500 disabled:opacity-50"
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

        <div className="text-center text-xs text-white/55">
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
