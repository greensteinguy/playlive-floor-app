// App shell. Wraps the route tree with auth, toast, and error boundaries,
// then renders the persona-aware layout (sidebar + content area).
//
// Public routes (no auth): /login, /forbidden, /display.
// Protected routes are children of AppShell so they all share the sidebar.

import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ToastProvider } from './shell/Toast'
// (the matching `useToast` hook lives in ./shell/useToast for component-only files)
import { ErrorBoundary } from './shell/ErrorBoundary'
import AppShell from './shell/AppShell'
import RoleHome from './shell/RoleHome'

import Login from './pages/Login'
import Forbidden from './pages/Forbidden'

// Desk persona
import DeskLanding from './pages/desk/DeskLanding'
import DeskPlayers from './pages/desk/Players'
import DeskDeposit from './pages/desk/Deposit'
import DeskWithdrawals from './pages/desk/Withdrawals'
import DeskTickets from './pages/desk/Tickets'

// TD persona
import TdLanding from './pages/td/TdLanding'
import TdTournaments from './pages/td/Tournaments'
import TdTournamentNew from './pages/td/TournamentNew'
import TdTemplates from './pages/td/Templates'
import TdTournamentDetail from './pages/td/TournamentDetail'
import TdTournamentRegister from './pages/td/TournamentRegister'
import TdClock from './pages/td/Clock'
import TdTournamentClock from './pages/td/TournamentClock'
import TdTables from './pages/td/Tables'
import TdBounty from './pages/td/Bounty'
import TdPayouts from './pages/td/Payouts'

// Admin
import AdminAudit from './pages/admin/AuditLog'
import AdminDedupe from './pages/admin/Dedupe'
import AdminReconciliation from './pages/admin/Reconciliation'

function Display() {
  return (
    <div className="min-h-screen bg-felt-950 text-white flex items-center justify-center font-body">
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
      <ToastProvider>
        <ErrorBoundary>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />
            <Route path="/forbidden" element={<Forbidden />} />
            <Route path="/display" element={<Display />} />

            {/* Protected — share the AppShell chrome */}
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<RoleHome />} />

              {/* Registration desk */}
              <Route path="/desk" element={<ErrorBoundary><DeskLanding /></ErrorBoundary>} />
              <Route path="/desk/players" element={<ErrorBoundary><DeskPlayers /></ErrorBoundary>} />
              <Route
                path="/desk/deposit"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['cashier', 'manager']}>
                      <DeskDeposit />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/desk/withdrawals"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['cashier', 'manager']}>
                      <DeskWithdrawals />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/desk/tickets"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['cashier', 'manager']}>
                      <DeskTickets />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />

              {/* Tournament floor */}
              <Route path="/td" element={<ErrorBoundary><TdLanding /></ErrorBoundary>} />
              <Route path="/td/tournaments" element={<ErrorBoundary><TdTournaments /></ErrorBoundary>} />
              <Route
                path="/td/tournaments/new"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['manager']}>
                      <TdTournamentNew />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/td/templates"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['manager']}>
                      <TdTemplates />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/td/tournaments/:id"
                element={<ErrorBoundary><TdTournamentDetail /></ErrorBoundary>}
              />
              <Route
                path="/td/tournaments/:id/register"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['cashier', 'manager']}>
                      <TdTournamentRegister />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/td/tournaments/:id/clock"
                element={<ErrorBoundary><TdTournamentClock /></ErrorBoundary>}
              />
              <Route path="/td/clock" element={<ErrorBoundary><TdClock /></ErrorBoundary>} />
              <Route
                path="/td/tables"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['td', 'manager']}>
                      <TdTables />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/td/bounty"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['td', 'manager']}>
                      <TdBounty />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/td/payouts"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['td', 'cashier', 'manager']}>
                      <TdPayouts />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />

              {/* Admin — manager-only */}
              <Route
                path="/admin/audit"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['manager']}>
                      <AdminAudit />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/admin/dedupe"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['manager']}>
                      <AdminDedupe />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/admin/reconcile"
                element={
                  <ErrorBoundary>
                    <ProtectedRoute requiredRoles={['manager']}>
                      <AdminReconciliation />
                    </ProtectedRoute>
                  </ErrorBoundary>
                }
              />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  )
}
