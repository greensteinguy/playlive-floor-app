// One card on a persona landing page. Big tap target so it works on iPad.
// Glass module with a titanium icon chip; lifts + glows red on hover so it
// unmistakably reads as clickable.

import { Link } from 'react-router-dom'

export default function LandingTile({ to, icon, label, description, badge, disabled }) {
  const className =
    'group relative block overflow-hidden rounded-2xl p-5 md:p-6 transition-all duration-200 glass ' +
    (disabled
      ? 'opacity-40 cursor-not-allowed'
      : 'hover:-translate-y-1 hover:border-brand-500/40 hover:shadow-[0_26px_64px_-26px_rgba(239,43,43,0.55)]')

  const body = (
    <>
      {/* hover sheen along the top edge */}
      {!disabled && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
      )}

      <div className="flex items-start justify-between mb-4 gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl titanium text-xl text-brand-400 [text-shadow:0_0_14px_rgba(239,43,43,0.6)]">
          {icon}
        </span>
        {badge && (
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/35 whitespace-nowrap">
            {badge}
          </span>
        )}
      </div>

      <div className="font-display text-lg text-white mb-1 flex items-center gap-2">
        <span>{label}</span>
        {!disabled && (
          <span className="text-brand-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200">
            →
          </span>
        )}
      </div>
      {description && <p className="text-sm text-white/55 leading-relaxed">{description}</p>}
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
