// The shared chrome around every authenticated route.
//
//   ┌─────────┬──────────────────────────────────┐
//   │ Sidebar │  Main content (per-route)        │
//   │  (drawer│                                  │
//   │   on    │                                  │
//   │   iPad) │                                  │
//   └─────────┴──────────────────────────────────┘
//
// On screens narrower than `md` (mobile / iPad portrait under 768px wide), the
// sidebar collapses behind a hamburger affordance and slides in over the
// content when opened. iPad mini portrait (768px exactly) sits right on the
// breakpoint and shows the sidebar by default.
//
// Each persona's route subtree is wrapped in its own ErrorBoundary by App.jsx
// so a bug on /td doesn't take down /desk.

import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MockRoleSwitcher from './MockRoleSwitcher'

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // When the drawer is open on a small screen, lock body scroll so a swipe
  // on the overlay doesn't drag the page underneath. iOS Safari is particular
  // about this — without the lock you get an unsettling "page slides too" feel.
  useEffect(() => {
    if (!drawerOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [drawerOpen])

  return (
    <div className="min-h-screen text-white font-body flex">
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
        {/* Mobile/iPad header with hamburger. 44×44 button per iOS HIG. */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-white/10 glass-rail sticky top-0 z-20">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="w-11 h-11 flex items-center justify-center rounded-xl titanium text-xl text-white/80 hover:text-white active:translate-y-px transition"
          >
            ☰
          </button>
          <span className="font-brand text-lg tracking-[0.18em] text-brand-400 [text-shadow:0_0_18px_rgba(239,43,43,0.55)] whitespace-nowrap">
            CHECK RAISE
          </span>
        </header>

        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </main>

      <MockRoleSwitcher />
    </div>
  )
}
