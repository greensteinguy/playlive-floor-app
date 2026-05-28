// Convenience hook for accessing the auth context.
//
// Usage:
//   const { user, role, loading, signIn, signOut } = useAuth()

import { useContext } from 'react'
import { AuthContext } from './AuthContext'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be called inside <AuthProvider>')
  }
  return ctx
}
