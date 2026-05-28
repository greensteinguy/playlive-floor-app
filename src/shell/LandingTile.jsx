// One card on a persona landing page. Big tap target so it works on iPad.

import { Link } from 'react-router-dom'

export default function LandingTile({ to, icon, label, description, badge, disabled }) {
  const className =
    'block bg-felt-800 border border-white/5 rounded-xl p-5 md:p-6 transition-colors duration-150 ' +
    (disabled
      ? 'opacity-40 cursor-not-allowed'
      : 'hover:bg-felt-700 hover:border-gold-500/30 hover:shadow-lg')

  const body = (
    <>
      <div className="flex items-start justify-between mb-3 gap-3">
        <span className="text-2xl text-gold-400 leading-none">{icon}</span>
        {badge && (
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
            {badge}
          </span>
        )}
      </div>
      <div className="font-display text-lg text-white mb-1">{label}</div>
      {description && <p className="text-sm text-white/60 leading-relaxed">{description}</p>}
    </>
  )

  if (disabled) {
    return <div className={className}>{body}</div>
  }
  return (
    <Link to={to} className={className}>
      {body}
    </Link>
  )
}
