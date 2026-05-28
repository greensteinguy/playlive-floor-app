// AuthProvider. Wraps the app and exposes { user, role, loading, signIn, signOut }
// via AuthContext (defined in AuthContext.js).
//
// Mock mode: when VITE_USE_MOCK_DATA=true in .env.local, the provider
// short-circuits Firebase entirely and returns a fake user. The fake user's
// role comes from VITE_MOCK_ROLE (one of manager/td/cashier/readonly;
// defaults to manager). Useful when iterating on UI without a real Firebase
// project — see docs/operator/initial-admin-setup.md.

import { useEffect, useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { auth, USE_MOCK_DATA } from '../firebase/config'
import { AuthContext, VALID_ROLES } from './AuthContext'

const MOCK_USER = USE_MOCK_DATA
  ? {
      uid: 'mock-user',
      email: 'mock@playlive.local',
      displayName: 'Mock User',
    }
  : null

const MOCK_ROLE_RAW = USE_MOCK_DATA
  ? import.meta.env.VITE_MOCK_ROLE || 'manager'
  : null

if (USE_MOCK_DATA && MOCK_ROLE_RAW && !VALID_ROLES.includes(MOCK_ROLE_RAW)) {

  console.warn(
    `[auth] VITE_MOCK_ROLE="${MOCK_ROLE_RAW}" is not one of ${VALID_ROLES.join(', ')}. ` +
    `Falling back to "manager".`
  )
}

const effectiveMockRole = USE_MOCK_DATA
  ? (VALID_ROLES.includes(MOCK_ROLE_RAW) ? MOCK_ROLE_RAW : 'manager')
  : null

export function AuthProvider({ children }) {
  const [user, setUser] = useState(USE_MOCK_DATA ? MOCK_USER : null)
  const [role, setRole] = useState(effectiveMockRole)
  const [loading, setLoading] = useState(!USE_MOCK_DATA)

  useEffect(() => {
    if (USE_MOCK_DATA) return // mock mode skips Firebase entirely

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        try {
          const tokenResult = await firebaseUser.getIdTokenResult()
          const claimRole = tokenResult.claims.role
          setRole(VALID_ROLES.includes(claimRole) ? claimRole : null)
        } catch (e) {

          console.error('[auth] failed to read custom claims:', e)
          setRole(null)
        }
      } else {
        setRole(null)
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  async function signIn(email, password) {
    if (USE_MOCK_DATA) {
      throw new Error(
        'Sign-in is disabled in mock mode (VITE_USE_MOCK_DATA=true). ' +
        'Set VITE_USE_MOCK_DATA=false in .env.local and configure Firebase to test real auth.'
      )
    }
    const credential = await signInWithEmailAndPassword(auth, email, password)
    // Force token refresh so custom claims (set out-of-band) are picked up immediately
    await credential.user.getIdToken(true)
    const tokenResult = await credential.user.getIdTokenResult()
    const claimRole = tokenResult.claims.role
    setRole(VALID_ROLES.includes(claimRole) ? claimRole : null)
    return credential.user
  }

  async function signOut() {
    if (USE_MOCK_DATA) {
      // No-op in mock mode — the mock user is always "signed in"
      return
    }
    await fbSignOut(auth)
    setUser(null)
    setRole(null)
  }

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
