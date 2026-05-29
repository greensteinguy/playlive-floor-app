// Shared multi-step wizard chrome for the tournament-config forms (the create
// form and the tournament-template editor). Free navigation: every step header
// is clickable and the primary action validates the WHOLE form on submit,
// flagging any step that has an error rather than gating Next. Per Guy's design
// call (29 May 2026) — which reverses the earlier single-page call once a
// filled-out blind structure made the page too long to scan.
//
// Presentational only: it owns no form state. The parent passes the rendered
// step contents, the current index + onStepChange, the set of step keys that
// currently have validation errors, and the action buttons (Create / Save /
// Cancel / Archive) — which differ between the two forms.

export default function FormWizard({ steps, current, onStepChange, errorKeys = [], actions }) {
  const atFirst = current === 0
  const atLast = current === steps.length - 1
  const errored = new Set(errorKeys)

  return (
    <div>
      <nav aria-label="Form steps" className="flex flex-wrap gap-2 mb-6">
        {steps.map((s, i) => {
          const active = i === current
          const hasError = errored.has(s.key)
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onStepChange(i)}
              aria-current={active ? 'step' : undefined}
              className={
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ' +
                (active ? 'bg-gold-500/20 text-gold-200' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80')
              }
            >
              <span
                className={
                  'flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-mono ' +
                  (hasError
                    ? 'bg-red-500/30 text-red-200'
                    : active
                      ? 'bg-gold-500/30 text-gold-100'
                      : 'bg-white/10 text-white/50')
                }
              >
                {hasError ? '!' : i + 1}
              </span>
              <span>{s.label}</span>
            </button>
          )
        })}
      </nav>

      <div>{steps[current].content}</div>

      <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4 mt-6">
        <button
          type="button"
          onClick={() => onStepChange(current - 1)}
          disabled={atFirst}
          className="px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Back
        </button>
        {!atLast && (
          <button
            type="button"
            onClick={() => onStepChange(current + 1)}
            className="px-3 py-2 rounded-lg text-sm text-white/80 bg-white/5 hover:bg-white/10"
          >
            Next →
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div>
      </div>
    </div>
  )
}
