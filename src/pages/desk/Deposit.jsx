// Wallet deposit + PayID wizard (task 3.6). Records that money went INTO a
// player's wallet — cash to the till, EFTPOS settled, or a PayID transfer
// received. The money has already moved through the venue's own systems; this is
// the record-keeping write (recordDeposit → a `deposit` walletTransaction +
// the cached balance, atomically). See wallet-design.md §2.1.
//
// Player-first, with a confirm step: the cashier finds or quick-creates the
// player, enters the amount + method, then reviews and commits. Deep-linkable
// from a player's profile via ?playerId= (a "Record a deposit →" CTA there).
//
// PayID is a DEPOSIT-ONLY method (DECISIONS 27 May) — never a direct
// tournament-pay method, because a player can transfer more than any entry costs
// and the venue must credit the FULL received amount. The PayID branch is a
// guided wizard: show the venue's receiving PayID for the cashier to read out,
// then gate the record on an explicit "funds received" confirmation.
//
// Cashier + manager only (the route is role-gated).

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { usePlayers } from '../../hooks/usePlayers'
import { players as playersApi, ValidationError, WriteTimeoutError } from '../../lib/firestore'
import { createPlayer, searchPlayers, playerDisplayName, PlayerError } from '../../lib/players'
import { recordDeposit, WalletError } from '../../lib/wallet'
import { formatMoney, dollarsToCents } from '../../lib/money'
import { getVenuePayId } from '../../lib/venuePayId'
import { emptyPlayerForm, validatePlayerForm, buildPlayerArgs } from '../../lib/playerForm'
import { Money, Text, EmptyState } from '../../components/FormFields'
import PlayerProfileFields from '../../components/PlayerProfileFields'

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'eftpos', label: 'EFTPOS' },
  { id: 'payid', label: 'PayID' },
]
const methodLabel = (m) => METHODS.find((x) => x.id === m)?.label ?? m

// Surface the typed domain/wallet errors verbatim (they're written for staff);
// strip the wallet wrapper's "[wallet.opName]" prefix; generic fallback otherwise.
function friendlyError(e) {
  if (
    e instanceof WalletError ||
    e instanceof PlayerError ||
    e instanceof ValidationError ||
    e instanceof WriteTimeoutError
  ) {
    return e.message.replace(/^\[wallet\.[^\]]+\]\s*/, '')
  }
  return `Something went wrong: ${e.message}`
}

function Panel({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">{title}</h3>
      <div className="bg-felt-800 border border-white/5 rounded-lg p-4">{children}</div>
    </section>
  )
}

export default function Deposit() {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const toast = useToast()
  const players = usePlayers()
  const [searchParams] = useSearchParams()
  const preselectId = searchParams.get('playerId')
  const venuePayId = getVenuePayId()

  // Selection + form state
  const [q, setQ] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState(emptyPlayerForm)
  const [amountStr, setAmountStr] = useState('')
  const [method, setMethod] = useState(null)
  const [reference, setReference] = useState('')
  const [payidConfirmed, setPayidConfirmed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastDeposit, setLastDeposit] = useState(null)

  const amountCents = dollarsToCents(amountStr)
  const amountValid = amountCents > 0

  // Preselect a player when deep-linked from their profile (?playerId=…). Fetched
  // async so it never blocks the page; the set-state runs in the promise (not the
  // synchronous effect body). `prev ?? p` only fills an empty selection — so a
  // cashier who's already picked someone isn't clobbered, and it's correct under
  // StrictMode's mount→remount (a plain "once" ref guard would skip the remount).
  useEffect(() => {
    if (!preselectId) return undefined
    let cancelled = false
    playersApi
      .getPlayer(preselectId)
      .then((p) => {
        if (!cancelled && p) setSelectedPlayer((prev) => prev ?? p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [preselectId])

  const results = q.trim() ? searchPlayers(players.players, q, { limit: 8 }) : []

  function resetPayment() {
    setAmountStr('')
    setMethod(null)
    setReference('')
    setPayidConfirmed(false)
    setConfirming(false)
  }
  function selectPlayer(p) {
    setSelectedPlayer(p)
    resetPayment()
  }
  function resetForNext() {
    setSelectedPlayer(null)
    setQ('')
    setCreating(false)
    resetPayment()
  }
  function chooseMethod(m) {
    setMethod(m)
    setReference('')
    setPayidConfirmed(false)
    setConfirming(false)
  }
  function changeAmount(v) {
    setAmountStr(v)
    // A PayID receipt is confirmed for a specific amount — re-confirm if it changes.
    setPayidConfirmed(false)
    setConfirming(false)
  }

  async function handleCreatePlayer() {
    const err = validatePlayerForm(createForm)
    if (err) {
      toast.error(err)
      return
    }
    setBusy(true)
    try {
      const created = await createPlayer({ ...buildPlayerArgs(createForm), actorId: user.uid, actorRole: role })
      toast.success(`Created ${playerDisplayName(created)}.`)
      selectPlayer(created)
      setCreating(false)
      setCreateForm(emptyPlayerForm())
      players.reload()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  function depositReady() {
    if (!selectedPlayer || !amountValid || !method) return false
    if (method === 'payid' && !payidConfirmed) return false
    return true
  }

  async function doDeposit() {
    setBusy(true)
    try {
      const res = await recordDeposit({
        playerId: selectedPlayer.id,
        amount: amountCents,
        method,
        // Cash defaults to a "cash" marker; EFTPOS/PayID keep the entered ref (or null).
        reference: reference.trim() || (method === 'cash' ? 'cash' : null),
        actorId: user.uid,
        actorRole: role,
      })
      const name = playerDisplayName(selectedPlayer)
      toast.success(`Deposited ${formatMoney(amountCents)} to ${name} — balance ${formatMoney(res.newBalance)}.`)
      setLastDeposit({ name, playerId: selectedPlayer.id, amount: amountCents, method, newBalance: res.newBalance })
      resetForNext()
      players.reload()
    } catch (e) {
      toast.error(friendlyError(e))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-2xl">
      <button
        type="button"
        onClick={() => navigate('/desk')}
        className="text-sm text-white/50 hover:text-white mb-4"
      >
        ← Back to desk
      </button>

      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl md:text-4xl text-gold-400">Wallet deposit</h1>
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
            Phase 3 — task 3.6
          </span>
        </div>
        <p className="mt-2 text-sm text-white/50">
          Record cash, EFTPOS, or PayID added to a player's wallet. The money moves through the
          venue's own systems — this writes the ledger row.
        </p>
      </div>

      {players.mockMode ? (
        <EmptyState
          title="Mock mode — deposits need the emulator."
          body="Run npm run emulator + seed/create players against the local Firestore emulator, then reload."
        />
      ) : players.error ? (
        <EmptyState title="Couldn't load players." body={players.error.message} tone="error" />
      ) : lastDeposit ? (
        <div className="bg-felt-800 border border-emerald-500/30 rounded-lg p-6 text-center">
          <div className="text-emerald-300 text-xl font-display mb-1">✓ Deposit recorded</div>
          <p className="text-sm text-white/70">
            {formatMoney(lastDeposit.amount)} to <span className="text-white">{lastDeposit.name}</span> via{' '}
            {methodLabel(lastDeposit.method)}.
          </p>
          <p className="text-sm text-white/50 mt-1">
            New wallet balance:{' '}
            <span className="text-emerald-300 tabular-nums">{formatMoney(lastDeposit.newBalance)}</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <button
              type="button"
              onClick={() => setLastDeposit(null)}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40"
            >
              Record another deposit
            </button>
            <Link
              to={`/desk/players/${lastDeposit.playerId}`}
              className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
            >
              View {lastDeposit.name} →
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* ── 1 · Player ─────────────────────────────────────────────────── */}
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
                  onClick={resetForNext}
                  className="px-3 py-1.5 rounded text-xs bg-white/5 text-white/70 hover:bg-white/10"
                >
                  Change
                </button>
              </div>
            ) : creating ? (
              <>
                <PlayerProfileFields
                  form={createForm}
                  set={(p) => setCreateForm((f) => ({ ...f, ...p }))}
                  disabled={busy}
                />
                <div className="flex items-center justify-end gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    disabled={busy}
                    className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreatePlayer}
                    disabled={busy}
                    className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 disabled:opacity-40"
                  >
                    {busy ? 'Creating…' : 'Create & select'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search by name, phone, or email…"
                    autoFocus
                    aria-label="Search players"
                    className="flex-1 min-w-[14rem] bg-felt-900 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:text-white/30"
                  />
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="px-3 py-3 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25"
                  >
                    + New player
                  </button>
                </div>
                {q.trim() === '' ? (
                  <p className="text-xs text-white/40 mt-3">Start typing to find a player, or add a new one.</p>
                ) : results.length === 0 ? (
                  <p className="text-xs text-white/40 mt-3">No players match "{q}". Add them with + New player.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-white/5">
                    {results.map((p) => (
                      <li key={p.id} className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm text-white/90">{playerDisplayName(p)}</div>
                          <div className="text-xs text-white/40">
                            {p.phone}
                            {p.email ? ` · ${p.email}` : ''} · Wallet {formatMoney(p.walletBalance)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => selectPlayer(p)}
                          className="px-3 py-1.5 rounded text-xs bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                        >
                          Select →
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Panel>

          {selectedPlayer && (
            <>
              {/* ── 2 · Amount ───────────────────────────────────────────────── */}
              <Panel title="2 · Amount">
                <div className="max-w-[12rem]">
                  <Money label="Deposit amount" value={amountStr} onChange={changeAmount} disabled={busy} />
                </div>
                <p className="text-xs text-white/40 mt-2">
                  Current wallet balance {formatMoney(selectedPlayer.walletBalance)}
                  {amountValid && (
                    <>
                      {' '}
                      → new balance{' '}
                      <span className="text-emerald-300/80 tabular-nums">
                        {formatMoney(selectedPlayer.walletBalance + amountCents)}
                      </span>
                    </>
                  )}
                </p>
              </Panel>

              {/* ── 3 · Method ───────────────────────────────────────────────── */}
              <Panel title="3 · Method">
                <div className="flex flex-wrap gap-2">
                  {METHODS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => chooseMethod(m.id)}
                      className={
                        'px-4 py-2 rounded-lg text-sm font-medium ' +
                        (method === m.id
                          ? 'bg-gold-500/25 text-gold-200'
                          : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/90')
                      }
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {(method === 'cash' || method === 'eftpos') && (
                  <div className="mt-4">
                    <Text
                      label={method === 'eftpos' ? 'EFTPOS approval ref (optional)' : 'Reference (optional)'}
                      value={reference}
                      onChange={setReference}
                      placeholder={method === 'eftpos' ? 'Approval code' : 'e.g. till 1'}
                      disabled={busy}
                    />
                  </div>
                )}

                {method === 'payid' && (
                  <div className="mt-4 space-y-3">
                    {venuePayId.configured ? (
                      <div className="border border-gold-500/30 bg-gold-500/5 rounded-lg p-3">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-gold-300/70 mb-1">
                          Venue PayID — read this to the player
                        </div>
                        <div className="text-sm text-white/90">{venuePayId.payId}</div>
                        {venuePayId.accountName && (
                          <div className="text-xs text-white/50 mt-0.5">{venuePayId.accountName}</div>
                        )}
                      </div>
                    ) : (
                      <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 text-xs text-amber-200/80">
                        Venue PayID isn't configured for this build — give the player the venue's PayID from
                        your usual reference, then confirm receipt below. (Set <code>VITE_VENUE_PAYID</code> in{' '}
                        <code>.env.local</code> to show it here.)
                      </div>
                    )}
                    <p className="text-sm text-white/60">
                      Ask <span className="text-white/90">{playerDisplayName(selectedPlayer)}</span> to transfer{' '}
                      <span className="text-gold-300">{amountValid ? formatMoney(amountCents) : 'the amount'}</span>{' '}
                      to the venue PayID from their banking app, then confirm the funds have landed in the
                      venue account before recording the deposit.
                    </p>
                    <Text
                      label="PayID reference / transaction ID (recommended)"
                      value={reference}
                      onChange={setReference}
                      placeholder="the player's transfer reference"
                      disabled={busy}
                    />
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={payidConfirmed}
                        onChange={(e) => {
                          setPayidConfirmed(e.target.checked)
                          setConfirming(false)
                        }}
                        disabled={busy || !amountValid}
                        className="accent-gold-500 mt-0.5"
                      />
                      <span className={amountValid ? 'text-white/80' : 'text-white/40'}>
                        I've confirmed {amountValid ? formatMoney(amountCents) : 'the amount'} was received in
                        the venue account.
                      </span>
                    </label>
                  </div>
                )}
              </Panel>

              {/* ── Confirm ──────────────────────────────────────────────────── */}
              {amountValid && method && (
                <div className="bg-felt-800 border border-white/10 rounded-lg p-4">
                  {!confirming ? (
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        disabled={!depositReady() || busy}
                        className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40 disabled:opacity-40"
                      >
                        Review deposit →
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-white/80 mb-1">
                        Deposit <span className="text-gold-300">{formatMoney(amountCents)}</span> to{' '}
                        <span className="text-white">{playerDisplayName(selectedPlayer)}</span> via{' '}
                        {methodLabel(method)}.
                      </p>
                      <p className="text-sm text-white/50 mb-3">
                        New wallet balance will be {formatMoney(selectedPlayer.walletBalance + amountCents)}.
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
                          onClick={doDeposit}
                          disabled={!depositReady() || busy}
                          className="px-5 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 active:bg-emerald-500/40 disabled:opacity-40"
                        >
                          {busy ? 'Recording…' : 'Confirm & record deposit'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
