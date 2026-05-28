// The shared chrome around every authenticated route.
//
//   ┌─────────┬──────────────────────────────────┐
//   │ Sidebar │  Main content (per-route)        │
//   │  (drawer│                                  │
//   │   on    │                                  │
//   │   iPad) │                                  │
//   └─────────┴──────────────────────────────────┘
//
// On screens narrower than `md` (mobile / iPad portrait), the sidebar collapses
// behind a hamburger affordance and slides in over the content when opened.
//
// Each persona's route subtree is wrapped in its own ErrorBoundary by App.jsx
// so a bug on /td doesn't take down /desk.

import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MockRoleSwitcher from './MockRoleSwitcher'

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="min-h-screen bg-felt-950 text-white font-body flex">
      {/* Desktop sidebar — always visible on md+ */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile/iPad drawer — overlay when open */}
      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="md:hidden fixed inset-0 z-30 bg-black/50"
          />
          <div className="md:hidden fixed top-0 left-0 bottom-0 z-40 flex">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </>
      )}

      {/* Main column */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile/iPad header with hamburger */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-felt-900">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-xl"
          >
            ☰
          </button>
          <span className="font-display text-lg text-gold-400">PlayLive</span>
        </header>

        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </main>

      <MockRoleSwitcher />
    </div>
  )
}
