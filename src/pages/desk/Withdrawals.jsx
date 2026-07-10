// Withdrawal-request queue (task 4.8). The SOW-mandated two-step pattern:
// any cashier (or manager) CREATES a pending request — no wallet impact — and
// only a manager COMPLETES it, which is what atomically debits the wallet
// (completeWithdrawal writes the walletTransaction row + balance in one
// transaction). Either role can cancel a pending request, with a reason.
//
// The actual money movement (cash from the till, EFTPOS refund, bank transfer)
// happens through the venue's own systems — completing a request RECORDS that
// it happened; nothing here initiates a payment.
//
// Queue-first layout: pending requests float to the top, filter chips with
// counts (Pending / Completed / Cancelled / All — the tournament-list pattern),
// CSV export of the filtered view, and a "+ New withdrawal request" flow using
// the shared A3/A4 player picker. Deep-linkable from a player profile via
// ?playerId= (opens the create flow with that player preselected).
//
// Cashier + manager only (the route is role-gated); per-action roles are
// enforced again by the wallet ops themselves.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { usePlayers } from '../../hooks/usePlayers'
import { useWithdrawals } from '../../hooks/useWithdrawals'
import { players as playersApi, ValidationError, WriteTimeoutError } from '../../lib/firestore'
import { playerDisplayName } from '../../lib/players'
import {
  createWithdrawalRequest,
  completeWithdrawal,
  cancelWithdrawal,
  WalletError,
} from '../../lib/wallet'
import { formatMoney, dollarsToCents } from '../../lib/money'
import { downloadCsv, csvFilename } from '../../lib/csv'
import {
  WITHDRAWAL_FILTERS,
  withdrawalFilterMatch,
  countWithdrawalsByFilter,
  sortWithdrawals,
  payoutMethodLabel,
  withdrawalStateLabel,
  WITHDRAWAL_CSV_COLUMNS,
  buildWithdrawalCsvRows,
} from '../../lib/withdrawalQueue'
import { Money, Text, EmptyState } from '../../components/FormFields'
import PlayerPicker from '../../components/PlayerPicker'

const PAYOUT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'eftposRefund', label: 'EFTPOS refund' },
  { id: 'bankTransfer', label: 'Bank transfer' },
]

const STATE_BADGE_CLASSES = {
  pending: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-white/10 text-white/50',
}

// Surface the typed domain/wallet errors verbatim (they're written for staff);
// strip the wallet wrapper's "[wallet.opName]" prefix; generic fallback otherwise.
function friendlyError(e) {
  if (e instanceof WalletError || e instanceof ValidationError || e instanceof WriteTimeoutError) {
    return e.message.replace(/^\[wallet\.[^\]]+\]\s*/, '')
  }
  return `Something went wrong: ${e.message}`
}

function fmtDateTime(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  return d.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Panel({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">{title}</h3>
      <div className="bg-felt-800 border border-white/5 rounded-lg p-4">{children}</div>
    </section>
  )
}

export default function Withdrawals() {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const toast = useToast()
  const players = usePlayers()
  const queue = useWithdrawals()
  const [searchParams] = useSearchParams()
  const preselectId = searchParams.get('playerId')

  const isManager = role === 'manager'

  // ── Queue state ─────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState('pending')
  // Per-row inline confirm: { id, type: 'complete' | 'cancel' } or null.
  const [rowAction, setRowAction] = useState(null)
  const [externalRef, setExternalRef] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)

  // ── Create-flow state ───────────────────────────────────────────────────────
  const [creating, setCreating] = useState(Boolean(preselectId))
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [amountStr, setAmountStr] = useState('')
  const [payoutMethod, setPayoutMethod] = useState(null)
  const [confirming, setConfirming] = useState(false)

  // Preselect a player when deep-linked from their profile (?playerId=…). Same
  // pattern as the deposit page: fetched async, `prev ?? p` fills only an empty
  // selection (correct under StrictMode's mount→remount).
  useEffect(() => {
    if (!preselectId) return undefined
    let cancelled = false
    playersApi
      .getPlayer(preselectId)
      .then((p) => {
        if (!cancelled && p) {
          setSelectedPlayer((prev) => prev ?? p)
          setCreating(true)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [preselectId])

  // Player names/balances for the queue rows (fallback to the raw id while the
  // player base loads, or if the record was merged/archived).
  const playerById = useMemo(() => {
    const m = new Map()
    for (const p of players.players) m.set(p.id, p)
    return m
  }, [players.players])
  const nameOf = (playerId) => {
    const p = playerById.get(playerId)
    return p ? playerDisplayName(p) : ''
  }

  const counts = useMemo(() => countWithdrawalsByFilter(queue.withdrawals), [queue.withdrawals])
  const activeFilter = WITHDRAWAL_FILTERS.find((f) => f.id === filter) ?? WITHDRAWAL_FILTERS[0]
  const visible = useMemo(
    () => sortWithdrawals(queue.withdrawals.filter((r) => withdrawalFilterMatch(activeFilter, r.state))),
    [queue.withdrawals, activeFilter]
  )

  const amountCents = dollarsToCents(amountStr)
  const amountPositive = amountCents > 0
  // Friendly UI-level guard: don't let a request exceed the balance at creation
  // time. The HARD walletBalance ≥ 0 invariant fires again at completion.
  const exceedsBalance = selectedPlayer ? amountCents > selectedPlayer.walletBalance : false
  const amountValid = amountPositive && !exceedsBalance

  // ── Actions ─────────────────────────────────────────────────────────────────

  function startRowAction(id, type) {
    setRowAction({ id, type })
    setExternalRef('')
    setCancelReason('')
  }
  function clearRowAction() {
    setRowAction(null)
    setExternalRef('')
    setCancelReason('')
  }
  function resetCreateFlow() {
    setCreating(false)
    setSelectedPlayer(null)
    setAmountStr('')
    setPayoutMethod(null)
    setConfirming(false)
  }

  async function doCreate() {
    setBusy(true)
    try {
      await createWithdrawalRequest({
        playerId: selectedPlayer.id,
        amount: amountCents,
        payoutMethod,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(
        `Withdrawal request created — ${formatMoney(amountCents)} for ${playerDisplayName(selectedPlayer)}. ` +
          'A manager completes it once the money is paid out.'
      )
      resetCreateFlow()
      setFilter('pending')
      queue.reload()
    } catch (e) {
      toast.error(friendlyError(e))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  async function doComplete(request) {
    setBusy(true)
    try {
      const res = await completeWithdrawal({
        requestId: request.id,
        actorId: user.uid,
        actorRole: role,
        externalReference: externalRef.trim() || null,
      })
      const name = nameOf(request.playerId) || request.playerId
      toast.success(
        `Withdrawal completed — ${formatMoney(request.amount)} paid to ${name}. ` +
          `New wallet balance ${formatMoney(res.newBalance)}.`
      )
      clearRowAction()
      queue.reload()
      players.reload() // balance changed
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function doCancel(request) {
    setBusy(true)
    try {
      await cancelWithdrawal({
        requestId: request.id,
        actorId: user.uid,
        actorRole: role,
        cancelReason: cancelReason.trim(),
      })
      const name = nameOf(request.playerId) || request.playerId
      toast.success(`Withdrawal request for ${name} cancelled — no wallet impact.`)
      clearRowAction()
      queue.reload()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  function handleExport() {
    if (visible.length === 0) {
      toast.info('Nothing to export — no requests in this view.')
      return
    }
    const rows = buildWithdrawalCsvRows(visible, nameOf)
    downloadCsv(rows, WITHDRAWAL_CSV_COLUMNS, csvFilename('withdrawals'))
    toast.success(`Exported ${rows.length} request${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  const mockMode = queue.mockMode || players.mockMode
  const loadError = queue.error ?? players.error
  const loading = queue.loading || players.loading

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-5xl">
      <button
        type="button"
        onClick={() => navigate('/desk')}
        className="text-sm text-white/50 hover:text-white mb-4"
      >
        ← Back to desk
      </button>

      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl md:text-4xl text-gold-400">Withdrawals</h1>
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
            Phase 4 — task 4.8
          </span>
        </div>
        <p className="mt-2 text-sm text-white/50">
          Two-step pattern: the desk creates a pending request; a manager completes it once the money
          has been paid out through the venue's own systems. Completing is what debits the wallet.
        </p>
      </div>

      {mockMode ? (
        <EmptyState
          title="Mock mode — withdrawals need the emulator."
          body="Run npm run emulator + seed/create players against the local Firestore emulator, then reload."
        />
      ) : loadError ? (
        <EmptyState title="Couldn't load the withdrawal queue." body={loadError.message} tone="error" />
      ) : loading ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : creating ? (
        <CreateFlow
          players={players}
          selectedPlayer={selectedPlayer}
          onSelect={(p) => {
            setSelectedPlayer(p)
            setConfirming(false)
          }}
          onChangePlayer={() => {
            setSelectedPlayer(null)
            setConfirming(false)
          }}
          amountStr={amountStr}
          onChangeAmount={(v) => {
            setAmountStr(v)
            setConfirming(false)
          }}
          amountCents={amountCents}
          amountPositive={amountPositive}
          amountValid={amountValid}
          exceedsBalance={exceedsBalance}
          payoutMethod={payoutMethod}
          onChooseMethod={(m) => {
            setPayoutMethod(m)
            setConfirming(false)
          }}
          confirming={confirming}
          setConfirming={setConfirming}
          busy={busy}
          onCreate={doCreate}
          onExit={resetCreateFlow}
        />
      ) : (
        <>
          {/* Filter chips + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {WITHDRAWAL_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={
                    'px-3 py-1.5 rounded-full text-xs font-medium ' +
                    (filter === f.id
                      ? 'bg-gold-500/20 text-gold-300'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80')
                  }
                >
                  {f.label}
                  <span className="ml-1.5 text-white/30">{counts[f.id]}</span>
                </button>
              ))}
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
                onClick={() => setCreating(true)}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35"
              >
                + New withdrawal request
              </button>
            </div>
          </div>

          {queue.withdrawals.length === 0 ? (
            <EmptyState
              title="No withdrawal requests yet."
              body="Create one with + New withdrawal request — a manager completes it once the money is paid out."
            />
          ) : visible.length === 0 ? (
            <EmptyState title="No requests match this filter." body="Try a different filter above." />
          ) : (
            <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
                  <tr>
                    <th className="text-left px-4 py-2">Player</th>
                    <th className="text-right px-4 py-2 whitespace-nowrap">Amount</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Method</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Requested by</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Requested</th>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Status</th>
                    <th className="text-right px-4 py-2 whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <QueueRow
                      key={r.id}
                      request={r}
                      player={playerById.get(r.playerId)}
                      isManager={isManager}
                      busy={busy}
                      action={rowAction?.id === r.id ? rowAction.type : null}
                      onStartAction={(type) => startRowAction(r.id, type)}
                      onClearAction={clearRowAction}
                      externalRef={externalRef}
                      setExternalRef={setExternalRef}
                      cancelReason={cancelReason}
                      setCancelReason={setCancelReason}
                      onComplete={() => doComplete(r)}
                      onCancel={() => doCancel(r)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-white/30 mt-4">
            Creating a request does not touch the wallet. Completing (manager-only) records that the
            money was paid out and debits the wallet in the same transaction. Cancelling a pending
            request has no wallet impact.
          </p>
        </>
      )}
    </div>
  )
}

// ── Queue row (+ inline confirm) ─────────────────────────────────────────────

function QueueRow({
  request,
  player,
  isManager,
  busy,
  action,
  onStartAction,
  onClearAction,
  externalRef,
  setExternalRef,
  cancelReason,
  setCancelReason,
  onComplete,
  onCancel,
}) {
  const name = player ? playerDisplayName(player) : request.playerId
  const isPending = request.state === 'pending'
  const badgeClass = STATE_BADGE_CLASSES[request.state] ?? 'bg-white/10 text-white/60'
  // Completion enforces walletBalance ≥ 0 — surface the shortfall before the
  // manager reaches for the till.
  const shortfall = player ? request.amount - player.walletBalance : 0

  return (
    <>
      <tr className="border-t border-white/5">
        <td className="px-4 py-3">
          {player ? (
            <Link to={`/desk/players/${player.id}`} className="text-white/90 hover:text-white font-medium">
              {name}
            </Link>
          ) : (
            <span className="font-mono text-xs text-white/60" title={request.playerId}>
              {request.playerId}
            </span>
          )}
          {player && isPending && (
            <div className="text-xs text-white/40 mt-0.5">Wallet {formatMoney(player.walletBalance)}</div>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-white/90">
          {formatMoney(request.amount)}
          {isPending && player && shortfall > 0 && (
            <div className="text-[10px] text-amber-300/80 whitespace-nowrap">exceeds balance</div>
          )}
        </td>
        <td className="px-4 py-3 text-white/70 whitespace-nowrap">{payoutMethodLabel(request.payoutMethod)}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="font-mono text-xs text-white/60 truncate inline-block max-w-[9rem]" title={request.requestedBy}>
            {request.requestedBy}
          </span>
        </td>
        <td className="px-4 py-3 text-white/50 whitespace-nowrap">{fmtDateTime(request.requestedAt)}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${badgeClass}`}>
            {withdrawalStateLabel(request.state)}
          </span>
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          {isPending ? (
            <div className="inline-flex items-center gap-2">
              {isManager && (
                <button
                  type="button"
                  onClick={() => onStartAction('complete')}
                  disabled={busy}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 active:bg-emerald-500/35 disabled:opacity-40"
                >
                  Complete
                </button>
              )}
              <button
                type="button"
                onClick={() => onStartAction('cancel')}
                disabled={busy}
                className="px-3 py-1.5 rounded text-xs bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/90 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          ) : (
            <ResolvedNote request={request} />
          )}
        </td>
      </tr>

      {/* Inline confirm — expands beneath the row (audit-log expand pattern). */}
      {action === 'complete' && (
        <tr className="border-t border-white/5 bg-felt-900/40">
          <td colSpan={7} className="px-4 py-3">
            <p className="text-sm text-white/80 mb-1">
              Pay out <span className="text-gold-300">{formatMoney(request.amount)}</span> to{' '}
              <span className="text-white">{name}</span> via {payoutMethodLabel(request.payoutMethod)}.
            </p>
            <p className="text-sm text-white/50 mb-3">
              The money moves through the venue's own systems (till, EFTPOS, bank transfer) —
              completing records that it happened and debits the wallet
              {player && (
                <>
                  {' '}
                  (balance {formatMoney(player.walletBalance)} →{' '}
                  <span className="tabular-nums">{formatMoney(player.walletBalance - request.amount)}</span>)
                </>
              )}
              .
            </p>
            {player && shortfall > 0 && (
              <p className="text-xs text-amber-300/90 mb-3">
                This request exceeds the current wallet balance by {formatMoney(shortfall)} — completion
                will be refused. Cancel it and create a smaller request.
              </p>
            )}
            <div className="max-w-sm mb-3">
              <Text
                label="External reference (optional)"
                value={externalRef}
                onChange={setExternalRef}
                placeholder="bank transfer ref / EFTPOS approval / till"
                disabled={busy}
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClearAction}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onComplete}
                disabled={busy}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 active:bg-emerald-500/40 disabled:opacity-40"
              >
                {busy ? 'Completing…' : 'Confirm — money paid out'}
              </button>
            </div>
          </td>
        </tr>
      )}

      {action === 'cancel' && (
        <tr className="border-t border-white/5 bg-felt-900/40">
          <td colSpan={7} className="px-4 py-3">
            <p className="text-sm text-white/80 mb-3">
              Cancel the <span className="text-gold-300">{formatMoney(request.amount)}</span> withdrawal
              request for <span className="text-white">{name}</span>? No wallet impact.
            </p>
            <div className="max-w-sm mb-3">
              <Text
                label="Reason (required)"
                value={cancelReason}
                onChange={setCancelReason}
                placeholder="e.g. player changed their mind"
                disabled={busy}
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClearAction}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy || cancelReason.trim() === ''}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 active:bg-rose-500/40 disabled:opacity-40"
              >
                {busy ? 'Cancelling…' : 'Confirm cancel'}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ResolvedNote({ request }) {
  if (request.state === 'completed') {
    return (
      <span className="text-xs text-white/40" title={request.externalReference ?? undefined}>
        {fmtDateTime(request.completedAt)}
        {request.externalReference ? ` · ${request.externalReference}` : ''}
      </span>
    )
  }
  if (request.state === 'cancelled') {
    return (
      <span className="text-xs text-white/40" title={request.cancelReason ?? undefined}>
        {fmtDateTime(request.cancelledAt)}
        {request.cancelReason ? ` · ${request.cancelReason}` : ''}
      </span>
    )
  }
  return <span className="text-white/30">—</span>
}

// ── Create flow (player → amount → payout method → review) ───────────────────

function CreateFlow({
  players,
  selectedPlayer,
  onSelect,
  onChangePlayer,
  amountStr,
  onChangeAmount,
  amountCents,
  amountPositive,
  amountValid,
  exceedsBalance,
  payoutMethod,
  onChooseMethod,
  confirming,
  setConfirming,
  busy,
  onCreate,
  onExit,
}) {
  const ready = selectedPlayer && amountValid && payoutMethod
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-gold-400/70">
          New withdrawal request
        </h2>
        <button
          type="button"
          onClick={onExit}
          disabled={busy}
          className="px-3 py-1.5 rounded text-xs bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/90"
        >
          ← Back to queue
        </button>
      </div>

      {/* ── 1 · Player ─────────────────────────────────────────────────────── */}
      <Panel title="1 · Player">
        {selectedPlayer ? (
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-white/90 font-medium">{playerDisplayName(selectedPlayer)}</div>
              <div className="text-xs text-white/50 mt-0.5">
                {selectedPlayer.phone} · Wallet {formatMoney(selectedPlayer.walletBalance)} · Tickets{' '}
                {formatMoney(selectedPlayer.ticketBalance)}
              </div>
            </div>
            <button
              type="button"
              onClick={onChangePlayer}
              className="px-3 py-1.5 rounded text-xs bg-white/5 text-white/70 hover:bg-white/10"
            >
              Change
            </button>
          </div>
        ) : (
          <PlayerPicker players={players.players} onSelect={onSelect} />
        )}
      </Panel>

      {selectedPlayer && (
        <>
          {/* ── 2 · Amount ─────────────────────────────────────────────────── */}
          <Panel title="2 · Amount">
            <div className="max-w-[12rem]">
              <Money label="Withdrawal amount" value={amountStr} onChange={onChangeAmount} disabled={busy} />
            </div>
            <p className="text-xs text-white/40 mt-2">
              Current wallet balance {formatMoney(selectedPlayer.walletBalance)}
              {amountValid && (
                <>
                  {' '}
                  → balance after completion{' '}
                  <span className="text-emerald-300/80 tabular-nums">
                    {formatMoney(selectedPlayer.walletBalance - amountCents)}
                  </span>
                </>
              )}
            </p>
            {exceedsBalance && amountPositive && (
              <p className="text-xs text-amber-300/90 mt-1">
                A request can't exceed the wallet balance — the most{' '}
                {playerDisplayName(selectedPlayer)} can withdraw is{' '}
                {formatMoney(selectedPlayer.walletBalance)}.
              </p>
            )}
          </Panel>

          {/* ── 3 · Payout method ──────────────────────────────────────────── */}
          <Panel title="3 · Payout method">
            <div className="flex flex-wrap gap-2">
              {PAYOUT_METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChooseMethod(m.id)}
                  className={
                    'px-4 py-2 rounded-lg text-sm font-medium ' +
                    (payoutMethod === m.id
                      ? 'bg-gold-500/25 text-gold-200'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/90')
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/40 mt-3">
              How the venue will pay the player out. The payout reference (bank transfer ref, EFTPOS
              approval) is recorded by the manager at completion.
            </p>
          </Panel>

          {/* ── Confirm ────────────────────────────────────────────────────── */}
          {amountValid && payoutMethod && (
            <div className="bg-felt-800 border border-white/10 rounded-lg p-4">
              {!confirming ? (
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={!ready || busy}
                    className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40 disabled:opacity-40"
                  >
                    Review request →
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-white/80 mb-1">
                    Request a <span className="text-gold-300">{formatMoney(amountCents)}</span> withdrawal
                    for <span className="text-white">{playerDisplayName(selectedPlayer)}</span> via{' '}
                    {payoutMethodLabel(payoutMethod)}.
                  </p>
                  <p className="text-sm text-white/50 mb-3">
                    The wallet is not debited now — a manager completes the request once the money has
                    been paid out.
                  </p>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={onCreate}
                      disabled={!ready || busy}
                      className="px-5 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 active:bg-emerald-500/40 disabled:opacity-40"
                    >
                      {busy ? 'Creating…' : 'Confirm & create request'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
