// Tournament-config template management (manager-only). Sectioned single-page
// form (per Guy's design call): basics always visible, format-specific sections
// (satellite / mystery bounty) show based on gameType. List ↔ editor toggled
// in-page, like the structure panel.
//
// Money is entered in dollars and stored as integer cents. Numeric form fields
// are held as strings so decimal entry isn't fought by re-renders; they're
// parsed to numbers only when the config is assembled for save.

import { useState } from 'react'
import { useAuth } from '../../../auth/useAuth'
import { useToast } from '../../../shell/useToast'
import { useTournamentTemplates, useStructureTemplates } from '../../../hooks/useTemplates'
import {
  createTournamentTemplate,
  updateTournamentTemplate,
  archiveTournamentTemplate,
  TournamentError,
} from '../../../lib/tournaments'
import { downloadCsv, csvFilename } from '../../../lib/csv'
import { formatMoney, centsToStr, dollarsToCents, intOrNull, intOf } from '../../../lib/money'
import { GAME_TYPES, GAME_TYPE_LABEL, REENTRY_TYPES } from '../../../lib/gameTypes'
import { Section, Text, Money, Num, Select, Toggle, BountyValues, EmptyState } from '../../../components/FormFields'
import FormWizard from '../../../components/FormWizard'

const CSV_COLUMNS = [
  { key: 'id', label: 'Template ID' },
  { key: 'name', label: 'Template name' },
  { key: 'tournamentName', label: 'Tournament name' },
  { key: 'gameType', label: 'Game type' },
  { key: 'buyIn', label: 'Buy-in (cents)' },
  { key: 'guarantee', label: 'Guarantee (cents)' },
  { key: 'isMultiDay', label: 'Multi-day' },
  { key: 'isMultiFlight', label: 'Multi-flight' },
  { key: 'createdAt', label: 'Created at' },
]

export default function TournamentTemplatesPanel() {
  const { templates, loading, error, mockMode, reload } = useTournamentTemplates()
  const toast = useToast()
  const [editing, setEditing] = useState(null)

  function handleExport() {
    if (templates.length === 0) {
      toast.info('Nothing to export — no tournament templates yet.')
      return
    }
    const rows = templates.map((t) => ({
      id: t.id,
      name: t.name,
      tournamentName: t.config.name,
      gameType: t.config.gameType,
      buyIn: t.config.buyIn,
      guarantee: t.config.guarantee,
      isMultiDay: t.config.isMultiDay,
      isMultiFlight: t.config.isMultiFlight,
      createdAt: t.createdAt,
    }))
    downloadCsv(rows, CSV_COLUMNS, csvFilename('tournament-templates'))
    toast.success(`Exported ${rows.length} template${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  if (editing !== null) {
    return (
      <TournamentTemplateEditor
        template={editing.id ? editing : null}
        onDone={() => {
          setEditing(null)
          reload()
        }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  if (mockMode) {
    return (
      <EmptyState
        title="Mock mode — no template data available."
        body="Run npm run emulator + npm run seed:templates to populate the local emulator, then reload. You can still build a template below; it just won't persist in mock mode."
      />
    )
  }
  if (error) return <EmptyState title="Couldn't load tournament templates." body={error.message} tone="error" />
  if (loading) return <div className="py-12 text-center text-white/40 text-sm">Loading…</div>

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="text-xs text-white/40 font-mono">
          {templates.length} active template{templates.length === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setEditing({})}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35"
          >
            + New template
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          title="No tournament templates yet."
          body="Create a reusable tournament config here to pre-fill the create form."
        />
      ) : (
        <div className="bg-felt-800 border border-white/5 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Game</th>
                <th className="text-left px-4 py-2 whitespace-nowrap">Buy-in</th>
                <th className="text-left px-4 py-2">Format</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-white/90">
                    {t.name}
                    {t.config.name !== t.name && (
                      <span className="block text-[11px] text-white/40">→ {t.config.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/70">{GAME_TYPE_LABEL[t.config.gameType] ?? t.config.gameType}</td>
                  <td className="px-4 py-3 text-white/70 whitespace-nowrap">{formatMoney(t.config.buyIn)}</td>
                  <td className="px-4 py-3 text-xs text-white/50">
                    {t.config.isMultiFlight ? 'Multi-flight' : t.config.isMultiDay ? 'Multi-day' : 'Single day'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      className="px-3 py-1.5 rounded text-xs bg-white/5 text-white/70 hover:bg-white/10 hover:text-white active:bg-white/15"
                    >
                      Edit →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function initialForm(template) {
  const c = template?.config
  return {
    templateName: template?.name ?? '',
    templateDescription: template?.description ?? '',
    name: c?.name ?? '',
    shortDescription: c?.shortDescription ?? '',
    gameType: c?.gameType ?? 'nlh',
    buyIn: centsToStr(c?.buyIn ?? 0),
    hospitalityCost: centsToStr(c?.hospitalityCost ?? 0),
    guarantee: centsToStr(c?.guarantee ?? 0),
    houseConsumption: centsToStr(c?.houseConsumption ?? 0),
    startingStack: String(c?.startingStack ?? 20000),
    isMultiDay: c?.isMultiDay ?? false,
    isMultiFlight: c?.isMultiFlight ?? false,
    structureTemplateId: c?.structureTemplateId ?? '',
    hasUpperDeckMainDeck: c?.hasUpperDeckMainDeck ?? false,
    reentryType: c?.reentryConfig?.type ?? 'freezeout',
    maxReentries: c?.reentryConfig?.maxReentries != null ? String(c.reentryConfig.maxReentries) : '',
    maxRebuys: c?.reentryConfig?.maxRebuys != null ? String(c.reentryConfig.maxRebuys) : '',
    hasAddOn: c?.reentryConfig?.hasAddOn ?? false,
    ticketReward: centsToStr(c?.satelliteConfig?.ticketReward ?? 0),
    bountyTotalPool: centsToStr(c?.bountyPoolConfig?.totalPool ?? 0),
    bountyValues: (c?.bountyPoolConfig?.bountyValues ?? []).map(centsToStr),
  }
}

function buildConfig(form) {
  return {
    name: form.name.trim(),
    shortDescription: form.shortDescription,
    isMultiDay: form.isMultiDay,
    isMultiFlight: form.isMultiFlight,
    gameType: form.gameType,
    buyIn: dollarsToCents(form.buyIn),
    hospitalityCost: dollarsToCents(form.hospitalityCost),
    guarantee: dollarsToCents(form.guarantee),
    houseConsumption: dollarsToCents(form.houseConsumption),
    structureTemplateId: form.structureTemplateId === '' ? null : form.structureTemplateId,
    startingStack: intOf(form.startingStack),
    reentryConfig: {
      type: form.reentryType,
      maxReentries: form.reentryType === 'reentry' ? intOrNull(form.maxReentries) : null,
      maxRebuys: form.reentryType === 'rebuy' ? intOrNull(form.maxRebuys) : null,
      hasAddOn: form.hasAddOn,
    },
    hasUpperDeckMainDeck: form.hasUpperDeckMainDeck,
    satelliteConfig: form.gameType === 'satellite' ? { ticketReward: dollarsToCents(form.ticketReward) } : null,
    bountyPoolConfig:
      form.gameType === 'mysteryBounty'
        ? { totalPool: dollarsToCents(form.bountyTotalPool), bountyValues: form.bountyValues.map(dollarsToCents) }
        : null,
  }
}

// Wizard step keys, in order — validation errors are bucketed by these so the
// stepper can flag the step(s) that need attention.
const STEP_ORDER = ['general', 'structure', 'rest']

function TournamentTemplateEditor({ template, onDone, onCancel }) {
  const { user, role } = useAuth()
  const toast = useToast()
  const isEdit = Boolean(template)
  const structures = useStructureTemplates()

  const [form, setForm] = useState(() => initialForm(template))
  const [submitting, setSubmitting] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [step, setStep] = useState(0)
  const [stepErrors, setStepErrors] = useState({})
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  // Keep the schema's isMultiFlight ⇒ isMultiDay invariant true by construction.
  const setMultiFlight = (on) => set(on ? { isMultiFlight: true, isMultiDay: true } : { isMultiFlight: false })
  const setMultiDay = (on) => set(on ? { isMultiDay: true } : { isMultiDay: false, isMultiFlight: false })

  // Returns an object keyed by STEP_ORDER; absent key = that step is valid.
  function validate() {
    const errors = {}
    if (form.templateName.trim() === '') errors.general = 'Template name is required.'
    else if (form.name.trim() === '') errors.general = 'Tournament name is required.'
    if (form.gameType === 'mysteryBounty' && form.bountyValues.length < 1) {
      errors.rest = 'Mystery bounty needs at least one bounty value.'
    }
    return errors
  }

  async function handleSave() {
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
      const config = buildConfig(form)
      const name = form.templateName.trim()
      const description = form.templateDescription.trim() === '' ? null : form.templateDescription.trim()
      if (isEdit) {
        await updateTournamentTemplate({
          id: template.id,
          patch: { name, description, config },
          actorId: user.uid,
          actorRole: role,
        })
        toast.success(`Updated "${name}".`)
      } else {
        await createTournamentTemplate({ name, description, config, actorId: user.uid, actorRole: role })
        toast.success(`Created "${name}".`)
      }
      onDone()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Save failed: ${e.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleArchive() {
    setSubmitting(true)
    try {
      await archiveTournamentTemplate({ id: template.id, actorId: user.uid, actorRole: role })
      toast.success(`Archived "${template.name}".`)
      onDone()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Archive failed: ${e.message}`)
    } finally {
      setSubmitting(false)
      setConfirmArchive(false)
    }
  }

  const d = submitting

  const steps = [
    {
      key: 'general',
      label: 'General Information',
      content: (
        <>
          <Section title="Template details">
            <Text label="Template name" value={form.templateName} onChange={(v) => set({ templateName: v })} placeholder="e.g. Friday Night Special" disabled={d} />
            <Text label="Template note (optional)" value={form.templateDescription} onChange={(v) => set({ templateDescription: v })} placeholder="Internal note" disabled={d} />
          </Section>

          <Section title="Tournament basics">
            <Text label="Tournament name" value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g. $100 NLH" disabled={d} />
            <Text label="Short description" value={form.shortDescription} onChange={(v) => set({ shortDescription: v })} placeholder="Shown to players" disabled={d} />
            <Select label="Game type" value={form.gameType} onChange={(v) => set({ gameType: v })} options={GAME_TYPES} disabled={d} />
            <Money label="Buy-in" value={form.buyIn} onChange={(v) => set({ buyIn: v })} disabled={d} />
            <Money label="Hospitality / fee" value={form.hospitalityCost} onChange={(v) => set({ hospitalityCost: v })} disabled={d} />
            <Money label="Guarantee" value={form.guarantee} onChange={(v) => set({ guarantee: v })} disabled={d} />
            <Money label="House consumption" value={form.houseConsumption} onChange={(v) => set({ houseConsumption: v })} disabled={d} />
            <Num label="Starting stack (chips)" value={form.startingStack} onChange={(v) => set({ startingStack: v })} disabled={d} />
          </Section>
        </>
      ),
    },
    {
      key: 'structure',
      label: 'Structure',
      content: (
        <Section title="Format & structure">
          <Select
            label="Blind structure"
            value={form.structureTemplateId}
            onChange={(v) => set({ structureTemplateId: v })}
            options={[
              { value: '', label: structures.loading ? 'Loading…' : '— None (set later) —' },
              ...structures.templates.map((s) => ({ value: s.id, label: s.name })),
            ]}
            disabled={d}
          />
          <div className="flex flex-col gap-2 justify-end">
            <Toggle label="Multi-day" checked={form.isMultiDay} onChange={setMultiDay} disabled={d} />
            <Toggle label="Multi-flight" checked={form.isMultiFlight} onChange={setMultiFlight} disabled={d} hint="Implies multi-day" />
            <Toggle label="Upper deck / main deck" checked={form.hasUpperDeckMainDeck} onChange={(v) => set({ hasUpperDeckMainDeck: v })} disabled={d} />
          </div>
        </Section>
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
          </Section>

          {form.gameType === 'satellite' && (
            <Section title="Satellite">
              <Money label="Ticket reward (per seat)" value={form.ticketReward} onChange={(v) => set({ ticketReward: v })} disabled={d} />
            </Section>
          )}

          {form.gameType === 'mysteryBounty' && (
            <Section title="Mystery bounty">
              <Money label="Total bounty pool" value={form.bountyTotalPool} onChange={(v) => set({ bountyTotalPool: v })} disabled={d} />
              <div className="md:col-span-2">
                <BountyValues values={form.bountyValues} onChange={(vals) => set({ bountyValues: vals })} disabled={d} />
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
        onClick={handleSave}
        disabled={d}
        className={
          'px-4 py-2 rounded-lg text-sm font-medium ' +
          (d ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-gold-500/20 text-gold-200 hover:bg-gold-500/30')
        }
      >
        {d ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}
      </button>
      <button type="button" onClick={onCancel} disabled={d} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5">
        Cancel
      </button>

      {isEdit && (
        <div className="ml-1 sm:ml-3">
          {confirmArchive ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/60">Archive this template?</span>
              <button type="button" onClick={handleArchive} disabled={d} className="px-3 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30">
                Confirm
              </button>
              <button type="button" onClick={() => setConfirmArchive(false)} disabled={d} className="px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white">
                Keep
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmArchive(true)} disabled={d} className="px-3 py-2 rounded-lg text-xs text-red-300/70 hover:text-red-200 hover:bg-red-500/10">
              Archive
            </button>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className="max-w-4xl">
      <button type="button" onClick={onCancel} className="text-sm text-white/50 hover:text-white mb-4">
        ← Back to templates
      </button>

      <h2 className="font-display text-2xl text-white mb-5">
        {isEdit ? `Edit template — ${template.name}` : 'New tournament template'}
      </h2>

      <FormWizard steps={steps} current={step} onStepChange={setStep} errorKeys={Object.keys(stepErrors)} actions={actions} />
    </div>
  )
}
