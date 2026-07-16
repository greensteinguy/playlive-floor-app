// AuthProvider. Wraps the app and exposes
// { user, role, loading, signIn, signInWithGoogle, signOut }
// via AuthContext (defined in AuthContext.js).
//
// Mock mode: when VITE_USE_MOCK_DATA=true in .env.local, the provider
// short-circuits Firebase entirely and returns a fake user. The fake user's
// role comes from VITE_MOCK_ROLE (one of manager/td/cashier/readonly;
// defaults to manager). Useful when iterating on UI without a real Firebase
// project — see docs/operator/initial-admin-setup.md.

import { useEffect, useState } from 'react'
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
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

  // Shared post-sign-in step: force a token refresh so custom claims (set
  // out-of-band by scripts/admin/set-role.js) are picked up immediately.
  async function adoptSignedInUser(firebaseUser) {
    await firebaseUser.getIdToken(true)
    const tokenResult = await firebaseUser.getIdTokenResult()
    const claimRole = tokenResult.claims.role
    setRole(VALID_ROLES.includes(claimRole) ? claimRole : null)
    return firebaseUser
  }

  function assertRealAuth() {
    if (USE_MOCK_DATA) {
      throw new Error(
        'Sign-in is disabled in mock mode (VITE_USE_MOCK_DATA=true). ' +
        'Set VITE_USE_MOCK_DATA=false in .env.local and configure Firebase to test real auth.'
      )
    }
  }

  async function signIn(email, password) {
    assertRealAuth()
    const credential = await signInWithEmailAndPassword(auth, email, password)
    return adoptSignedInUser(credential.user)
  }

  // Google sign-in (staff Workspace accounts). Any Google account can complete
  // the popup — access is still gated by the `role` custom claim, so a
  // first-time / unknown account lands on the "No access" page until a manager
  // stamps a role on it.
  async function signInWithGoogle() {
    assertRealAuth()
    const provider = new GoogleAuthProvider()
    // Hint the account chooser toward the venue's Workspace domain. Not an
    // access control (any account can still be picked) — the role claim is.
    provider.setCustomParameters({ hd: 'playlive.melbourne', prompt: 'select_account' })
    const credential = await signInWithPopup(auth, provider)
    return adoptSignedInUser(credential.user)
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

  // Mock-mode role switcher (used by the dev-only floating MockRoleSwitcher
  // panel). Returns undefined in production so the panel hides itself.
  const setMockRole = USE_MOCK_DATA
    ? (next) => {
        if (!VALID_ROLES.includes(next)) {
          console.warn(`[auth] setMockRole: "${next}" is not a valid role`)
          return
        }
        setRole(next)
      }
    : undefined

  return (
    <AuthContext.Provider
      value={{ user, role, loading, signIn, signInWithGoogle, signOut, setMockRole }}
    >
      {children}
    </AuthContext.Provider>
  )
}
