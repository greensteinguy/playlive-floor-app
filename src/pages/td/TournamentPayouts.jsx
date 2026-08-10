// Per-tournament payouts screen — tasks 4.4 (calculator) / 4.5 (deal-making) /
// 4.7 (cashier-confirmed win credits), plus the winner half of the results spine.
//
// Three layers on one screen:
//   1. Results spine — the finishing order comes from entries (finishingPlace,
//      assigned by bust-outs); the WINNER is recorded here (the only way 1st
//      place is ever assigned — a bust never does it).
//   2. The payout table — the tournament's payoutStructure materialized against
//      the actual prize pool (buildPayoutRows / materializePayouts), joined to
//      the finishing order. "Enter deal / adjust payouts" makes the amounts
//      editable (alive players included) and stages the agreed table by setting
//      each entry's cashWinnings (enterDeal — audited as tournament.dealEntered).
//   3. Per-row cashier confirms — each payable row is individually confirmed
//      (cashier + manager), crediting the wallet + marking the entry paid in one
//      transaction (confirmEntryWinCredit). No bulk auto-credit, per the SOW.
//
// Role gating: the screen is manager + TD + cashier (route-gated). Staging
// actions (record winner / undo / deal) are manager + TD; the money confirms
// are cashier + manager (also enforced inside the wallet op).
//
// Bounty rows (mystery bounty) confirm per DRAW via confirmBountyWinCredit
// (idempotent on the draw's walletTransactionId). Satellite ticket rows confirm
// per ENTRY via confirmEntryTicketWin (idempotent on the entry's
// ticketIssuedAt) — the confirm IS the wallet-side ticket issuance.

import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useTournament } from '../../hooks/useTournament'
import { useEntries } from '../../hooks/useEntries'
import { usePlayers } from '../../hooks/usePlayers'
import { bountyDraws as bountyDrawsApi, MockModeError } from '../../lib/firestore'
import {
  buildPayoutRows,
  payoutRowsTotal,
  aliveEntries,
  recordedWinner,
  recordWinner,
  revertWinner,
  enterDeal,
  refreshPayoutTable,
  updatePayoutConfig,
  PayoutsError,
  TournamentError,
} from '../../lib/tournaments'
import {
  confirmEntryWinCredit,
  confirmEntryTicketWin,
  confirmBountyWinCredit,
  WalletError,
} from '../../lib/wallet'
import { playerDisplayName } from '../../lib/players'
import { ordinal } from '../../lib/entryDisplay'
import { formatMoney, centsToStr, dollarsToCents } from '../../lib/money'
import { EmptyState } from '../../components/FormFields'
import StatusBadge from '../../components/StatusBadge'

function fmtTime(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

// px-4 py-2.5 = ~40px tall — these drive the wallet-crediting confirms, so they
// stay near the 44px iOS tap-target floor (iPad pass 2026-08-10, finding B3)
const btnGold =
  'px-4 py-2.5 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 border border-gold-500/40 disabled:opacity-40'
const btnPlain =
  'px-4 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-white/70 hover:bg-white/10 border border-white/10 disabled:opacity-40'
const btnGreen =
  'px-4 py-2.5 rounded-lg text-sm font-medium bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 border border-emerald-500/30 disabled:opacity-40'

export default function TournamentPayouts() {
  const { id } = useParams()
  const { user, role } = useAuth()
  const toast = useToast()
  const { tournament, loading, error, mockMode, notFound, reload } = useTournament(id)
  const { entries, loading: entriesLoading, reload: reloadEntries } = useEntries(id)
  const players = usePlayers()

  const canStage = role === 'manager' || role === 'td' // winner + deal actions
  const canConfirm = role === 'manager' || role === 'cashier' // money confirms

  const nameById = useMemo(() => {
    const m = {}
    for (const p of players.players) m[p.id] = playerDisplayName(p)
    return m
  }, [players.players])
  const nameOf = (playerId) => nameById[playerId] ?? (playerId ? `${playerId.slice(0, 8)}…` : '—')

  const rows = useMemo(
    () => (tournament ? buildPayoutRows({ tournament, entries }) : []),
    [tournament, entries]
  )
  const alive = useMemo(() => aliveEntries(entries), [entries])
  const winner = useMemo(() => recordedWinner(entries), [entries])

  const refreshAll = () => {
    reload()
    reloadEntries()
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <Link to={`/td/tournaments/${id}`} className="text-sm text-white/65 hover:text-white mb-4 inline-block">
        ← Back to tournament
      </Link>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no tournament data available."
          body="Run npm run emulator + seed a tournament against the local Firestore emulator, then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load this tournament." body={error.message} tone="error" />
      ) : notFound ? (
        <EmptyState title="Tournament not found." body="This tournament may have been removed, or the link is out of date." />
      ) : loading || entriesLoading || !tournament ? (
        <div className="py-12 text-center text-white/55 text-sm">Loading…</div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h1 className="font-display text-2xl md:text-3xl text-gold-400">{tournament.name}</h1>
            <StatusBadge status={tournament.status} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Payouts</span>
          </div>
          <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 flex flex-wrap gap-x-8 gap-y-3 mb-5">
            <Meta label="Prize pool" value={formatMoney(tournament.totalPrizePool)} />
            <Meta label="Entries" value={tournament.entryCount} />
            <Meta label="Remaining" value={tournament.remainingPlayerCount} />
            <Meta label="Payable total" value={formatMoney(payoutRowsTotal(rows))} />
          </div>

          <PayoutEngineCard
            tournament={tournament}
            canStage={canStage}
            user={user}
            role={role}
            toast={toast}
            onChanged={refreshAll}
          />

          <WinnerCard
            tournament={tournament}
            alive={alive}
            winner={winner}
            nameOf={nameOf}
            canStage={canStage}
            user={user}
            role={role}
            toast={toast}
            onChanged={refreshAll}
          />

          <PayoutTable
            tournament={tournament}
            rows={rows}
            nameOf={nameOf}
            canStage={canStage}
            canConfirm={canConfirm}
            user={user}
            role={role}
            toast={toast}
            onChanged={refreshAll}
          />

          {tournament.gameType === 'mysteryBounty' && (
            <BountySection
              tournament={tournament}
              entries={entries}
              nameOf={nameOf}
              canConfirm={canConfirm}
              user={user}
              role={role}
              toast={toast}
            />
          )}

          {tournament.gameType === 'satellite' && (
            <TicketSection
              tournament={tournament}
              entries={entries}
              nameOf={nameOf}
              canConfirm={canConfirm}
              user={user}
              role={role}
              toast={toast}
              onChanged={reloadEntries}
            />
          )}
        </>
      )}
    </div>
  )
}

/* ── Venue payout calculator (run-once engine, 10 Aug 2026) ────────────────
   The knobs + the STORED table the engine computed. Settings save + recompute
   in one transaction (updatePayoutConfig); "Recompute now" force-refreshes
   (the automatic path is throttled to ~5 min and freezes at late-reg close).
   The per-place confirm table below reads this same stored table via
   buildPayoutRows — one source of truth on the tournament doc. */

const RATIO_FLAG_META = {
  ok: { label: '1st/2nd ratio OK', cls: 'bg-emerald-500/15 text-emerald-300' },
  low: { label: '1st/2nd ratio LOW', cls: 'bg-red-500/15 text-red-300' },
  high: { label: '1st/2nd ratio HIGH', cls: 'bg-amber-500/15 text-amber-200' },
}

function PayoutEngineCard({ tournament, canStage, user, role, toast, onChanged }) {
  const cfg = tournament.payoutConfig
  const table = tournament.payoutTable
  const frozen = ['lateRegClosed', 'finished', 'cancelled'].includes(tournament.status)
  const stale = table && table.entryCountAtCompute !== tournament.entryCount
  const hasAddOn = Boolean(tournament.reentryConfig?.hasAddOn)

  // Form state re-seeds when the saved config changes (render-time adjust
  // pattern — no effect round-trip; same idiom as Display.jsx).
  const seedForm = () => ({
    spotsRatio: String(cfg.spotsRatio),
    minCashMultiplier: String(cfg.minCashMultiplier),
    seriesEvent: cfg.seriesEvent,
    addOnCount: String(cfg.addOnCount),
    equityRefunds: centsToStr(cfg.equityRefunds),
  })
  const cfgKey = JSON.stringify(cfg)
  const [form, setForm] = useState(seedForm)
  const [seededFrom, setSeededFrom] = useState(cfgKey)
  if (seededFrom !== cfgKey) {
    setSeededFrom(cfgKey)
    setForm(seedForm())
  }
  const [busy, setBusy] = useState(false)

  const dirty =
    Number(form.spotsRatio) !== cfg.spotsRatio ||
    Number(form.minCashMultiplier) !== cfg.minCashMultiplier ||
    form.seriesEvent !== cfg.seriesEvent ||
    Number(form.addOnCount) !== cfg.addOnCount ||
    dollarsToCents(form.equityRefunds) !== cfg.equityRefunds

  const run = async (fn, okMsg) => {
    setBusy(true)
    try {
      await fn()
      toast.success(okMsg)
      onChanged()
    } catch (e) {
      toast.error(e instanceof TournamentError || e instanceof PayoutsError ? e.message : e?.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const saveAndRecompute = () =>
    run(
      () =>
        updatePayoutConfig({
          tournamentId: tournament.id,
          patch: {
            spotsRatio: Number(form.spotsRatio),
            minCashMultiplier: Number(form.minCashMultiplier),
            seriesEvent: form.seriesEvent,
            addOnCount: Number(form.addOnCount),
            equityRefunds: dollarsToCents(form.equityRefunds),
          },
          actorId: user?.uid,
          actorRole: role,
        }),
      'Payout settings saved — table recomputed.'
    )

  const recomputeNow = () =>
    run(
      () => refreshPayoutTable({ tournamentId: tournament.id, actorId: user?.uid, actorRole: role, force: true }),
      'Payout table recomputed.'
    )

  const inputCls =
    'bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm w-24 disabled:opacity-50'

  return (
    <section className="bg-felt-800 border border-white/5 rounded-lg px-4 py-4 mb-5">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h2 className="font-display text-lg text-gold-300">Venue payout calculator</h2>
        {table && table.ratioFlag && (
          <span className={'text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded ' + RATIO_FLAG_META[table.ratioFlag].cls}>
            {RATIO_FLAG_META[table.ratioFlag].label}
          </span>
        )}
        {stale && (
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-500/15 text-amber-200">
            Stale — entries changed since compute
          </span>
        )}
        {frozen && (
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-sky-500/15 text-sky-300">
            Frozen ({tournament.status}) — recompute is manual
          </span>
        )}
      </div>

      {/* Knobs */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Spots paid (1 in X)</span>
          <input
            type="number"
            inputMode="numeric"
            min="2"
            max="50"
            value={form.spotsRatio}
            onChange={(e) => setForm((f) => ({ ...f, spotsRatio: e.target.value }))}
            disabled={!canStage || busy}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Min cash</span>
          <select
            value={form.minCashMultiplier}
            onChange={(e) => setForm((f) => ({ ...f, minCashMultiplier: e.target.value }))}
            disabled={!canStage || busy}
            className="bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="1.5">1.5×</option>
            <option value="1.75">1.75×</option>
            <option value="2">2×</option>
          </select>
        </label>
        {hasAddOn && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Add-ons sold</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={form.addOnCount}
              onChange={(e) => setForm((f) => ({ ...f, addOnCount: e.target.value }))}
              disabled={!canStage || busy}
              className={inputCls}
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Equity refunds ($)</span>
          <input
            type="text"
            inputMode="decimal"
            value={form.equityRefunds}
            onChange={(e) => setForm((f) => ({ ...f, equityRefunds: e.target.value }))}
            placeholder="0"
            disabled={!canStage || busy}
            className={inputCls}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.seriesEvent}
            onChange={(e) => setForm((f) => ({ ...f, seriesEvent: e.target.checked }))}
            disabled={!canStage || busy}
          />
          <span className="text-sm text-white/70">Series event (points)</span>
        </label>
        {canStage && (
          <div className="flex gap-3 pb-0.5">
            <button type="button" onClick={saveAndRecompute} disabled={busy || !dirty} className={btnGold}>
              {busy ? 'Working…' : 'Save & recompute'}
            </button>
            <button type="button" onClick={recomputeNow} disabled={busy || tournament.entryCount < 1} className={btnPlain}>
              Recompute now
            </button>
          </div>
        )}
      </div>

      {/* The stored table */}
      {!table ? (
        <p className="text-sm text-white/55">
          No payout table computed yet
          {tournament.entryCount < 1 ? ' — it computes automatically with the first entry.' : ' — press "Recompute now".'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-2 mb-3 text-sm text-white/70">
            <span>
              Places paid <span className="text-white/90 tabular-nums">{table.placesPaid}</span>
            </span>
            <span>
              Min cash <span className="text-white/90 tabular-nums">{formatMoney(table.minCash)}</span>
            </span>
            <span>
              Distributes <span className="text-white/90 tabular-nums">{formatMoney(table.adjPrizePool)}</span>
            </span>
            <span>
              Computed {fmtTime(table.computedAt)} at {table.entryCountAtCompute} entries
            </span>
          </div>
          {table.warnings.length > 0 && (
            <ul className="mb-3 text-xs text-amber-200/80 list-disc list-inside">
              {table.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-widest text-white/50">
                  <th className="text-left pr-8 pb-1">Place</th>
                  <th className="text-right pr-8 pb-1">Payout</th>
                  {table.seriesEvent && <th className="text-right pb-1">Points</th>}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.fromPlace} className="border-t border-white/5">
                    <td className="pr-8 py-1.5 text-white/70">
                      {r.fromPlace === r.toPlace ? ordinal(r.fromPlace) : `${r.fromPlace} – ${r.toPlace}`}
                    </td>
                    <td className="pr-8 py-1.5 text-right tabular-nums text-white/90">{formatMoney(r.amount)}</td>
                    {table.seriesEvent && (
                      <td className="py-1.5 text-right tabular-nums text-white/70">
                        {r.points == null ? '—' : Math.round(r.points * 100) / 100}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
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

// ── Results spine: the winner ────────────────────────────────────────────────

function WinnerCard({ tournament, alive, winner, nameOf, canStage, user, role, toast, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null) // 'record' | 'revert' | null

  async function run(fn, successMsg) {
    setBusy(true)
    try {
      await fn()
      toast.success(successMsg)
      setConfirming(null)
      onChanged()
    } catch (e) {
      toast.error(e instanceof PayoutsError ? e.message : `Failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const winnerLocked = winner && ((winner.cashWinnings ?? 0) > 0 || winner.winningsPaidAt != null)

  return (
    <section className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Winner</span>
          {winner ? (
            <span className="text-sm text-gold-300">
              🏆 {nameOf(winner.playerId)} <span className="text-white/55">— 1st place recorded</span>
            </span>
          ) : alive.length === 1 ? (
            <span className="text-sm text-white/80">
              {nameOf(alive[0].playerId)} is the last player standing.
            </span>
          ) : (
            <span className="text-sm text-white/55">
              {alive.length} players remain — the winner is recorded when one remains (busts assign every other place).
            </span>
          )}
        </div>

        {canStage && !winner && alive.length === 1 && (
          <button type="button" disabled={busy} onClick={() => setConfirming('record')} className={btnGold}>
            Record winner — 1st place
          </button>
        )}
        {canStage && winner && (
          <button
            type="button"
            disabled={busy || winnerLocked}
            title={winnerLocked ? 'Winnings are already recorded for the winner — undo those first.' : undefined}
            onClick={() => setConfirming('revert')}
            className={btnPlain}
          >
            Undo winner
          </button>
        )}
      </div>

      {confirming === 'record' && alive.length === 1 && (
        <ConfirmInline
          busy={busy}
          text={`Record ${nameOf(alive[0].playerId)} as the winner (1st place)?`}
          confirmLabel="Yes — record winner"
          onConfirm={() =>
            run(
              () => recordWinner({ tournament, actorId: user.uid, actorRole: role }),
              `${nameOf(alive[0].playerId)} recorded as the winner.`
            )
          }
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === 'revert' && winner && (
        <ConfirmInline
          busy={busy}
          text={`Undo ${nameOf(winner.playerId)}'s recorded win?`}
          confirmLabel="Yes — undo"
          onConfirm={() =>
            run(() => revertWinner({ tournament, actorId: user.uid, actorRole: role }), 'Winner reverted.')
          }
          onCancel={() => setConfirming(null)}
        />
      )}
    </section>
  )
}

function ConfirmInline({ busy, text, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="mt-3 flex items-center gap-3 text-sm flex-wrap border-t border-white/10 pt-3">
      <span className="text-white/70">{text}</span>
      <button type="button" disabled={busy} onClick={onConfirm} className={btnGold}>
        {busy ? 'Working…' : confirmLabel}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className={btnPlain}>
        Cancel
      </button>
    </div>
  )
}

// ── The payout table + deal mode + per-row confirms ─────────────────────────

function PayoutTable({ tournament, rows, nameOf, canStage, canConfirm, user, role, toast, onChanged }) {
  const [dealMode, setDealMode] = useState(false)
  const [amounts, setAmounts] = useState({}) // entryId → dollar string
  const [dealNotes, setDealNotes] = useState('')
  const [ackReason, setAckReason] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmEntryId, setConfirmEntryId] = useState(null)

  const prizePool = tournament.totalPrizePool
  // Rows a deal can (re)stage: entry-backed and not yet paid.
  const editableRows = rows.filter((r) => r.entryId && !r.isPaid)
  const lockedTotal = rows.filter((r) => r.isPaid).reduce((sum, r) => sum + r.payableAmount, 0)
  const editedCents = (r) => dollarsToCents(amounts[r.entryId] ?? '')
  const dealTotal = lockedTotal + editableRows.reduce((sum, r) => sum + editedCents(r), 0)
  const delta = dealTotal - prizePool
  const needsAck = delta !== 0
  const displayTotal = dealMode ? dealTotal : payoutRowsTotal(rows)
  const displayDelta = displayTotal - prizePool

  function startDeal() {
    const seeded = {}
    for (const r of editableRows) seeded[r.entryId] = centsToStr(r.payableAmount)
    setAmounts(seeded)
    setDealNotes('')
    setAckReason('')
    setReviewing(false)
    setDealMode(true)
  }

  async function saveDeal() {
    setBusy(true)
    try {
      const allocations = editableRows.map((r) => ({ entryId: r.entryId, amount: editedCents(r) }))
      const res = await enterDeal({
        tournament,
        allocations,
        notes: dealNotes.trim() === '' ? null : dealNotes.trim(),
        managerOverride: needsAck ? { reason: ackReason.trim() } : null,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(
        res.delta === 0
          ? 'Deal saved — amounts staged for cashier confirmation.'
          : `Deal saved with a ${formatMoney(Math.abs(res.delta))} ${res.delta > 0 ? 'over' : 'under'}-allocation (manager acknowledged).`
      )
      setDealMode(false)
      setReviewing(false)
      onChanged()
    } catch (e) {
      toast.error(e instanceof PayoutsError ? e.message : `Deal failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function confirmRow(row) {
    setBusy(true)
    try {
      const res = await confirmEntryWinCredit({
        tournamentId: tournament.id,
        entryId: row.entryId,
        amount: row.payableAmount,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(`Paid ${formatMoney(row.payableAmount)} to ${nameOf(row.playerId)} — wallet balance ${formatMoney(res.newBalance)}.`)
      setConfirmEntryId(null)
      onChanged()
    } catch (e) {
      toast.error(e instanceof WalletError ? e.message : `Payout failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55">
          Payouts — {tournament.payoutStructure.type === 'byPercent' ? 'percentage structure' : 'fixed amounts'}
          {tournament.payoutStructure.type === 'byPercent' && (
            <span className="text-white/40"> · rounding {tournament.payoutStructure.rounding === 'none' ? 'exact' : tournament.payoutStructure.rounding === 'nearest5' ? 'to $5' : 'to $10'}, residue to 1st</span>
          )}
        </h3>
        {canStage && !dealMode && (
          <button type="button" onClick={startDeal} disabled={editableRows.length === 0} className={btnPlain}>
            Enter deal / adjust payouts
          </button>
        )}
        {dealMode && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDealMode(false)
              setReviewing(false)
            }}
            className={btnPlain}
          >
            Cancel deal
          </button>
        )}
      </div>

      <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/55">
            <tr>
              <th className="text-left px-4 py-2 w-16">Place</th>
              <th className="text-left px-4 py-2">Player</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">Calculated</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">{dealMode ? 'Deal amount' : 'Payable'}</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Status</th>
              {!dealMode && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-white/55">
                  No paid places configured — set up the payout structure on the tournament's Payouts tab.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.entryId ?? `place-${r.place ?? i}`} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-mono text-gold-300/90 tabular-nums">
                    {r.place != null ? ordinal(r.place) : <span className="text-white/55">in play</span>}
                  </td>
                  <td className="px-4 py-2.5 text-white/90">
                    {r.entryId ? nameOf(r.playerId) : <span className="text-white/45">— not decided —</span>}
                    {r.alive && r.place == null && <span className="ml-2 text-[10px] text-emerald-300/70 uppercase">alive</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-white/65 tabular-nums whitespace-nowrap">
                    {formatMoney(r.calculatedAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {dealMode && r.entryId && !r.isPaid ? (
                      <span className="relative inline-block w-28">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/45 text-sm pointer-events-none">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amounts[r.entryId] ?? ''}
                          onChange={(e) => setAmounts((m) => ({ ...m, [r.entryId]: e.target.value }))}
                          disabled={busy}
                          className="w-full bg-felt-900 border border-white/10 rounded pl-5 pr-2 py-1 text-sm text-right disabled:opacity-50"
                        />
                      </span>
                    ) : (
                      <span className={r.isAdjusted ? 'text-amber-300' : 'text-white/80'}>
                        {formatMoney(r.payableAmount)}
                        {r.isAdjusted && <span className="ml-1 text-[10px] uppercase text-amber-300/70">deal</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-white/70 whitespace-nowrap">
                    {r.isPaid ? (
                      <span className="text-emerald-300">Paid ✓ <span className="text-white/45 text-xs">{fmtTime(r.entry.winningsPaidAt)}</span></span>
                    ) : r.isStaged ? (
                      'Staged'
                    ) : r.entryId ? (
                      'Unpaid'
                    ) : (
                      '—'
                    )}
                  </td>
                  {!dealMode && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {canConfirm && r.entryId && !r.isPaid && r.payableAmount > 0 && (
                        confirmEntryId === r.entryId ? (
                          <span className="inline-flex items-center gap-3">
                            <span className="text-[11px] text-white/65">
                              Credit {formatMoney(r.payableAmount)} to {nameOf(r.playerId)}'s wallet?
                            </span>
                            <button type="button" disabled={busy} onClick={() => confirmRow(r)} className={btnGreen}>
                              {busy ? 'Paying…' : 'Yes — credit wallet'}
                            </button>
                            <button type="button" disabled={busy} onClick={() => setConfirmEntryId(null)} className={btnPlain}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => setConfirmEntryId(r.entryId)} className={btnGreen}>
                            Confirm payout
                          </button>
                        )
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t border-white/10">
            <tr className="text-[11px]">
              <td className="px-4 py-2 font-mono uppercase tracking-widest text-white/55" colSpan={3}>
                Total {dealMode ? '(deal)' : ''}
              </td>
              <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                <span className={displayDelta === 0 ? 'text-emerald-300' : 'text-amber-300'}>
                  {formatMoney(displayTotal)}
                </span>
                <span className="text-white/55"> / {formatMoney(prizePool)} pool</span>
              </td>
              <td colSpan={2} className="px-4 py-2 text-white/55">
                {displayDelta !== 0 && (
                  <span className="text-amber-300">
                    {displayDelta > 0 ? '+' : '−'}{formatMoney(Math.abs(displayDelta))} vs pool
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!canConfirm && !dealMode && (
        <p className="text-[11px] text-white/55 mt-2">
          Payout confirmation is a cashier / manager action — each row is confirmed individually before the wallet is credited.
        </p>
      )}

      {dealMode && (
        <div className="bg-felt-800 border border-white/5 rounded-lg p-4 mt-3 space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Deal notes (what was agreed, and why)</span>
            <input
              value={dealNotes}
              onChange={(e) => setDealNotes(e.target.value)}
              placeholder="e.g. 3-way ICM chop, $200 left for 1st"
              disabled={busy}
              className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
            />
          </label>

          {needsAck && (
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">
              <p className="text-[11px] text-amber-300/90 mb-2">
                The deal total is {delta > 0 ? 'over' : 'under'} the prize pool by {formatMoney(Math.abs(delta))}. Deals can
                deviate, but a <strong>manager</strong> must acknowledge the difference with a reason (recorded in the audit log).
              </p>
              <input
                value={ackReason}
                onChange={(e) => setAckReason(e.target.value)}
                placeholder={role === 'manager' ? 'Reason for the difference…' : 'Ask a manager to enter and acknowledge this deal.'}
                disabled={busy || role !== 'manager'}
                className="w-full bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
              />
            </div>
          )}

          {!reviewing ? (
            <button
              type="button"
              disabled={busy || (needsAck && (role !== 'manager' || ackReason.trim() === ''))}
              onClick={() => setReviewing(true)}
              className={btnGold}
            >
              Review deal…
            </button>
          ) : (
            <div className="border-t border-white/10 pt-3">
              <p className="text-sm text-white/80 mb-2">
                Stage these amounts? Total <strong>{formatMoney(dealTotal)}</strong> vs pool {formatMoney(prizePool)}
                {delta !== 0 && (
                  <span className="text-amber-300"> ({delta > 0 ? '+' : '−'}{formatMoney(Math.abs(delta))})</span>
                )}
                . Each player still needs a cashier confirmation before their wallet is credited.
              </p>
              <ul className="text-xs text-white/70 mb-3 space-y-0.5">
                {editableRows.map((r) => (
                  <li key={r.entryId}>
                    {nameOf(r.playerId)}{r.place != null ? ` (${ordinal(r.place)})` : ' (in play)'} — {formatMoney(editedCents(r))}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={saveDeal} className={btnGold}>
                  {busy ? 'Saving…' : 'Confirm deal'}
                </button>
                <button type="button" disabled={busy} onClick={() => setReviewing(false)} className={btnPlain}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ── Mystery bounty confirms (per draw) ───────────────────────────────────────

function BountySection({ tournament, entries, nameOf, canConfirm, user, role, toast }) {
  const [draws, setDraws] = useState([])
  const [drawsLoading, setDrawsLoading] = useState(true)
  const [drawsError, setDrawsError] = useState(null)
  const [confirmDrawId, setConfirmDrawId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // One-shot fetch per tournament/reload. drawsLoading starts true and is only
  // cleared async (no sync setState in the effect body — react-hooks rule); a
  // reload keeps showing the stale table until the fresh list lands.
  useEffect(() => {
    let cancelled = false
    bountyDrawsApi
      .listBountyDraws(tournament.id)
      .then((rows) => {
        if (cancelled) return
        setDraws(rows.sort((a, b) => (a.drawnAt?.toMillis?.() ?? 0) - (b.drawnAt?.toMillis?.() ?? 0)))
        setDrawsError(null)
        setDrawsLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setDrawsError(e instanceof MockModeError ? null : e)
        setDraws([])
        setDrawsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tournament.id, reloadKey])

  const entryById = useMemo(() => Object.fromEntries(entries.map((e) => [e.id, e])), [entries])
  const knockerPlayerId = (draw) => entryById[draw.knockerEntryId]?.playerId ?? null

  async function confirmDraw(draw) {
    const playerId = knockerPlayerId(draw)
    if (!playerId) {
      toast.error("Couldn't resolve the knocker's player for this draw.")
      return
    }
    setBusy(true)
    try {
      await confirmBountyWinCredit({
        tournamentId: tournament.id,
        drawId: draw.id,
        playerId,
        amount: draw.bountyValue,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(`Bounty ${formatMoney(draw.bountyValue)} credited to ${nameOf(playerId)}.`)
      setConfirmDrawId(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast.error(e instanceof WalletError ? e.message : `Bounty payout failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">
        Mystery bounties — cashier confirms each draw
      </h3>
      <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
        {drawsLoading ? (
          <div className="py-6 text-center text-white/55 text-sm">Loading draws…</div>
        ) : drawsError ? (
          <div className="py-6 text-center text-red-300/80 text-sm">Couldn't load bounty draws: {drawsError.message}</div>
        ) : draws.length === 0 ? (
          <div className="py-6 text-center text-white/55 text-sm">No bounties drawn yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/55">
              <tr>
                <th className="text-left px-4 py-2">Drawn</th>
                <th className="text-left px-4 py-2">Winner (knocker)</th>
                <th className="text-right px-4 py-2 whitespace-nowrap">Bounty</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {draws.map((d) => (
                <tr key={d.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white/65 whitespace-nowrap">{fmtTime(d.drawnAt)}</td>
                  <td className="px-4 py-2.5 text-white/90">{nameOf(knockerPlayerId(d))}</td>
                  <td className="px-4 py-2.5 text-right text-white/80 tabular-nums whitespace-nowrap">
                    {formatMoney(d.bountyValue)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {d.walletTransactionId ? (
                      <span className="text-emerald-300">Paid ✓</span>
                    ) : (
                      <span className="text-white/65">Unpaid</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {canConfirm && !d.walletTransactionId && (
                      confirmDrawId === d.id ? (
                        <span className="inline-flex items-center gap-3">
                          <span className="text-[11px] text-white/65">
                            Credit {formatMoney(d.bountyValue)} to {nameOf(knockerPlayerId(d))}?
                          </span>
                          <button type="button" disabled={busy} onClick={() => confirmDraw(d)} className={btnGreen}>
                            {busy ? 'Paying…' : 'Yes — credit wallet'}
                          </button>
                          <button type="button" disabled={busy} onClick={() => setConfirmDrawId(null)} className={btnPlain}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => setConfirmDrawId(d.id)} className={btnGreen}>
                          Confirm bounty
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

// ── Satellite tickets (cashier confirms each entry's ticket win) ─────────────

function TicketSection({ tournament, entries, nameOf, canConfirm, user, role, toast, onChanged }) {
  const [confirmEntryId, setConfirmEntryId] = useState(null)
  const [busy, setBusy] = useState(false)

  const ticketRows = entries.filter((e) => e.voidedAt === null && (e.ticketWinnings ?? 0) > 0)

  async function issueRow(e) {
    setBusy(true)
    try {
      await confirmEntryTicketWin({
        tournamentId: tournament.id,
        entryId: e.id,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(`${formatMoney(e.ticketWinnings)} ticket issued to ${nameOf(e.playerId)}.`)
      setConfirmEntryId(null)
      onChanged()
    } catch (err) {
      toast.error(err instanceof WalletError ? err.message : `Ticket issuance failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">
        Satellite tickets — cashier confirms each win
      </h3>
      <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3">
        {ticketRows.length === 0 ? (
          <p className="text-sm text-white/55">No ticket winnings recorded on entries yet.</p>
        ) : (
          <ul className="text-sm space-y-1.5">
            {ticketRows.map((e) => (
              <li key={e.id} className="flex items-center gap-3 flex-wrap">
                <span className="text-white/90">{nameOf(e.playerId)}</span>
                <span className="text-white/70 tabular-nums">{formatMoney(e.ticketWinnings)} ticket</span>
                {e.ticketIssuedAt != null ? (
                  <span className="ml-auto text-emerald-300">
                    Issued ✓ <span className="text-white/45 text-xs">{fmtTime(e.ticketIssuedAt)}</span>
                  </span>
                ) : canConfirm ? (
                  confirmEntryId === e.id ? (
                    <span className="ml-auto inline-flex items-center gap-3">
                      <span className="text-[11px] text-white/65">
                        Issue a {formatMoney(e.ticketWinnings)} ticket to {nameOf(e.playerId)}?
                      </span>
                      <button type="button" disabled={busy} onClick={() => issueRow(e)} className={btnGreen}>
                        {busy ? 'Issuing…' : 'Yes — issue ticket'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setConfirmEntryId(null)} className={btnPlain}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setConfirmEntryId(e.id)} className={btnGreen + ' ml-auto'}>
                      Issue ticket
                    </button>
                  )
                ) : (
                  <span className="ml-auto text-white/65">Unissued</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-white/55 mt-2">
          Issuing creates the wallet-side ticket and credits the player's ticket balance in one step — each win is
          confirmed individually by a cashier or manager.
        </p>
      </div>
    </section>
  )
}
