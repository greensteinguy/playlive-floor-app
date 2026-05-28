// `/` route. Reads the current role and redirects to that role's landing.
// Lives inside <ProtectedRoute> so a missing user is already handled.

import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { landingPathFor } from './nav'

export default function RoleHome() {
  const { role } = useAuth()
  return <Navigate to={landingPathFor(role)} replace />
}
