// Single tournament detail page (scaffold — Phase 2/3).
//
// A consistent top bar (name, status, key facts) sits above a four-tab body:
//   Details  — editable config (basics, money, schedule, re-entry, extras)
//   Structure — format flags + the blind structure editor
//   Players  — read-only counters for now; registration/seating land in Phase 3
//   Payouts  — read-only summary for now; the payout editor is task 2.3
//
// Editing is gated to manager + TD (matches the Firestore write rules); cashier
// and read-only roles get a disabled, read-only view. Status is NOT edited here —
// it's live state owned by the clock + status-transition flow, so the top bar
// shows it as a badge only.
//
// Saves go through the SAFE updateTournament domain op (read-modify-write +
// full-schema re-validation), never the partial data-layer update. Each editable
// tab owns its own save scope: Details saves the config fields, Structure saves
// the format flags + blind levels (audited as tournament.structureEdited). Form
// values are held as strings (so decimal entry isn't fought by re-renders) and
// converted at the save boundary, mirroring the create form.

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useTournament } from '../../hooks/useTournament'
import { useStructureTemplates } from '../../hooks/useTemplates'
import { updateTournament, TournamentError } from '../../lib/tournaments'
import { Structure } from '../../lib/schema'
import { centsToStr, dollarsToCents, intOrNull, intOf, formatMoney } from '../../lib/money'
import { GAME_TYPES, GAME_TYPE_LABEL, REENTRY_TYPES } from '../../lib/gameTypes'
import { Section, Text, Money, Num, Select, Toggle, DateTime, BountyValues, EmptyState } from '../../components/FormFields'
import StructureEditor from '../../components/StructureEditor'
import StatusBadge from '../../components/StatusBadge'

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'structure', label: 'Structure' },
  { id: 'players', label: 'Players' },
  { id: 'payouts', label: 'Payouts' },
]

// 'YYYY-MM-DDTHH:mm' (datetime-local) → Date in venue-local time, or null.
// Inverse of tsToLocalInput below; mirrors the create form's localToDate.
function localToDate(s) {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

// Firestore Timestamp → 'YYYY-MM-DDTHH:mm' in venue-local time for a
// datetime-local input. Null/absent → '' (empty field).
function tsToLocalInput(ts) {
  if (!ts) return ''
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDateTime(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  return d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Tournament document → string-keyed form state (mirrors the create form's
// applyTemplate mapping). centsToStr renders 0 as '' so the field shows its
// placeholder; dollarsToCents('') round-trips back to 0 on save.
function formFromTournament(t) {
  return {
    name: t.name,
    shortDescription: t.shortDescription,
    gameType: t.gameType,
    buyIn: centsToStr(t.buyIn),
    hospitalityCost: centsToStr(t.hospitalityCost),
    guarantee: centsToStr(t.guarantee),
    houseConsumption: centsToStr(t.houseConsumption),
    startingStack: String(t.startingStack),
    isMultiDay: t.isMultiDay,
    isMultiFlight: t.isMultiFlight,
    hasUpperDeckMainDeck: t.hasUpperDeckMainDeck,
    structureTemplateId: t.structureTemplateId ?? '',
    structure: t.structure,
    scheduledStartTime: tsToLocalInput(t.scheduledStartTime),
    lateRegCutoffTime: tsToLocalInput(t.lateRegCutoffTime),
    reentryType: t.reentryConfig.type,
    maxReentries: t.reentryConfig.maxReentries != null ? String(t.reentryConfig.maxReentries) : '',
    maxRebuys: t.reentryConfig.maxRebuys != null ? String(t.reentryConfig.maxRebuys) : '',
    hasAddOn: t.reentryConfig.hasAddOn,
    addOnCost: t.reentryConfig.addOnCost != null ? centsToStr(t.reentryConfig.addOnCost) : '',
    addOnChips: t.reentryConfig.addOnChips != null ? String(t.reentryConfig.addOnChips) : '',
    ticketReward: centsToStr(t.satelliteConfig?.ticketReward ?? 0),
    bountyValues: (t.bountyPoolConfig?.bountyValues ?? []).map(centsToStr),
  }
}

// Config fields the Details tab owns. Excludes structure + format flags (Structure
// tab), status/counters/live-state/audit (owned elsewhere), and provenance
// (legacyId, fromTemplateId, structureTemplateId).
function buildDetailsPatch(form) {
  const t = form.reentryType
  const bountyCents = form.bountyValues.map(dollarsToCents)
  return {
    name: form.name.trim(),
    shortDescription: form.shortDescription,
    gameType: form.gameType,
    buyIn: dollarsToCents(form.buyIn),
    hospitalityCost: dollarsToCents(form.hospitalityCost),
    guarantee: dollarsToCents(form.guarantee),
    houseConsumption: dollarsToCents(form.houseConsumption),
    startingStack: intOf(form.startingStack),
    scheduledStartTime: localToDate(form.scheduledStartTime),
    lateRegCutoffTime: localToDate(form.lateRegCutoffTime),
    reentryConfig: {
      type: t,
      maxReentries: t === 'reentry' ? intOrNull(form.maxReentries) : null,
      maxRebuys: t === 'rebuy' ? intOrNull(form.maxRebuys) : null,
      hasAddOn: form.hasAddOn,
      addOnCost: form.hasAddOn ? dollarsToCents(form.addOnCost) : null,
      addOnChips: form.hasAddOn ? intOf(form.addOnChips) : null,
    },
    satelliteConfig: form.gameType === 'satellite' ? { ticketReward: dollarsToCents(form.ticketReward) } : null,
    // totalPool is the sum of the bounties (schema invariant) — derive it.
    bountyPoolConfig:
      form.gameType === 'mysteryBounty'
        ? { totalPool: bountyCents.reduce((a, b) => a + b, 0), bountyValues: bountyCents }
        : null,
  }
}

function buildStructurePatch(form) {
  return {
    isMultiDay: form.isMultiDay,
    isMultiFlight: form.isMultiFlight,
    hasUpperDeckMainDeck: form.hasUpperDeckMainDeck,
    structureTemplateId: form.structureTemplateId === '' ? null : form.structureTemplateId,
    structure: form.structure,
  }
}

function validateDetails(form) {
  if (form.name.trim() === '') return 'Tournament name is required.'
  if (!localToDate(form.scheduledStartTime)) return 'A valid scheduled start time is required.'
  if (form.lateRegCutoffTime && !localToDate(form.lateRegCutoffTime)) return 'The late-reg cutoff time is invalid.'
  if (form.gameType === 'mysteryBounty' && form.bountyValues.length < 1) return 'Mystery bounty needs at least one bounty value.'
  if (form.hasAddOn && intOf(form.addOnChips) <= 0) return 'An add-on must grant a positive number of chips.'
  return null
}

function validateStructure(form) {
  if (form.structure.length === 0 || !Structure.safeParse(form.structure).success) {
    return 'Add at least one valid blind level (fix the highlighted rows).'
  }
  return null
}

export default function TournamentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const toast = useToast()
  const { tournament, loading, error, mockMode, notFound, reload } = useTournament(id)
  const structures = useStructureTemplates()

  const [tab, setTab] = useState('details')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  // Seed the editable form once per loaded tournament id — NOT on every reload,
  // so a save on one tab doesn't wipe unsaved edits on another. The top bar
  // still refreshes from `tournament` (which reload() updates).
  const seededId = useRef(null)
  useEffect(() => {
    if (tournament && seededId.current !== tournament.id) {
      setForm(formFromTournament(tournament))
      seededId.current = tournament.id
    }
  }, [tournament])

  const canEdit = role === 'manager' || role === 'td'
  const d = saving || !canEdit
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  // Keep the schema's isMultiFlight ⇒ isMultiDay invariant true by construction.
  const setMultiFlight = (on) => set(on ? { isMultiFlight: true, isMultiDay: true } : { isMultiFlight: false })
  const setMultiDay = (on) => set(on ? { isMultiDay: true } : { isMultiDay: false, isMultiFlight: false })

  const levelsOf = (sid) => structures.templates.find((s) => s.id === sid)?.levels ?? []
  function loadStructure(sid) {
    if (sid === '') {
      set({ structureTemplateId: '' })
      return
    }
    set({ structureTemplateId: sid, structure: levelsOf(sid) })
  }

  async function save(buildPatch, validate, actionType, successMsg) {
    const err = validate(form)
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      const updated = await updateTournament({
        id,
        patch: buildPatch(form),
        actorId: user.uid,
        actorRole: role,
        ...(actionType ? { actionType } : {}),
      })
      toast.success(successMsg(updated))
      reload()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const saveDetails = () =>
    save(buildDetailsPatch, validateDetails, undefined, (u) => `Saved "${u.name}".`)
  const saveStructure = () =>
    save(buildStructurePatch, validateStructure, 'tournament.structureEdited', () => 'Structure saved.')

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-5xl">
      <button
        type="button"
        onClick={() => navigate('/td/tournaments')}
        className="text-sm text-white/50 hover:text-white mb-4"
      >
        ← Back to tournaments
      </button>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no tournament data available."
          body="Run npm run emulator + create or seed a tournament against the local Firestore emulator, then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load this tournament." body={error.message} tone="error" />
      ) : notFound ? (
        <EmptyState
          title="Tournament not found."
          body="This tournament may have been removed, or the link is out of date."
        />
      ) : loading || !tournament || !form ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          <TopBar t={tournament} />

          {!canEdit && (
            <div className="bg-felt-800 border border-white/10 rounded-lg px-4 py-2 mb-5 text-xs text-white/50">
              Read-only access — ask a manager or TD to make changes.
            </div>
          )}

          <div className="flex gap-1 border-b border-white/10 mb-6 overflow-x-auto">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                className={
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ' +
                  (tab === tb.id
                    ? 'border-gold-400 text-gold-300'
                    : 'border-transparent text-white/50 hover:text-white/80')
                }
              >
                {tb.label}
              </button>
            ))}
          </div>

          {tab === 'details' && (
            <>
              <Section title="Tournament basics">
                <Text label="Tournament name" value={form.name} onChange={(v) => set({ name: v })} placeholder="e.g. $100 NLH" disabled={d} />
                <Text label="Short description" value={form.shortDescription} onChange={(v) => set({ shortDescription: v })} placeholder="Shown to players" disabled={d} />
                <Select label="Game type" value={form.gameType} onChange={(v) => set({ gameType: v })} options={GAME_TYPES} disabled={d} />
                <Num label="Starting stack (chips)" value={form.startingStack} onChange={(v) => set({ startingStack: v })} disabled={d} />
                <Money label="Buy-in" value={form.buyIn} onChange={(v) => set({ buyIn: v })} disabled={d} />
                <Money label="Hospitality / fee" value={form.hospitalityCost} onChange={(v) => set({ hospitalityCost: v })} disabled={d} />
                <Money label="Guarantee" value={form.guarantee} onChange={(v) => set({ guarantee: v })} disabled={d} />
                <Money label="House consumption" value={form.houseConsumption} onChange={(v) => set({ houseConsumption: v })} disabled={d} />
              </Section>

              <Section title="Schedule">
                <DateTime label="Scheduled start" value={form.scheduledStartTime} onChange={(v) => set({ scheduledStartTime: v })} disabled={d} />
                <DateTime label="Late-reg cutoff (optional)" value={form.lateRegCutoffTime} onChange={(v) => set({ lateRegCutoffTime: v })} disabled={d} />
              </Section>

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

              {canEdit && <SaveBar onSave={saveDetails} saving={saving} label="Save details" />}
            </>
          )}

          {tab === 'structure' && (
            <>
              <section className="mb-5">
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Format</h3>
                <div className="bg-felt-800 border border-white/5 rounded-lg p-4 flex flex-col gap-2">
                  <Toggle label="Multi-day" checked={form.isMultiDay} onChange={setMultiDay} disabled={d} />
                  <Toggle label="Multi-flight" checked={form.isMultiFlight} onChange={setMultiFlight} disabled={d} hint="Implies multi-day" />
                  <Toggle label="Upper deck / main deck" checked={form.hasUpperDeckMainDeck} onChange={(v) => set({ hasUpperDeckMainDeck: v })} disabled={d} />
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

              {canEdit && <SaveBar onSave={saveStructure} saving={saving} label="Save structure" />}
            </>
          )}

          {tab === 'players' && <PlayersTab t={tournament} />}
          {tab === 'payouts' && <PayoutsTab t={tournament} />}
        </>
      )}
    </div>
  )
}

function TopBar({ t }) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-2xl md:text-3xl text-gold-400">{t.name}</h1>
          <StatusBadge status={t.status} />
          {(t.isMultiDay || t.isMultiFlight) && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">
              {t.isMultiFlight ? 'multi-flight' : 'multi-day'}
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 2 / 3
        </span>
      </div>
      <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
        <Meta label="Game" value={GAME_TYPE_LABEL[t.gameType] ?? t.gameType} />
        <Meta label="Buy-in" value={formatMoney(t.buyIn)} />
        <Meta label="Guarantee" value={formatMoney(t.guarantee)} />
        <Meta label="Scheduled start" value={fmtDateTime(t.scheduledStartTime)} />
        <Meta label="Entries" value={t.entryCount} />
        <Meta label="Remaining" value={t.remainingPlayerCount} />
        <Meta label="Prize pool" value={formatMoney(t.totalPrizePool)} />
      </div>
    </div>
  )
}

function Meta({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-mono uppercase tracking-widest text-white/30">{label}</span>
      <span className="text-sm text-white/80 tabular-nums">{value}</span>
    </div>
  )
}

function SaveBar({ onSave, saving, label }) {
  return (
    <div className="flex items-center gap-3 mt-6">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={
          'px-4 py-2 rounded-lg text-sm font-medium ' +
          (saving ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-gold-500/20 text-gold-200 hover:bg-gold-500/30')
        }
      >
        {saving ? 'Saving…' : label}
      </button>
    </div>
  )
}

function PlayersTab({ t }) {
  return (
    <div className="space-y-4">
      <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
        <Meta label="Entries" value={t.entryCount} />
        <Meta label="Unique players" value={t.uniquePlayerCount} />
        <Meta label="Remaining" value={t.remainingPlayerCount} />
      </div>
      <EmptyState
        title="Player list coming in Phase 3."
        body="Registration, the entries list, seating, and the cashier's Register player action attach to this tab in Phase 3."
      />
    </div>
  )
}

function PayoutsTab({ t }) {
  const p = t.payoutStructure
  const byPercent = p.type === 'byPercent'
  return (
    <div className="space-y-4">
      <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
        <Meta label="Type" value={byPercent ? 'By percent' : 'By place'} />
        <Meta label="Rounding" value={p.rounding} />
        <Meta label="Paid places" value={p.positions.length} />
      </div>
      <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
            <tr>
              <th className="text-left px-4 py-2">Place</th>
              <th className="text-right px-4 py-2">{byPercent ? 'Percent' : 'Payout'}</th>
            </tr>
          </thead>
          <tbody>
            {p.positions.map((pos) => (
              <tr key={pos.place} className="border-t border-white/5">
                <td className="px-4 py-2 text-white/80 tabular-nums">{pos.place}</td>
                <td className="px-4 py-2 text-right text-white/80 tabular-nums">
                  {byPercent ? `${(pos.percent * 100).toFixed(1)}%` : formatMoney(pos.payout)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EmptyState title="Payout editor coming in task 2.3." body="For now this is a read-only view of the current payout structure." />
    </div>
  )
}
