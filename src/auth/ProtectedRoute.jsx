// Wraps a route. Three states:
//   - loading: shows a minimal "Loading…" placeholder
//   - no user: redirects to /login (preserving the attempted path in location.state)
//   - user + role mismatch (optional requiredRoles): redirects to /forbidden
//   - otherwise: renders children
//
// Usage:
//   <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
//   <Route path="/admin/something" element={
//     <ProtectedRoute requiredRoles={['manager']}><Admin /></ProtectedRoute>
//   } />

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute({ children, requiredRoles }) {
  const { user, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-felt-900 text-white/60 flex items-center justify-center font-body">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (requiredRoles && !requiredRoles.includes(role)) {
    return <Navigate to="/forbidden" replace />
  }

  return children
}
