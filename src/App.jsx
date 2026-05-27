import { Routes, Route, Link } from 'react-router-dom'

// Placeholder app shell. Phase 1 task 1.5 will replace this with the
// real persona-tailored layout (TD landing + Registration Desk landing).
//
// Run `npm install && npm run dev` to verify the scaffold works,
// then start on Phase 0 / Phase 1 tasks from docs/02_Action_Plan.md.

function Home() {
  return (
    <div className="min-h-screen bg-felt-900 text-white p-8 font-body">
      <h1 className="font-display text-4xl text-gold-500 mb-2">PlayLive Floor App</h1>
      <p className="text-white/60 text-sm mb-8">Scaffold only — built out in Phases 1 through 6.</p>

      <div className="space-y-3">
        <p className="text-white/80">
          See <code className="text-gold-400">CLAUDE.md</code> for project context.
        </p>
        <p className="text-white/80">
          See <code className="text-gold-400">docs/HANDOFF.md</code> for where to start.
        </p>
        <p className="text-white/80">
          See <code className="text-gold-400">docs/02_Action_Plan.md</code> for the phase plan.
        </p>
      </div>

      <nav className="mt-12 flex gap-4 text-sm">
        <Link to="/display" className="text-gold-400 hover:text-gold-500 underline">/display (placeholder)</Link>
      </nav>
    </div>
  )
}

function Display() {
  return (
    <div className="min-h-screen bg-felt-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h2 className="font-display text-6xl text-gold-500 mb-4">Venue Display</h2>
        <p className="text-white/60">Phase 5 builds this out as the cycling TV view.</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/display" element={<Display />} />
    </Routes>
  )
}
