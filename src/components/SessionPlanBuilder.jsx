// Session-plan builder for the tournament create wizard (task 2.4 / multi-flight).
//
// A tournament's play is split into one or more *sessions* (the sessions
// subcollection — canonical-schema.md §5.1), organised into ordered STAGES (days),
// each running one or more parallel FLIGHTS. Routing is a fan-in funnel: each
// flight feeds exactly ONE flight in the next stage, and a stage's flights
// partition the previous stage's flights ("survivors from").
//
// Three quick-start presets seed the grid (single day / multi-day / multi-flight);
// the routing grid below is then fully editable for arbitrary N→N→1 funnels.
//
// Controlled component: the parent (TournamentNew) holds { shape, stages } and
// this emits patches. The mapping to the domain plan buildSessionDocs consumes
// lives in TournamentNew.buildSessionPlan; the same validateSessionPlan runs here
// for live feedback and at submit. Stage shape:
//   stages[i] = { endIndex: string, playPct: string,
//                 flights: [{ startTime: string, survivorsFrom: number[] }] }
// survivorsFrom holds indices into the PREVIOUS stage's flights ([] for stage 0).

import { Select, DateTime } from './FormFields'
import { validateSessionPlan } from '../lib/tournaments'

const SHAPES = [
  { value: 'singleDay', label: 'Single day', hint: 'One session · plays to a winner' },
  { value: 'multiDay', label: 'Multi-day', hint: 'Resumes on later days' },
  { value: 'multiFlight', label: 'Multi-flight', hint: 'Flights funnel into later days' },
]

const letter = (n) => String.fromCharCode(65 + n)
const range = (n) => Array.from({ length: n }, (_, i) => i)
const emptyFlight = (survivorsFrom = []) => ({ startTime: '', survivorsFrom })
const emptyStage = (flights) => ({ endIndex: '', playPct: '', flights })

// Quick-start seeds. Each preset produces a valid starting funnel the TD refines.
function seedStages(shape) {
  if (shape === 'singleDay') return [emptyStage([emptyFlight()])]
  if (shape === 'multiDay') return [emptyStage([emptyFlight()]), emptyStage([emptyFlight([0])])]
  // multiFlight: two Day-1 flights funnelling into a single Day 2.
  return [emptyStage([emptyFlight(), emptyFlight()]), emptyStage([emptyFlight([0, 1])])]
}

// Structure entries → end-of-day <Select> options. Value is the array index
// (maximumEndIndex points into the whole structure, breaks included — a day
// usually bags up on its closing break).
function levelOptions(structure) {
  return (structure ?? []).map((e, i) => ({
    value: String(i),
    label:
      e.type === 'level'
        ? `${i + 1}. Level ${e.blindNumber} — ${e.smallBlind}/${e.bigBlind}`
        : `${i + 1}. Break — ${e.durationMinutes}m`,
  }))
}

// The session labels this plan will create — mirrors buildSessionDocs' labelling.
function previewLabels(stages) {
  const labels = []
  stages.forEach((stage, i) => {
    if (stage.flights.length > 1) stage.flights.forEach((_, f) => labels.push(`Day ${i + 1}${letter(f)}`))
    else labels.push(`Day ${i + 1}`)
  })
  return labels
}

// Map the form-shaped stages to the domain plan (times omitted — validation
// doesn't need them) so we can surface live soundness feedback.
function toPlan(stages) {
  return {
    stages: stages.map((s, i) => ({
      endStructureIndex: s.endIndex === '' ? null : Number(s.endIndex),
      playToPercentRemaining: s.playPct === '' ? null : Number(s.playPct),
      flights: s.flights.map((f) => ({ survivorsFrom: i === 0 ? [] : f.survivorsFrom })),
    })),
  }
}

export default function SessionPlanBuilder({ value, onChange, structure, disabled }) {
  const { shape, stages } = value
  const multi = shape !== 'singleDay'
  const endOpts = levelOptions(structure)
  const hasStructure = endOpts.length > 0

  const setStages = (next) => onChange({ stages: next })

  function selectShape(next) {
    if (next === shape) return
    onChange({ shape: next, stages: seedStages(next) })
  }

  function setDayCount(n) {
    const target = Math.max(2, n)
    const next = stages.slice(0, target)
    while (next.length < target) {
      const prevCount = next[next.length - 1].flights.length
      next.push(emptyStage([emptyFlight(range(prevCount))])) // new final pulls from all of the prior stage
    }
    setStages(next)
  }

  const patchStage = (i, patch) => setStages(stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const patchFlight = (si, fi, patch) =>
    setStages(
      stages.map((s, i) =>
        i === si ? { ...s, flights: s.flights.map((f, j) => (j === fi ? { ...f, ...patch } : f)) } : s,
      ),
    )
  const addFlight = (si) =>
    setStages(stages.map((s, i) => (i === si ? { ...s, flights: [...s.flights, emptyFlight()] } : s)))
  function removeFlight(si, fi) {
    setStages(
      stages.map((s, i) => {
        if (i === si) return { ...s, flights: s.flights.filter((_, j) => j !== fi) }
        // Fix the next stage's references to the removed flight: drop it, shift down.
        if (i === si + 1) {
          return {
            ...s,
            flights: s.flights.map((f) => ({
              ...f,
              survivorsFrom: f.survivorsFrom.filter((p) => p !== fi).map((p) => (p > fi ? p - 1 : p)),
            })),
          }
        }
        return s
      }),
    )
  }
  function toggleSurvivor(si, fi, prev) {
    const cur = stages[si].flights[fi].survivorsFrom
    const nextFrom = cur.includes(prev) ? cur.filter((p) => p !== prev) : [...cur, prev].sort((a, b) => a - b)
    patchFlight(si, fi, { survivorsFrom: nextFrom })
  }

  const labels = previewLabels(stages)
  const planError = multi && hasStructure ? validateSessionPlan(toPlan(stages), structure.length) : null

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
          <Stepper label="Number of days" value={stages.length} min={2} onChange={setDayCount} disabled={disabled} />
        )}

        {multi &&
          stages.map((stage, i) => {
            const isFinal = i === stages.length - 1
            const prevFlights = i > 0 ? stages[i - 1].flights : []
            const multiFlight = stage.flights.length > 1
            return (
              <div key={i} className="bg-felt-900/50 border border-white/5 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-gold-200 text-sm">
                    Day {i + 1}
                    {multiFlight ? ` — flights A–${letter(stage.flights.length - 1)}` : ''}
                  </span>
                  {isFinal && (
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                      plays to a winner
                    </span>
                  )}
                </div>

                {/* Day-level slice + early-stop (non-final days cap at a level). */}
                {!isFinal && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Select
                      label="Ends after level"
                      value={stage.endIndex}
                      onChange={(v) => patchStage(i, { endIndex: v })}
                      options={[
                        { value: '', label: hasStructure ? '— choose level —' : 'build structure first' },
                        ...endOpts,
                      ]}
                      disabled={disabled || !hasStructure}
                    />
                    <PctField
                      label="Play down to % remaining (optional)"
                      value={stage.playPct}
                      onChange={(v) => patchStage(i, { playPct: v })}
                      disabled={disabled}
                    />
                  </div>
                )}

                {/* Flights */}
                <div className="space-y-2">
                  {stage.flights.map((flight, f) => (
                    <div key={f} className="bg-felt-800/60 border border-white/5 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-white/70">
                          {multiFlight ? `Flight ${letter(f)}` : 'Session'}
                        </span>
                        {stage.flights.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remove flight ${letter(f)}`}
                            disabled={disabled}
                            onClick={() => removeFlight(i, f)}
                            className="text-white/30 hover:text-red-300 text-sm px-2 disabled:opacity-40"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <DateTime
                        label="Flight start (blank = tournament start)"
                        value={flight.startTime}
                        onChange={(v) => patchFlight(i, f, { startTime: v })}
                        disabled={disabled}
                      />
                      {i > 0 && (
                        <div className="mt-2">
                          <span className="block text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">
                            Survivors from
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {prevFlights.map((_, p) => {
                              const on = flight.survivorsFrom.includes(p)
                              const lbl = prevFlights.length > 1 ? `Day ${i}${letter(p)}` : `Day ${i}`
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => toggleSurvivor(i, f, p)}
                                  className={
                                    'px-2.5 py-1 rounded-full text-[11px] border transition-colors disabled:opacity-50 ' +
                                    (on
                                      ? 'bg-gold-500/20 border-gold-500/40 text-gold-100'
                                      : 'bg-felt-900 border-white/10 text-white/50 hover:bg-white/5')
                                  }
                                >
                                  {lbl}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {!isFinal && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => addFlight(i)}
                      className="text-[11px] text-gold-300 hover:text-gold-200 disabled:opacity-50"
                    >
                      + flight
                    </button>
                  )}
                </div>
              </div>
            )
          })}

        {planError ? (
          <p className="text-[11px] text-amber-300/90">⚠ {planError}</p>
        ) : (
          <p className="text-[11px] text-white/40">
            Creates: <span className="text-white/70">{labels.join(', ')}</span>{' '}
            ({labels.length} session{labels.length === 1 ? '' : 's'})
          </p>
        )}
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
