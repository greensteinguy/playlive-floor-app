// Guided session-plan builder for the tournament create wizard (task 2.4).
//
// A tournament's play is split into one or more *sessions* (the sessions
// subcollection — canonical-schema.md §5.1). Rather than expose the raw graph
// (UUIDs, convergesIntoSessionId pointers, tiled index slices), this offers
// three guided *shapes* and asks only the questions each shape needs:
//
//   • Single day   — one session, plays to a winner. No further input.
//   • Multi-day    — N days, one session each, resuming on later days. Each
//                    non-final day caps at a structure level; the final day
//                    plays to a winner.
//   • Multi-flight — several parallel Day 1 flights that converge into Day 2.
//                    Day 1's flights share a slice; the final day is single.
//
// Controlled component: the parent (TournamentNew) holds the form-shaped value
// { shape, days, flightCount } and this emits patches. The mapping to the domain
// plan that buildSessionDocs consumes lives in TournamentNew.buildSessionPlan;
// cross-session soundness (slices tiling the structure, one final session) is
// checked by validateSessionPlan at submit. This file only collects inputs and
// renders inline guidance.

import { Select, DateTime } from './FormFields'

const SHAPES = [
  { value: 'singleDay', label: 'Single day', hint: 'One session · plays to a winner' },
  { value: 'multiDay', label: 'Multi-day', hint: 'Resumes on later days' },
  { value: 'multiFlight', label: 'Multi-flight', hint: 'Day 1 flights converge' },
]

const EMPTY_DAY = { endIndex: '', playPct: '', startTime: '' }

// Flight-label range for a flighted day: 1 → 'A', 3 → 'A–C'.
function flightRange(n) {
  if (n <= 1) return 'A'
  return `A–${String.fromCharCode(65 + n - 1)}`
}

// Structure entries → end-of-day <Select> options. The value is the array index:
// maximumEndIndex points into the whole structure (breaks included — a day
// usually bags up *on* its closing break). The 1-based row number disambiguates
// repeated breaks and matches the structure editor's row order.
function levelOptions(structure) {
  return (structure ?? []).map((e, i) => {
    const row = i + 1
    const label =
      e.type === 'level'
        ? `${row}. Level ${e.blindNumber} — ${e.smallBlind}/${e.bigBlind}`
        : `${row}. Break — ${e.durationMinutes}m`
    return { value: String(i), label }
  })
}

// Session labels this plan will create — mirrors buildSessionDocs' labelling so
// the TD sees exactly what lands. Only Day 1 is flighted in the guided shapes.
function previewLabels(shape, days, flightCount) {
  if (shape === 'singleDay') return ['Single session']
  const labels = []
  for (let i = 0; i < days.length; i++) {
    if (shape === 'multiFlight' && i === 0 && flightCount > 1) {
      for (let f = 0; f < flightCount; f++) labels.push(`Day 1${String.fromCharCode(65 + f)}`)
    } else {
      labels.push(`Day ${i + 1}`)
    }
  }
  return labels
}

// Grow/shrink the per-day array to n entries, preserving existing days.
function resizeDays(days, n) {
  const next = days.slice(0, n)
  while (next.length < n) next.push({ ...EMPTY_DAY })
  return next
}

export default function SessionPlanBuilder({ value, onChange, structure, disabled }) {
  const { shape, days, flightCount } = value
  const multiFlight = shape === 'multiFlight'
  const multi = shape !== 'singleDay'
  const endOpts = levelOptions(structure)
  const hasStructure = endOpts.length > 0

  const patchDay = (i, patch) =>
    onChange({ days: days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) })

  function selectShape(next) {
    if (next === shape) return
    if (next === 'singleDay') {
      onChange({ shape: next, days: [{ ...EMPTY_DAY }] })
      return
    }
    // Multi-day / multi-flight both need at least two days (flights need a later
    // day to converge into). Grow the array but keep what's already filled in.
    const grown = resizeDays(days, Math.max(2, days.length))
    const patch = { shape: next, days: grown }
    if (next === 'multiFlight' && flightCount < 2) patch.flightCount = 2
    onChange(patch)
  }

  const setDayCount = (n) => onChange({ days: resizeDays(days, n) })
  const labels = previewLabels(shape, days, flightCount)

  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Days &amp; flights</h3>
      <div className="bg-felt-800 border border-white/5 rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {SHAPES.map((s) => {
            const active = s.value === shape
            return (
              <button
                key={s.value}
                type="button"
                disabled={disabled}
                onClick={() => selectShape(s.value)}
                className={
                  'flex-1 min-w-[10rem] text-left px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 ' +
                  (active
                    ? 'bg-gold-500/20 border-gold-500/40 text-gold-100'
                    : 'bg-felt-900 border-white/10 text-white/70 hover:bg-white/5')
                }
              >
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-[10px] text-white/40 mt-0.5">{s.hint}</span>
              </button>
            )
          })}
        </div>

        {multi && !hasStructure && (
          <p className="text-[11px] text-amber-300/80">
            Build the blind structure first — each day&apos;s end level is chosen from it.
          </p>
        )}

        {multi && (
          <div className="flex flex-wrap gap-8">
            <Stepper label="Number of days" value={days.length} min={2} onChange={setDayCount} disabled={disabled} />
            {multiFlight && (
              <Stepper
                label="Day 1 flights"
                value={flightCount}
                min={2}
                onChange={(n) => onChange({ flightCount: n })}
                disabled={disabled}
              />
            )}
          </div>
        )}

        {multi && (
          <div className="space-y-2">
            {days.map((day, i) => {
              const isFirst = i === 0
              const isFinal = i === days.length - 1
              const title =
                multiFlight && isFirst ? `Day 1 — flights ${flightRange(flightCount)}` : `Day ${i + 1}`
              return (
                <div key={i} className="bg-felt-900/50 border border-white/5 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-display text-gold-200 text-sm">{title}</span>
                    {isFinal && (
                      <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                        plays to a winner
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {isFirst ? (
                      <p className="text-[11px] text-white/40 self-end pb-2">
                        Starts at the tournament&apos;s scheduled time.
                      </p>
                    ) : (
                      <DateTime
                        label="Day start (optional)"
                        value={day.startTime}
                        onChange={(v) => patchDay(i, { startTime: v })}
                        disabled={disabled}
                      />
                    )}
                    {!isFinal ? (
                      <Select
                        label="Ends after level"
                        value={day.endIndex}
                        onChange={(v) => patchDay(i, { endIndex: v })}
                        options={[
                          { value: '', label: hasStructure ? '— choose level —' : 'build structure first' },
                          ...endOpts,
                        ]}
                        disabled={disabled || !hasStructure}
                      />
                    ) : (
                      <div className="hidden md:block" />
                    )}
                    {!isFinal && (
                      <PctField
                        label="Play down to % remaining (optional)"
                        value={day.playPct}
                        onChange={(v) => patchDay(i, { playPct: v })}
                        disabled={disabled}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[11px] text-white/40">
          Creates: <span className="text-white/70">{labels.join(', ')}</span>{' '}
          ({labels.length} session{labels.length === 1 ? '' : 's'})
        </p>
      </div>
    </section>
  )
}

function Stepper({ label, value, onChange, min = 1, max, disabled }) {
  const clamp = (n) => Math.max(min, max != null ? Math.min(max, n) : n)
  const btn =
    'w-8 h-8 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed'
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))} className={btn}>
          −
        </button>
        <span className="font-display text-lg text-white w-6 text-center">{value}</span>
        <button type="button" aria-label={`Increase ${label}`} disabled={disabled || (max != null && value >= max)} onClick={() => onChange(clamp(value + 1))} className={btn}>
          +
        </button>
      </div>
    </div>
  )
}

function PctField({ label, value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{label}</span>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="no early stop"
          disabled={disabled}
          className="w-full bg-felt-900 border border-white/10 rounded pl-3 pr-7 py-2 text-sm disabled:opacity-50"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">%</span>
      </div>
    </label>
  )
}
