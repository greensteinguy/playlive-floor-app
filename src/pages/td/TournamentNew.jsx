// Tournament create form (manager-only — gated at the route in App.jsx).
//
// Three-step wizard (General Information / Structure / Re-entry & extras) built
// on the shared FormWizard. Navigation is free — every step is clickable and
// the structure is broken out onto its own step so a long blind structure no
// longer buries the rest of the form. Validation runs on Create (not per step):
// a failed submit flags the offending step(s) and jumps to the first one. Per
// Guy's design call (29 May 2026), which reverses the earlier single-page call.
//
// Money/number fields are held as strings so decimal entry isn't fought by
// re-renders; they're parsed at save. The embedded structure is held as a real
// Structure array (numbers) because that's what StructureEditor edits. Payouts
// aren't edited here — the schema needs a valid PayoutStructure, so the create
// op seeds a winner-takes-all default the payout editor (task 2.3) refines later.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useTournamentTemplates, useStructureTemplates } from '../../hooks/useTemplates'
import { createTournament, validateSessionPlan, TournamentError } from '../../lib/tournaments'
import { Structure } from '../../lib/schema'
import { centsToStr, dollarsToCents, intOrNull, intOf } from '../../lib/money'
import { GAME_TYPES, REENTRY_TYPES } from '../../lib/gameTypes'
import { Section, Text, Money, Num, Select, Toggle, DateTime, BountyValues } from '../../components/FormFields'
import StructureEditor from '../../components/StructureEditor'
import SessionPlanBuilder from '../../components/SessionPlanBuilder'
import FormWizard from '../../components/FormWizard'

// Quick-start seeds for the session routing grid (mirrors SessionPlanBuilder's
// presets): single day = one session; multi-day = a 2-stage linear chain;
// multi-flight = two Day-1 flights funnelling into a single Day 2.
function seedSessionStages(shape) {
  const flight = (survivorsFrom = []) => ({ startTime: '', survivorsFrom })
  const stage = (flights) => ({ endIndex: '', playPct: '', flights })
  if (shape === 'multiFlight') return [stage([flight(), flight()]), stage([flight([0, 1])])]
  if (shape === 'multiDay') return [stage([flight()]), stage([flight([0])])]
  return [stage([flight()])]
}

function initialForm() {
  return {
    fromTemplateId: '',
    name: '',
    shortDescription: '',
    gameType: 'nlh',
    buyIn: '',
    hospitalityCost: '',
    guarantee: '',
    houseConsumption: '',
    startingStack: '20000',
    maxSeatsPerTable: '9',
    // Session plan — guided preset + the stages/flights routing model. isMultiDay
    // / isMultiFlight are DERIVED from this at create time, never stored here.
    sessionShape: 'singleDay',
    sessionStages: seedSessionStages('singleDay'),
    hasUpperDeckMainDeck: false,
    structureTemplateId: '',
    structure: [],
    scheduledStartTime: '',
    lateRegCutoffLevel: '',
    status: 'scheduled',
    reentryType: 'freezeout',
    maxReentries: '',
    maxRebuys: '',
    hasAddOn: false,
    addOnCost: '',
    addOnChips: '',
    ticketReward: '',
    bountyValues: [],
  }
}

// 'YYYY-MM-DDTHH:mm' (datetime-local) → Date in venue-local time, or null.
function localToDate(s) {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

const STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled (visible to players)' },
  { value: 'draft', label: 'Draft (hidden — finish setup later)' },
]

// Wizard step keys, in order. Validation errors are bucketed by these so the
// stepper can flag the step(s) that need attention.
const STEP_ORDER = ['general', 'structure', 'sessions', 'rest']

// Late-reg cutoff options: "no cutoff" + one per blind level in the structure
// (value = blindNumber). Late reg closes at the END of the chosen level.
function lateRegLevelOptions(structure) {
  return [
    { value: '', label: 'No cutoff (close manually)' },
    ...(structure ?? [])
      .filter((e) => e.type === 'level')
      .map((e) => ({ value: String(e.blindNumber), label: `Through Level ${e.blindNumber} (${e.smallBlind}/${e.bigBlind})` })),
  ]
}

export default function TournamentNew() {
  const { user, role } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const tplList = useTournamentTemplates()
  const structures = useStructureTemplates()

  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(0)
  const [stepErrors, setStepErrors] = useState({})
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const mockMode = tplList.mockMode || structures.mockMode
  const d = submitting

  const levelsOf = (id) => structures.templates.find((s) => s.id === id)?.levels ?? []

  // Load a structure template's levels into the editor; '' = keep custom build.
  // structureTemplateId is recorded as provenance even if the levels are later
  // hand-edited (a tournament copies the structure at create time — see §3.4).
  function loadStructure(id) {
    if (id === '') {
      set({ structureTemplateId: '' })
      return
    }
    set({ structureTemplateId: id, structure: levelsOf(id) })
  }

  // Seed every field from a tournament template (or clear the provenance link).
  function applyTemplate(id) {
    if (id === '') {
      set({ fromTemplateId: '' })
      return
    }
    const tpl = tplList.templates.find((t) => t.id === id)
    if (!tpl) return
    const c = tpl.config
    // Templates carry only the format booleans (they predate the session graph),
    // so seed a matching guided preset; the TD refines the days/flights/routing on
    // the Days & flights step.
    const sessionShape = c.isMultiFlight ? 'multiFlight' : c.isMultiDay ? 'multiDay' : 'singleDay'
    set({
      fromTemplateId: tpl.id,
      name: c.name,
      shortDescription: c.shortDescription,
      gameType: c.gameType,
      buyIn: centsToStr(c.buyIn),
      hospitalityCost: centsToStr(c.hospitalityCost),
      guarantee: centsToStr(c.guarantee),
      houseConsumption: centsToStr(c.houseConsumption),
      startingStack: String(c.startingStack),
      maxSeatsPerTable: String(c.maxSeatsPerTable ?? 9),
      sessionShape,
      sessionStages: seedSessionStages(sessionShape),
      hasUpperDeckMainDeck: c.hasUpperDeckMainDeck,
      structureTemplateId: c.structureTemplateId ?? '',
      structure: c.structureTemplateId ? levelsOf(c.structureTemplateId) : [],
      reentryType: c.reentryConfig.type,
      maxReentries: c.reentryConfig.maxReentries != null ? String(c.reentryConfig.maxReentries) : '',
      maxRebuys: c.reentryConfig.maxRebuys != null ? String(c.reentryConfig.maxRebuys) : '',
      hasAddOn: c.reentryConfig.hasAddOn,
      addOnCost: c.reentryConfig.addOnCost != null ? centsToStr(c.reentryConfig.addOnCost) : '',
      addOnChips: c.reentryConfig.addOnChips != null ? String(c.reentryConfig.addOnChips) : '',
      ticketReward: centsToStr(c.satelliteConfig?.ticketReward ?? 0),
      bountyValues: (c.bountyPoolConfig?.bountyValues ?? []).map(centsToStr),
    })
  }

  // Guided session state → the domain plan buildSessionDocs consumes, or null for
  // a single-day tournament (createTournament falls back to SINGLE_DAY_PLAN). The
  // final stage plays to a winner (endStructureIndex null) unless capped; each
  // flight's start time defaults to the tournament start when left blank
  // (localToDate('') → null). survivorsFrom is empty for stage 0.
  function buildSessionPlan() {
    if (form.sessionShape === 'singleDay') return null
    const stages = form.sessionStages.map((stage, i) => ({
      endStructureIndex: stage.endIndex === '' ? null : intOf(stage.endIndex),
      playToPercentRemaining: stage.playPct === '' ? null : Number(stage.playPct),
      flights: stage.flights.map((f) => ({
        scheduledStartTime: localToDate(f.startTime),
        survivorsFrom: i === 0 ? [] : (f.survivorsFrom ?? []),
      })),
    }))
    return { stages }
  }

  // Returns an object keyed by STEP_ORDER; absent key = that step is valid.
  function validate() {
    const errors = {}
    if (form.name.trim() === '') errors.general = 'Tournament name is required.'
    else if (!localToDate(form.scheduledStartTime)) errors.general = 'A valid scheduled start time is required.'
    else if (form.lateRegCutoffLevel !== '' && Number(form.lateRegCutoffLevel) > form.structure.filter((e) => e.type === 'level').length)
      errors.general = 'The late-reg cutoff level is beyond the blind structure.'
    if (form.structure.length === 0 || !Structure.safeParse(form.structure).success) {
      errors.structure = 'Add at least one valid blind level (fix the highlighted rows).'
    }
    // Cross-session soundness (slices tile the structure, one final session) —
    // only when the structure itself is valid, so a structure error isn't
    // double-reported here, and only for multi-session shapes.
    if (!errors.structure && form.sessionShape !== 'singleDay') {
      const planError = validateSessionPlan(buildSessionPlan(), form.structure.length)
      if (planError) errors.sessions = planError
    }
    if (form.gameType === 'mysteryBounty' && form.bountyValues.length < 1) {
      errors.rest = 'Mystery bounty needs at least one bounty value.'
    }
    if (!errors.rest && form.hasAddOn && intOf(form.addOnChips) <= 0) {
      errors.rest = 'An add-on must grant a positive number of chips.'
    }
    return errors
  }

  function buildArgs() {
    const t = form.reentryType
    const bountyCents = form.bountyValues.map(dollarsToCents)
    return {
      name: form.name.trim(),
      shortDescription: form.shortDescription,
      // isMultiDay / isMultiFlight are derived from the session plan inside
      // createTournament, so they're intentionally not passed here.
      gameType: form.gameType,
      buyIn: dollarsToCents(form.buyIn),
      hospitalityCost: dollarsToCents(form.hospitalityCost),
      guarantee: dollarsToCents(form.guarantee),
      houseConsumption: dollarsToCents(form.houseConsumption),
      structureTemplateId: form.structureTemplateId === '' ? null : form.structureTemplateId,
      startingStack: intOf(form.startingStack),
      maxSeatsPerTable: intOf(form.maxSeatsPerTable) || 9,
      structure: form.structure,
      payoutStructure: null,
      scheduledStartTime: localToDate(form.scheduledStartTime),
      lateRegCutoffLevel: form.lateRegCutoffLevel === '' ? null : intOf(form.lateRegCutoffLevel),
      reentryConfig: {
        type: t,
        maxReentries: t === 'reentry' ? intOrNull(form.maxReentries) : null,
        maxRebuys: t === 'rebuy' ? intOrNull(form.maxRebuys) : null,
        hasAddOn: form.hasAddOn,
        addOnCost: form.hasAddOn ? dollarsToCents(form.addOnCost) : null,
        addOnChips: form.hasAddOn ? intOf(form.addOnChips) : null,
      },
      hasUpperDeckMainDeck: form.hasUpperDeckMainDeck,
      satelliteConfig: form.gameType === 'satellite' ? { ticketReward: dollarsToCents(form.ticketReward) } : null,
      // totalPool is the sum of the individual bounties (schema invariant), so
      // derive it rather than asking the TD to keep a separate field in sync.
      bountyPoolConfig:
        form.gameType === 'mysteryBounty'
          ? { totalPool: bountyCents.reduce((a, b) => a + b, 0), bountyValues: bountyCents }
          : null,
      sessionPlan: buildSessionPlan(),
      fromTemplateId: form.fromTemplateId === '' ? null : form.fromTemplateId,
      status: form.status,
      actorId: user.uid,
      actorRole: role,
    }
  }

  async function handleSubmit() {
    const errors = validate()
    const firstKey = STEP_ORDER.find((k) => errors[k])
    if (firstKey) {
      setStepErrors(errors)
      setStep(STEP_ORDER.indexOf(firstKey))
      toast.error(errors[firstKey])
      return
    }
    setStepErrors({})
    setSubmitting(true)
    try {
      const created = await createTournament(buildArgs())
      toast.success(`Created "${created.name}".`)
      navigate('/td/tournaments')
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Create failed: ${e.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const steps = [
    {
      key: 'general',
      label: 'General Information',
      content: (
        <>
          <Section title="Start from a template (optional)">
            <Select
              label="Tournament template"
              value={form.fromTemplateId}
              onChange={applyTemplate}
              options={[
                { value: '', label: tplList.loading ? 'Loading…' : '— Start blank —' },
                ...tplList.templates.map((t) => ({ value: t.id, label: t.name })),
              ]}
              disabled={d}
            />
          </Section>

          <Section title="Tournament basics">
            <Text label="Tournament name" value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g. $100 NLH" disabled={d} />
            <Text label="Short description" value={form.shortDescription} onChange={(v) => set({ shortDescription: v })} placeholder="Shown to players" disabled={d} />
            <Select label="Game type" value={form.gameType} onChange={(v) => set({ gameType: v })} options={GAME_TYPES} disabled={d} />
            <Num label="Starting stack (chips)" value={form.startingStack} onChange={(v) => set({ startingStack: v })} disabled={d} />
            <Num label="Max seats per table" value={form.maxSeatsPerTable} onChange={(v) => set({ maxSeatsPerTable: v })} disabled={d} />
            <Money label="Buy-in" value={form.buyIn} onChange={(v) => set({ buyIn: v })} disabled={d} />
            <Money label="Hospitality / fee" value={form.hospitalityCost} onChange={(v) => set({ hospitalityCost: v })} disabled={d} />
            <Money label="Guarantee" value={form.guarantee} onChange={(v) => set({ guarantee: v })} disabled={d} />
            <Money label="House consumption" value={form.houseConsumption} onChange={(v) => set({ houseConsumption: v })} disabled={d} />
          </Section>

          <Section title="Schedule">
            <DateTime label="Scheduled start" value={form.scheduledStartTime} onChange={(v) => set({ scheduledStartTime: v })} disabled={d} />
            <Select label="Late-reg cutoff (optional)" value={form.lateRegCutoffLevel} onChange={(v) => set({ lateRegCutoffLevel: v })} options={lateRegLevelOptions(form.structure)} disabled={d} />
            <Select label="Status" value={form.status} onChange={(v) => set({ status: v })} options={STATUS_OPTIONS} disabled={d} />
          </Section>
        </>
      ),
    },
    {
      key: 'structure',
      label: 'Structure',
      content: (
        <>
          <section className="mb-5">
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Format</h3>
            <div className="bg-felt-800 border border-white/5 rounded-lg p-4 flex flex-col gap-2">
              <Toggle label="Upper deck / main deck" checked={form.hasUpperDeckMainDeck} onChange={(v) => set({ hasUpperDeckMainDeck: v })} disabled={d} />
              <p className="text-[11px] text-white/40">Multi-day and multi-flight are configured on the Days &amp; flights step.</p>
            </div>
          </section>

          <section className="mb-5">
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Blind structure</h3>
            <div className="bg-felt-800 border border-white/5 rounded-lg p-4 space-y-3">
              <div className="max-w-sm">
                <Select
                  label="Load from structure template"
                  value={form.structureTemplateId}
                  onChange={loadStructure}
                  options={[
                    { value: '', label: structures.loading ? 'Loading…' : '— Custom (build below) —' },
                    ...structures.templates.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  disabled={d}
                />
              </div>
              <StructureEditor value={form.structure} onChange={(next) => set({ structure: next })} disabled={d} />
            </div>
          </section>
        </>
      ),
    },
    {
      key: 'sessions',
      label: 'Days & flights',
      content: (
        <SessionPlanBuilder
          value={{ shape: form.sessionShape, stages: form.sessionStages }}
          onChange={(patch) => {
            const next = {}
            if ('shape' in patch) next.sessionShape = patch.shape
            if ('stages' in patch) next.sessionStages = patch.stages
            set(next)
          }}
          structure={form.structure}
          disabled={d}
        />
      ),
    },
    {
      key: 'rest',
      label: 'Re-entry & extras',
      content: (
        <>
          <Section title="Re-entry">
            <Select label="Type" value={form.reentryType} onChange={(v) => set({ reentryType: v })} options={REENTRY_TYPES} disabled={d} />
            {form.reentryType === 'reentry' && (
              <Num label="Max re-entries (blank = unlimited)" value={form.maxReentries} onChange={(v) => set({ maxReentries: v })} disabled={d} allowEmpty />
            )}
            {form.reentryType === 'rebuy' && (
              <Num label="Max rebuys (blank = unlimited)" value={form.maxRebuys} onChange={(v) => set({ maxRebuys: v })} disabled={d} allowEmpty />
            )}
            <div className="flex flex-col justify-end">
              <Toggle label="Has add-on" checked={form.hasAddOn} onChange={(v) => set({ hasAddOn: v })} disabled={d} />
            </div>
            {form.hasAddOn && (
              <Money label="Add-on cost" value={form.addOnCost} onChange={(v) => set({ addOnCost: v })} disabled={d} />
            )}
            {form.hasAddOn && (
              <Num label="Add-on chips" value={form.addOnChips} onChange={(v) => set({ addOnChips: v })} disabled={d} />
            )}
          </Section>

          {form.gameType === 'satellite' && (
            <Section title="Satellite">
              <Money label="Ticket reward (per seat)" value={form.ticketReward} onChange={(v) => set({ ticketReward: v })} disabled={d} />
            </Section>
          )}

          {form.gameType === 'mysteryBounty' && (
            <Section title="Mystery bounty">
              <div className="md:col-span-2">
                <BountyValues values={form.bountyValues} onChange={(vals) => set({ bountyValues: vals })} disabled={d} />
                <p className="text-[11px] text-white/40 mt-2">Total bounty pool is the sum of the values above.</p>
              </div>
            </Section>
          )}
        </>
      ),
    },
  ]

  const actions = (
    <>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={d || mockMode}
        className={
          'px-4 py-2 rounded-lg text-sm font-medium ' +
          (d || mockMode ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-gold-500/20 text-gold-200 hover:bg-gold-500/30')
        }
      >
        {d ? 'Creating…' : 'Create tournament'}
      </button>
      <button type="button" onClick={() => navigate('/td/tournaments')} disabled={d} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5">
        Cancel
      </button>
    </>
  )

  return (
    <div className="max-w-4xl">
      <button type="button" onClick={() => navigate('/td/tournaments')} className="text-sm text-white/50 hover:text-white mb-4">
        ← Back to tournaments
      </button>

      <h2 className="font-display text-2xl text-white mb-1">Create tournament</h2>
      <p className="text-sm text-white/50 mb-5">Manager-only. Seed from a template, then adjust as needed.</p>

      {mockMode && (
        <div className="bg-felt-800 border border-gold-500/30 rounded-lg p-3 mb-5 text-xs text-white/60">
          Mock mode — saving is disabled. Run <span className="font-mono text-gold-300">npm run emulator</span> (and{' '}
          <span className="font-mono text-gold-300">npm run seed:templates</span> for template/structure pickers) to persist.
        </div>
      )}

      <FormWizard steps={steps} current={step} onStepChange={setStep} errorKeys={Object.keys(stepErrors)} actions={actions} />
    </div>
  )
}
