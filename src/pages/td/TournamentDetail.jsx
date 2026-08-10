// Single tournament detail page (scaffold — Phase 2/3).
//
// A consistent top bar (name, status, key facts) sits above a four-tab body:
//   Details  — editable config (basics, money, schedule, re-entry, extras)
//   Structure — format flags + the blind structure editor
//   Players  — read-only counters for now; registration/seating land in Phase 3
//   Payouts  — payout-structure editor (type, rounding, per-place %/$ + auto-fill)
//
// Editing is gated to manager + TD (matches the Firestore write rules); cashier
// and read-only roles get a disabled, read-only view. Status is NOT edited here —
// it's live state owned by the clock + status-transition flow, so the top bar
// shows it as a badge only.
//
// Saves go through the SAFE updateTournament domain op (read-modify-write +
// full-schema re-validation), never the partial data-layer update. Each editable
// tab owns its own save scope: Details saves the config fields, Structure saves
// the format flags + blind levels (audited as tournament.structureEdited), and
// Payouts saves the payout structure (audited as tournament.payoutEdited). Form
// values are held as strings (so decimal entry isn't fought by re-renders) and
// converted at the save boundary, mirroring the create form.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useTournament } from '../../hooks/useTournament'
import { useStructureTemplates } from '../../hooks/useTemplates'
import {
  updateTournament,
  setTournamentStatus,
  registrationOpen,
  revertElimination,
  voidEntry,
  finishingOrder,
  TournamentError,
  SeatingError,
} from '../../lib/tournaments'
import { WalletError } from '../../lib/wallet'
import { Structure } from '../../lib/schema'
import { centsToStr, dollarsToCents, intOrNull, intOf, formatMoney } from '../../lib/money'
import { payoutCurve, paidPlaceCount, applyRounding } from '../../lib/payouts'
import { GAME_TYPES, GAME_TYPE_LABEL, REENTRY_TYPES } from '../../lib/gameTypes'
import { Section, Text, Money, Num, Select, Toggle, DateTime, BountyValues, EmptyState } from '../../components/FormFields'
import StructureEditor from '../../components/StructureEditor'
import StatusBadge from '../../components/StatusBadge'
import { ALL_STATUSES, defaultNextStatuses, statusLabel } from '../../lib/tournamentStatus'
import { useEntries } from '../../hooks/useEntries'
import { usePlayers } from '../../hooks/usePlayers'
import { playerDisplayName } from '../../lib/players'
import { paymentMethodLabel, entryTypeLabel, entryResultLabel, ordinal } from '../../lib/entryDisplay'
import { lastLongerDeckLabel } from '../../lib/tournaments'
import LastLongerPanel from '../../components/LastLongerPanel'
import { downloadCsv, csvFilename } from '../../lib/csv'

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
    lateRegCutoffLevel: t.lateRegCutoffLevel != null ? String(t.lateRegCutoffLevel) : '',
    reentryType: t.reentryConfig.type,
    maxReentries: t.reentryConfig.maxReentries != null ? String(t.reentryConfig.maxReentries) : '',
    maxRebuys: t.reentryConfig.maxRebuys != null ? String(t.reentryConfig.maxRebuys) : '',
    hasAddOn: t.reentryConfig.hasAddOn,
    addOnCost: t.reentryConfig.addOnCost != null ? centsToStr(t.reentryConfig.addOnCost) : '',
    addOnChips: t.reentryConfig.addOnChips != null ? String(t.reentryConfig.addOnChips) : '',
    ticketReward: centsToStr(t.satelliteConfig?.ticketReward ?? 0),
    bountyValues: (t.bountyPoolConfig?.bountyValues ?? []).map(centsToStr),
    // Payout structure (Payouts tab). place is derived from row order, so each
    // row holds only the editable strings. percentPaid is a transient auto-fill
    // input — it drives how many places get paid but isn't stored on the doc.
    payoutType: t.payoutStructure.type,
    payoutRounding: t.payoutStructure.rounding,
    payoutPercentPaid: '',
    payoutPositions: [...t.payoutStructure.positions]
      .sort((a, b) => a.place - b.place)
      .map((p) => ({
        payoutStr: centsToStr(p.payout),
        percentStr: p.percent != null ? pctToStr(p.percent) : '',
      })),
  }
}

// Stored percent fraction (0..1) ↔ editor percent string (e.g. 0.6667 ↔ "66.67").
// Quantised to 4 dp on the way in so the stored value matches the curve's
// precision (and round-trips cleanly).
function pctToStr(fraction) {
  return String(Math.round(fraction * 10000) / 100)
}
function pctStrToFraction(str) {
  const n = parseFloat(str)
  return Number.isNaN(n) ? 0 : Math.round((n / 100) * 10000) / 10000
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
    lateRegCutoffLevel: form.lateRegCutoffLevel === '' ? null : intOf(form.lateRegCutoffLevel),
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
  if (form.lateRegCutoffLevel !== '' && Number(form.lateRegCutoffLevel) > form.structure.filter((e) => e.type === 'level').length)
    return 'The late-reg cutoff level is beyond the blind structure.'
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

// Payouts tab → PayoutStructure patch. place is the 1-based row order; byPercent
// rows store percent (payout 0, cash computed at tournament end), byPlace rows
// store an absolute payout (percent null). Mirrors the schema's two flavours.
function buildPayoutPatch(form) {
  const byPercent = form.payoutType === 'byPercent'
  return {
    payoutStructure: {
      type: form.payoutType,
      rounding: form.payoutRounding,
      positions: form.payoutPositions.map((p, i) => ({
        place: i + 1,
        payout: byPercent ? 0 : dollarsToCents(p.payoutStr),
        percent: byPercent ? pctStrToFraction(p.percentStr) : null,
      })),
    },
  }
}

function validatePayouts(form) {
  const rows = form.payoutPositions
  if (rows.length < 1) return 'Add at least one paid place.'
  if (form.payoutType === 'byPercent') {
    const sum = rows.reduce((a, p) => a + (parseFloat(p.percentStr) || 0), 0)
    // The schema doesn't enforce sum===100% (cash conversion at tournament end
    // handles any remainder), but a structure that's well off 100% is a mistake.
    // Allow a small tolerance for repeating decimals (e.g. 33.3 × 3 = 99.9).
    if (Math.abs(sum - 100) > 0.5) return `Percentages must total 100% (currently ${sum.toFixed(1)}%).`
  } else if (rows.some((p) => dollarsToCents(p.payoutStr) <= 0)) {
    return 'Every paid place needs a payout greater than $0.'
  }
  return null
}

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
  const savePayouts = () =>
    save(buildPayoutPatch, validatePayouts, 'tournament.payoutEdited', () => 'Payout structure saved.')

  // Floor controls (task 2.7) — change the tournament's lifecycle status. The op
  // enforces the standard sequence + manager-override path; on success we reload
  // so the top bar badge reflects the new status.
  const [statusBusy, setStatusBusy] = useState(false)
  async function changeStatus(toStatus, override = null) {
    setStatusBusy(true)
    try {
      await setTournamentStatus({ id, toStatus, actorId: user.uid, actorRole: role, managerOverride: override })
      toast.success(`Status changed to ${statusLabel(toStatus)}.`)
      reload()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Status change failed: ${e.message}`)
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <button
        type="button"
        onClick={() => navigate('/td/tournaments')}
        className="text-sm text-white/65 hover:text-white mb-4"
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
        <div className="py-12 text-center text-white/55 text-sm">Loading…</div>
      ) : (
        <>
          <TopBar t={tournament} role={role} />

          {!canEdit && (
            <div className="bg-felt-800 border border-white/10 rounded-lg px-4 py-2 mb-5 text-xs text-white/65">
              Read-only access — ask a manager or TD to make changes.
            </div>
          )}

          {canEdit && (
            <StatusControls status={tournament.status} role={role} busy={statusBusy} onChange={changeStatus} />
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
                    : 'border-transparent text-white/65 hover:text-white/80')
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
                <Select label="Late-reg cutoff (optional)" value={form.lateRegCutoffLevel} onChange={(v) => set({ lateRegCutoffLevel: v })} options={lateRegLevelOptions(form.structure)} disabled={d} />
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
                    <p className="text-[11px] text-white/55 mt-2">Total bounty pool is the sum of the values above.</p>
                  </div>
                </Section>
              )}

              {canEdit && <SaveBar onSave={saveDetails} saving={saving} label="Save details" />}
            </>
          )}

          {tab === 'structure' && (
            <>
              <section className="mb-5">
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">Format</h3>
                <div className="bg-felt-800 border border-white/5 rounded-lg p-4 flex flex-col gap-2">
                  <Toggle label="Multi-day" checked={form.isMultiDay} onChange={setMultiDay} disabled={d} />
                  <Toggle label="Multi-flight" checked={form.isMultiFlight} onChange={setMultiFlight} disabled={d} hint="Implies multi-day" />
                  <Toggle label="Upper deck / main deck" checked={form.hasUpperDeckMainDeck} onChange={(v) => set({ hasUpperDeckMainDeck: v })} disabled={d} />
                </div>
              </section>

              <section className="mb-5">
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">Blind structure</h3>
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

          {tab === 'players' && <PlayersTab t={tournament} onChanged={reload} />}
          {tab === 'payouts' && (
            <>
              <PayoutEditor
                form={form}
                set={set}
                disabled={d}
                entryCount={tournament.entryCount}
                prizePool={tournament.totalPrizePool}
              />
              {canEdit && <SaveBar onSave={savePayouts} saving={saving} label="Save payouts" />}
            </>
          )}
        </>
      )}
    </div>
  )
}

// Floor controls (task 2.7): the standard next-status buttons (manager + TD),
// with a confirm for the significant finish/cancel steps, plus a manager-only
// override panel for non-standard transitions (reopen late reg, correct a
// mistake) that requires a reason. Presentational — calls onChange(toStatus,
// override?) which the page maps to setTournamentStatus.
function StatusControls({ status, role, busy, onChange }) {
  const isManager = role === 'manager'
  const nextStatuses = defaultNextStatuses(status)
  const [confirm, setConfirm] = useState(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideTo, setOverrideTo] = useState('')
  const [reason, setReason] = useState('')

  const significant = (s) => s === 'finished' || s === 'cancelled'
  const stepBtn =
    'text-xs px-3 py-1.5 rounded-lg border bg-white/5 text-white/80 hover:bg-white/10 border-white/10 disabled:opacity-40'
  const dangerBtn =
    'text-xs px-3 py-1.5 rounded-lg border bg-red-500/15 text-red-200 hover:bg-red-500/25 border-red-500/30 disabled:opacity-40'

  // Override targets exclude the current status and the standard next steps
  // (those have their own buttons).
  const overrideTargets = ALL_STATUSES.filter((s) => s !== status && !nextStatuses.includes(s))

  return (
    <section className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/55 mr-1">Floor controls</span>
          {nextStatuses.length === 0 ? (
            <span className="text-xs text-white/55">
              No standard next step — tournament is {statusLabel(status).toLowerCase()}.
            </span>
          ) : (
            nextStatuses.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => (significant(s) ? setConfirm(s) : onChange(s))}
                className={significant(s) ? dangerBtn : stepBtn}
              >
                → {statusLabel(s)}
              </button>
            ))
          )}
        </div>
        {isManager && overrideTargets.length > 0 && (
          <button
            type="button"
            onClick={() => setOverrideOpen((o) => !o)}
            className="text-xs text-white/65 hover:text-white"
          >
            {overrideOpen ? 'Close override' : 'Override status…'}
          </button>
        )}
      </div>

      {confirm && (
        <div className="mt-3 flex items-center gap-3 text-sm flex-wrap">
          <span className="text-white/70">
            Set status to <strong>{statusLabel(confirm)}</strong>?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const s = confirm
              setConfirm(null)
              onChange(s)
            }}
            className={dangerBtn}
          >
            Yes — {statusLabel(confirm)}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={stepBtn}>
            No
          </button>
        </div>
      )}

      {isManager && overrideOpen && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="text-[11px] text-amber-300/80 mb-2">
            Override the standard sequence (e.g. reopen late reg, correct a mistake). Recorded in the audit log with
            your reason.
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Set status to</span>
              <select
                value={overrideTo}
                onChange={(e) => setOverrideTo(e.target.value)}
                className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
              >
                <option value="">— choose —</option>
                {overrideTargets.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
              <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Reason</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why bypass the standard sequence?"
                className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={busy || !overrideTo || !reason.trim()}
              onClick={() => {
                onChange(overrideTo, { reason: reason.trim() })
                setOverrideOpen(false)
                setOverrideTo('')
                setReason('')
              }}
              className="text-xs px-3 py-1.5 rounded-lg border bg-gold-500/20 text-gold-100 hover:bg-gold-500/30 border-gold-500/40 disabled:opacity-40"
            >
              Apply override
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function TopBar({ t, role }) {
  const canRegister = role === 'manager' || role === 'cashier'
  const canManageTables = role === 'manager' || role === 'td'
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-2xl md:text-3xl text-gold-400">{t.name}</h1>
          <StatusBadge status={t.status} />
          {(t.isMultiDay || t.isMultiFlight) && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/45">
              {t.isMultiFlight ? 'multi-flight' : 'multi-day'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canRegister && registrationOpen(t) && (
            <Link
              to={`/td/tournaments/${t.id}/register`}
              className="text-xs font-medium text-emerald-200 hover:text-emerald-100 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap"
            >
              ＋ Register players
            </Link>
          )}
          <Link
            to={`/td/tournaments/${t.id}/clock`}
            className="text-xs font-medium text-gold-300 hover:text-gold-200 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap"
          >
            ▸ Open clock
          </Link>
          {canManageTables && (
            <Link
              to={`/td/tables?tournamentId=${t.id}`}
              className="text-xs font-medium text-gold-300 hover:text-gold-200 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap"
            >
              ⊞ Tables
            </Link>
          )}
          {(role === 'manager' || role === 'td' || role === 'cashier') && (
            <Link
              to={`/td/tournaments/${t.id}/payouts`}
              className="text-xs font-medium text-gold-300 hover:text-gold-200 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap"
            >
              ¤ Payouts
            </Link>
          )}
          <Link
            to={`/td/tournaments/${t.id}/results`}
            className="text-xs font-medium text-gold-300 hover:text-gold-200 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/30 rounded-lg px-3 py-1.5 whitespace-nowrap"
          >
            ≡ Results
          </Link>
        </div>
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
      <span className="text-[10px] font-mono uppercase tracking-widest text-white/45">{label}</span>
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
          (saving ? 'bg-white/5 text-white/45 cursor-not-allowed' : 'bg-gold-500/20 text-gold-200 hover:bg-gold-500/30')
        }
      >
        {saving ? 'Saving…' : label}
      </button>
    </div>
  )
}

function PlayersTab({ t, onChanged }) {
  const { user, role } = useAuth()
  const toast = useToast()
  const { entries, loading, error, mockMode, reload } = useEntries(t.id)
  const players = usePlayers()
  const canEdit = role === 'manager' || role === 'td'
  // Undo-elimination affordance: inline confirm per busted row (manager + TD).
  const [undoEntryId, setUndoEntryId] = useState(null)
  const [undoBusy, setUndoBusy] = useState(false)
  // Void-entry affordance: inline confirm + required reason per live row.
  // Cashiers can void too (they take the buy-ins); the op refuses once the
  // entry is busted or paid out.
  const canVoid = role === 'manager' || role === 'td' || role === 'cashier'
  const [voidEntryId, setVoidEntryId] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidBusy, setVoidBusy] = useState(false)
  const nameById = useMemo(() => {
    const m = {}
    for (const p of players.players) m[p.id] = playerDisplayName(p)
    return m
  }, [players.players])
  const rows = useMemo(
    () =>
      entries
        .filter((e) => e.voidedAt === null)
        .sort((a, b) => (a.registeredAt?.toMillis?.() ?? 0) - (b.registeredAt?.toMillis?.() ?? 0)),
    [entries]
  )
  // Busted entries deepest-finish-first for the finishing-order list.
  const busted = useMemo(() => finishingOrder(entries), [entries])
  const nameOf = (e) => nameById[e.playerId] ?? `${e.playerId.slice(0, 8)}…`

  async function handleUndoElimination(entry) {
    setUndoBusy(true)
    try {
      const res = await revertElimination({ tournament: t, entry, actorId: user.uid, actorRole: role })
      toast.success(
        `Undid ${nameOf(entry)}'s elimination${res.previousPlace ? ` (was ${ordinal(res.previousPlace)})` : ''} — they're back in, unseated.`
      )
      setUndoEntryId(null)
      reload()
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof SeatingError ? e.message : `Undo failed: ${e.message}`)
    } finally {
      setUndoBusy(false)
    }
  }

  // Plain-language summary of what the void refunded, per method.
  function refundSummary(refunds, ticketReinstatedId) {
    const parts = refunds.map((r) => {
      if (r.method === 'wallet') return `${formatMoney(r.amount)} credited back to their wallet`
      if (r.method === 'ticket') return 'their ticket reinstated'
      return `${formatMoney(r.amount)} to hand back by ${r.method === 'cash' ? 'cash from the till' : 'EFTPOS refund'}`
    })
    if (parts.length === 0 && ticketReinstatedId) parts.push('their ticket reinstated')
    return parts.join(' + ')
  }

  async function handleVoidEntry(entry) {
    const reason = voidReason.trim()
    if (!reason) {
      toast.error('A void reason is required — it goes on the ledger and the audit trail.')
      return
    }
    setVoidBusy(true)
    try {
      const res = await voidEntry({ tournament: t, entry, reason, actorId: user.uid, actorRole: role })
      const summary = res.alreadyVoided ? 'it was already voided' : refundSummary(res.refunds, res.ticketReinstatedId)
      toast.success(`Voided ${nameOf(entry)}'s entry #${entry.entryNumber}${summary ? ` — ${summary}.` : '.'}`)
      setVoidEntryId(null)
      setVoidReason('')
      reload()
      onChanged?.()
    } catch (e) {
      toast.error(
        e instanceof WalletError || e instanceof TournamentError ? e.message : `Void failed: ${e.message}`
      )
    } finally {
      setVoidBusy(false)
    }
  }

  function handleExport() {
    const data = rows.map((e) => ({
      player: nameOf(e),
      entry: `${entryTypeLabel(e.entryType)} #${e.entryNumber}`,
      paymentMethod: paymentMethodLabel(e.paymentMethod),
      paymentAmount: formatMoney(e.paymentAmount),
      status: entryResultLabel(e),
    }))
    downloadCsv(
      data,
      [
        { key: 'player', label: 'Player' },
        { key: 'entry', label: 'Entry' },
        { key: 'paymentMethod', label: 'Payment' },
        { key: 'paymentAmount', label: 'Amount' },
        { key: 'status', label: 'Status' },
      ],
      csvFilename(`entries-${t.name}`)
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
        <Meta label="Entries" value={t.entryCount} />
        <Meta label="Unique players" value={t.uniquePlayerCount} />
        <Meta label="Remaining" value={t.remainingPlayerCount} />
      </div>

      {mockMode ? (
        <EmptyState title="Mock mode — no entries available." body="Register players against the emulator to see the roster." />
      ) : error ? (
        <EmptyState title="Couldn't load the roster." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-8 text-center text-white/55 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No players registered yet."
          body={'Use "+ Register players" at the top to take the first buy-in.'}
        />
      ) : (
        <>
          {t.hasUpperDeckMainDeck && (
            <LastLongerPanel tournament={t} entries={entries} nameOf={nameOf} onChanged={reload} />
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleExport}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15"
            >
              Export CSV
            </button>
          </div>
          <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/55">
                <tr>
                  <th className="text-left px-4 py-2">Player</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">Entry</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">Payment</th>
                  <th className="text-right px-4 py-2 whitespace-nowrap">Amount</th>
                  <th className="text-left px-4 py-2 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t border-white/5">
                    <td className="px-4 py-2.5 text-white/90">
                      {nameOf(e)}
                      {t.hasUpperDeckMainDeck && e.lastLongerDeck && (
                        <span
                          className={
                            'ml-2 align-middle text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ' +
                            (e.isLastLongerWinner
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : e.lastLongerDeck === 'upper'
                                ? 'bg-sky-500/10 text-sky-300/80'
                                : 'bg-violet-500/10 text-violet-300/80')
                          }
                        >
                          {lastLongerDeckLabel(e.lastLongerDeck)}
                          {e.isLastLongerWinner ? ' · winner' : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-white/70 whitespace-nowrap">
                      {entryTypeLabel(e.entryType)} #{e.entryNumber}
                    </td>
                    <td className="px-4 py-2.5 text-white/70 whitespace-nowrap">{paymentMethodLabel(e.paymentMethod)}</td>
                    <td className="px-4 py-2.5 text-right text-white/70 tabular-nums whitespace-nowrap">
                      {formatMoney(e.paymentAmount)}
                    </td>
                    <td className="px-4 py-2.5 text-white/70 whitespace-nowrap">
                      {entryResultLabel(e)}
                      {canEdit &&
                        e.bustedAt !== null &&
                        (undoEntryId === e.id ? (
                          <span className="ml-2 inline-flex items-center gap-3">
                            <span className="text-[11px] text-white/65">Undo elimination?</span>
                            <button
                              type="button"
                              onClick={() => handleUndoElimination(e)}
                              disabled={undoBusy}
                              className="px-3 py-2 rounded text-xs font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 disabled:opacity-40"
                            >
                              {undoBusy ? 'Undoing…' : 'Yes, undo'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setUndoEntryId(null)}
                              disabled={undoBusy}
                              className="px-3 py-2 rounded text-xs text-white/70 hover:text-white hover:bg-white/5"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setUndoEntryId(e.id)}
                            disabled={undoBusy}
                            className="ml-2 px-3 py-2 rounded text-xs text-gold-300/80 hover:text-gold-200 bg-gold-500/10 hover:bg-gold-500/20 disabled:opacity-40"
                          >
                            undo
                          </button>
                        ))}
                      {canVoid &&
                        e.bustedAt === null &&
                        (voidEntryId === e.id ? (
                          <span className="ml-2 inline-flex items-center gap-3">
                            <input
                              type="text"
                              value={voidReason}
                              onChange={(ev) => setVoidReason(ev.target.value)}
                              placeholder="Reason (required)"
                              disabled={voidBusy}
                              autoFocus
                              className="w-44 px-3 py-2 rounded bg-felt-900 border border-white/10 text-xs text-white/90 placeholder-white/45 focus:outline-none focus:border-gold-500/40"
                            />
                            <button
                              type="button"
                              onClick={() => handleVoidEntry(e)}
                              disabled={voidBusy}
                              className="px-3 py-2 rounded text-xs font-medium bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 disabled:opacity-40"
                            >
                              {voidBusy ? 'Voiding…' : 'Void & refund'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVoidEntryId(null)
                                setVoidReason('')
                              }}
                              disabled={voidBusy}
                              className="px-3 py-2 rounded text-xs text-white/70 hover:text-white hover:bg-white/5"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setVoidEntryId(e.id)
                              setVoidReason('')
                            }}
                            disabled={voidBusy}
                            className="ml-2 px-3 py-2 rounded text-xs text-rose-300/70 hover:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40"
                          >
                            void
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Finishing order — busted entries deepest finish first (place · player ·
              bust time). Undoing an elimination leaves a gap here by design (v1:
              later finishers are not renumbered). */}
          {busted.length > 0 && (
            <section>
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">
                Finishing order — {busted.length} out
              </h3>
              <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3">
                <ul className="space-y-1 text-sm">
                  {busted.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-3">
                      <span className="w-10 text-right font-mono text-gold-300/90 tabular-nums shrink-0">
                        {e.finishingPlace != null ? ordinal(e.finishingPlace) : '—'}
                      </span>
                      <span className="text-white/90 truncate">{nameOf(e)}</span>
                      <span className="ml-auto text-xs text-white/55 whitespace-nowrap">{fmtDateTime(e.bustedAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

const ROUNDING_OPTIONS = [
  { value: 'nearest5', label: 'Nearest $5' },
  { value: 'nearest10', label: 'Nearest $10' },
  { value: 'none', label: 'Exact (to the cent)' },
]

// Payout-structure editor (task 2.3). Two flavours mirror the schema:
//   byPercent — each place gets a share of the prize pool; cash is computed at
//               the end with the rounding rule (the live "Cash (est.)" column is
//               a preview against the current pool).
//   byPlace   — each place gets a fixed cash amount, pool-independent.
// Auto-fill turns "% of field paid" into a paid-place count (entries × pct) and
// spreads a placeholder descending curve across those places — the venue's CSV
// algorithm replaces that curve later (see src/lib/payouts.js). place is the
// 1-based row order, so adding/removing rows just renumbers by position.
function PayoutEditor({ form, set, disabled, entryCount, prizePool }) {
  const byPercent = form.payoutType === 'byPercent'
  const rows = form.payoutPositions

  const setType = (type) => {
    if (type === form.payoutType) return
    // Switching to by-percent with no percents yet → seed the placeholder curve
    // so the structure is immediately valid and editable rather than all-blank.
    if (type === 'byPercent' && rows.every((p) => p.percentStr === '')) {
      const curve = payoutCurve(rows.length)
      set({ payoutType: type, payoutPositions: rows.map((p, i) => ({ ...p, percentStr: pctToStr(curve[i]) })) })
      return
    }
    set({ payoutType: type })
  }

  const setRow = (i, patch) =>
    set({ payoutPositions: rows.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) })
  const addRow = () => set({ payoutPositions: [...rows, { payoutStr: '', percentStr: '' }] })
  const removeRow = (i) => set({ payoutPositions: rows.filter((_, idx) => idx !== i) })

  const derivedPlaces = paidPlaceCount(entryCount, (parseFloat(form.payoutPercentPaid) || 0) / 100)
  const autoFill = () => {
    const count = derivedPlaces > 0 ? derivedPlaces : rows.length
    if (count < 1) return
    set({
      payoutType: 'byPercent',
      payoutPositions: payoutCurve(count).map((frac) => ({ payoutStr: '', percentStr: pctToStr(frac) })),
    })
  }

  const pctSum = rows.reduce((a, p) => a + (parseFloat(p.percentStr) || 0), 0)
  const pctOk = Math.abs(pctSum - 100) <= 0.5
  const cashFor = (p) => applyRounding(prizePool * ((parseFloat(p.percentStr) || 0) / 100), form.payoutRounding)
  const distributed = byPercent
    ? rows.reduce((a, p) => a + cashFor(p), 0)
    : rows.reduce((a, p) => a + dollarsToCents(p.payoutStr), 0)

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">Payout type</h3>
        <div className="bg-felt-800 border border-white/5 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Distribute by</span>
            <div className="flex gap-1">
              {[
                { id: 'byPercent', label: 'Percentage' },
                { id: 'byPlace', label: 'Fixed amount' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setType(opt.id)}
                  disabled={disabled}
                  className={
                    'px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 ' +
                    (form.payoutType === opt.id
                      ? 'bg-gold-500/20 text-gold-200'
                      : 'bg-white/5 text-white/70 hover:bg-white/10')
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <Select
            label="Rounding"
            value={form.payoutRounding}
            onChange={(v) => set({ payoutRounding: v })}
            options={ROUNDING_OPTIONS}
            disabled={disabled}
          />
        </div>
        <p className="text-[11px] text-white/55 mt-2">
          {byPercent
            ? 'Each place gets a share of the prize pool; cash is calculated at the end using the rounding rule.'
            : 'Each place gets a fixed cash amount, regardless of the final prize pool.'}
        </p>
      </section>

      <section>
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">Auto-fill</h3>
        <div className="bg-felt-800 border border-white/5 rounded-lg p-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">% of field paid</span>
            <div className="relative w-32">
              <input
                type="text"
                inputMode="decimal"
                value={form.payoutPercentPaid}
                onChange={(e) => set({ payoutPercentPaid: e.target.value })}
                placeholder="15"
                disabled={disabled}
                className="w-full bg-felt-900 border border-white/10 rounded pl-3 pr-7 py-2 text-sm disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 text-sm pointer-events-none">%</span>
            </div>
          </label>
          <button
            type="button"
            onClick={autoFill}
            disabled={disabled}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15 disabled:opacity-50"
          >
            Auto-fill places
          </button>
          <p className="text-[11px] text-white/55 flex-1 min-w-[12rem]">
            {derivedPlaces > 0
              ? `${entryCount} entries × ${form.payoutPercentPaid || 0}% → ${derivedPlaces} paid place${derivedPlaces === 1 ? '' : 's'}.`
              : entryCount > 0
                ? 'Enter a percentage to compute how many places get paid.'
                : 'No entries yet — auto-fill re-spreads the current places down the curve, or add places manually below.'}
            <span className="block text-white/40 mt-0.5">Uses a standard descending curve (venue payout CSV will replace this).</span>
          </p>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55">Paid places</h3>
          <button
            type="button"
            onClick={addRow}
            disabled={disabled}
            className="px-2 py-1 rounded text-[11px] bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40"
          >
            + Add place
          </button>
        </div>
        <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/55">
              <tr>
                <th className="text-left px-4 py-2 w-16">Place</th>
                <th className="text-left px-4 py-2">{byPercent ? 'Percent' : 'Payout'}</th>
                {byPercent && <th className="text-right px-4 py-2 whitespace-nowrap">Cash (est.)</th>}
                <th className="px-4 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-4 py-2 text-white/80 tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2">
                    {byPercent ? (
                      <div className="relative w-28">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={p.percentStr}
                          onChange={(e) => setRow(i, { percentStr: e.target.value })}
                          placeholder="0"
                          disabled={disabled}
                          className="w-full bg-felt-900 border border-white/10 rounded pl-3 pr-7 py-1.5 text-sm disabled:opacity-50"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 text-sm pointer-events-none">%</span>
                      </div>
                    ) : (
                      <div className="relative w-32">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45 text-sm pointer-events-none">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={p.payoutStr}
                          onChange={(e) => setRow(i, { payoutStr: e.target.value })}
                          placeholder="0.00"
                          disabled={disabled}
                          className="w-full bg-felt-900 border border-white/10 rounded pl-6 pr-3 py-1.5 text-sm disabled:opacity-50"
                        />
                      </div>
                    )}
                  </td>
                  {byPercent && (
                    <td className="px-4 py-2 text-right text-white/70 tabular-nums whitespace-nowrap">
                      {formatMoney(cashFor(p))}
                    </td>
                  )}
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      disabled={disabled || rows.length <= 1}
                      aria-label={`Remove place ${i + 1}`}
                      className="text-white/45 hover:text-red-300 disabled:opacity-30 disabled:hover:text-white/45"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-white/10">
              <tr className="text-[11px]">
                <td className="px-4 py-2 font-mono uppercase tracking-widest text-white/55">Total</td>
                <td className="px-4 py-2">
                  {byPercent ? (
                    <span className={'tabular-nums ' + (pctOk ? 'text-emerald-300' : 'text-amber-300')}>
                      {pctSum.toFixed(1)}% / 100%
                    </span>
                  ) : (
                    <span className="tabular-nums text-white/70">{formatMoney(distributed)}</span>
                  )}
                </td>
                {byPercent && (
                  <td className="px-4 py-2 text-right tabular-nums text-white/70 whitespace-nowrap">
                    {formatMoney(distributed)}
                  </td>
                )}
                <td className="px-4 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[11px] text-white/55 mt-2">
          {byPercent
            ? prizePool > 0
              ? `Distributing ${formatMoney(distributed)} of the ${formatMoney(prizePool)} prize pool (estimate — rounding is applied per place).`
              : 'Prize pool is $0.00 until players register; percentages are stored now and converted to cash at the end.'
            : `${formatMoney(distributed)} across ${rows.length} place${rows.length === 1 ? '' : 's'}.`}
        </p>
      </section>
    </div>
  )
}
