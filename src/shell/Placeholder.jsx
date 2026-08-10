// Generic "coming in Phase X" placeholder page. Used as the body of every
// route that doesn't have its real implementation yet. Replace with the real
// page when the matching phase task lands.

import { Link } from 'react-router-dom'

export default function Placeholder({ title, phase, task, description }) {
  return (
    <div className="max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <div className="flex items-baseline justify-between gap-4 mb-6">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">{title}</h1>
        {phase && (
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/55 whitespace-nowrap">
            Phase {phase}
            {task ? ` — task ${task}` : ''}
          </span>
        )}
      </div>

      <div className="bg-felt-800 border border-white/5 rounded-lg p-6 md:p-8 space-y-4">
        <p className="text-white/70 leading-relaxed">{description}</p>
        <p className="text-xs text-white/55">
          Placeholder — this page is scaffolded but not yet built. See the Action Plan for
          when the implementation lands.
        </p>
      </div>

      <div className="mt-6 text-sm">
        <Link to="/" className="text-gold-400 hover:text-gold-500 underline">
          ← Back to home
        </Link>
      </div>
    </div>
  )
}
