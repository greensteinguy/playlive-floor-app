// Tournament registration (task 3.4 + the ticket logic of 3.5). Tournament-first
// with an explicit confirm step (per the Phase-2 UX call): the cashier is already
// on a tournament, finds or quick-creates the player inline, picks the flight (for
// multi-flight) and the payment method, reviews, then commits.
//
// The commit calls the registerEntry orchestrator, which plans the entry
// (initial vs re-entry, with a duplicate guard) and delegates to the matching
// wallet op for the atomic entry + ledger write, then refreshes the tournament
// counters. The four methods and the ticket equal-or-greater rule (with top-up or
// a manager override below face value) come straight from the wallet module.
//
// Cashier + manager only (the route is role-gated). After each buy-in the form
// resets for the next player and reloads the entries so duplicate detection and
// the counters stay current — the desk registers many players in a row.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useRegistration } from '../../hooks/useRegistration'
import { usePlayers } from '../../hooks/usePlayers'
import { tickets as ticketsApi, ValidationError } from '../../lib/firestore'
import { createPlayer, searchPlayers, playerDisplayName, PlayerError } from '../../lib/players'
import {
  registerEntry,
  totalEntryCost,
  registrationOpen,
  registrableSessions,
  planEntry,
  TournamentError,
} from '../../lib/tournaments'
import { WalletError } from '../../lib/wallet'
import { formatMoney } from '../../lib/money'
import { statusLabel } from '../../lib/tournamentStatus'
import { emptyPlayerForm, validatePlayerForm, buildPlayerArgs } from '../../lib/playerForm'
import { Text, Select, EmptyState } from '../../components/FormFields'
import PlayerProfileFields from '../../components/PlayerProfileFields'
import StatusBadge from '../../components/StatusBadge'

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'eftpos', label: 'EFTPOS' },
  { id: 'wallet', label: 'From wallet' },
  { id: 'ticket', label: 'Ticket' },
]
const methodLabel = (m) => METHODS.find((x) => x.id === m)?.label ?? m

// Surface the typed domain/wallet errors verbatim (they're written for staff);
// strip the wallet wrapper's "[wallet.opName]" prefix; generic fallback otherwise.
function friendlyError(e) {
  if (
    e instanceof TournamentError ||
    e instanceof WalletError ||
    e instanceof PlayerError ||
    e instanceof ValidationError
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

export default function TournamentRegister() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const toast = useToast()
  const { tournament, sessions, entries, loading, error, mockMode, notFound, reload } = useRegistration(id)
  const players = usePlayers()

  // Selection state
  const [q, setQ] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState(emptyPlayerForm)
  const [pickedSessionId, setPickedSessionId] = useState('')
  const [method, setMethod] = useState(null)
  const [reference, setReference] = useState('')
  const [playerTickets, setPlayerTickets] = useState([])
  const [ticketId, setTicketId] = useState('')
  const [shortfallMode, setShortfallMode] = useState('topup') // 'topup' | 'override'
  const [topUpMethod, setTopUpMethod] = useState('cash')
  const [topUpRef, setTopUpRef] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const cost = tournament ? totalEntryCost(tournament) : 0
  const open = tournament ? registrationOpen(tournament) : false
  const flights = useMemo(() => registrableSessions(sessions), [sessions])
  // The single flight is implicit; the picker only appears (and holds state) when
  // there's more than one — so derive it rather than syncing state in an effect.
  const originSessionId = flights.length === 1 ? flights[0].id : pickedSessionId

  // Load the selected player's unused tickets (for the ticket method). Clearing on
  // deselect happens in selectPlayer (an event handler), so the effect only fetches.
  useEffect(() => {
    if (!selectedPlayer) return undefined
    let cancelled = false
    ticketsApi
      .listTickets(selectedPlayer.id)
      .then((rows) => {
        if (!cancelled) setPlayerTickets(rows.filter((t) => t.state === 'unused'))
      })
      .catch(() => {
        if (!cancelled) setPlayerTickets([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedPlayer])

  const playerEntries = useMemo(
    () => (selectedPlayer ? entries.filter((e) => e.playerId === selectedPlayer.id) : []),
    [entries, selectedPlayer]
  )
  const plan = useMemo(
    () => (selectedPlayer && tournament ? planEntry({ playerEntries, reentryConfig: tournament.reentryConfig }) : null),
    [selectedPlayer, tournament, playerEntries]
  )

  const results = q.trim() ? searchPlayers(players.players, q, { limit: 8 }) : []
  const selectedTicket = playerTickets.find((t) => t.id === ticketId) ?? null
  const shortfall = method === 'ticket' && selectedTicket ? Math.max(0, cost - selectedTicket.faceValue) : 0
  const walletShort = method === 'wallet' && selectedPlayer ? selectedPlayer.walletBalance < cost : false

  function resetPayment() {
    setMethod(null)
    setReference('')
    setTicketId('')
    setShortfallMode('topup')
    setTopUpMethod('cash')
    setTopUpRef('')
    setOverrideReason('')
    setConfirming(false)
  }
  function selectPlayer(p) {
    setSelectedPlayer(p)
    setPlayerTickets([])
    resetPayment()
  }
  function resetForNext() {
    selectPlayer(null)
    setQ('')
    setCreating(false)
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

  function paymentReady() {
    if (!selectedPlayer || !plan || plan.blockedReason) return false
    if (!originSessionId) return false
    if (!method) return false
    if (method === 'wallet') return !walletShort
    if (method === 'ticket') {
      if (!selectedTicket) return false
      if (shortfall > 0) {
        return shortfallMode === 'topup' ? true : role === 'manager' && overrideReason.trim() !== ''
      }
      return true
    }
    return true // cash / eftpos
  }

  async function doRegister() {
    setBusy(true)
    try {
      const res = await registerEntry({
        tournament,
        originSessionId,
        player: selectedPlayer,
        playerEntries,
        paymentMethod: method,
        reference: method === 'cash' || method === 'eftpos' ? reference.trim() || null : null,
        ticketId: method === 'ticket' ? ticketId : null,
        topUp:
          method === 'ticket' && shortfall > 0 && shortfallMode === 'topup'
            ? { method: topUpMethod, reference: topUpRef.trim() || null }
            : null,
        managerOverride:
          method === 'ticket' && shortfall > 0 && shortfallMode === 'override'
            ? { reason: overrideReason.trim() }
            : null,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(
        `Registered ${playerDisplayName(selectedPlayer)} — entry #${res.entryNumber}, ${formatMoney(res.totalCost)} via ${methodLabel(method)}.`
      )
      resetForNext()
      reload()
    } catch (e) {
      toast.error(friendlyError(e))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  const paymentStep = flights.length > 1 ? '3' : '2'

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-3xl">
      <button
        type="button"
        onClick={() => navigate(`/td/tournaments/${id}`)}
        className="text-sm text-white/50 hover:text-white mb-4"
      >
        ← Back to tournament
      </button>

      {mockMode ? (
        <EmptyState
          title="Mock mode — registration needs the emulator."
          body="Run npm run emulator + seed/create a tournament against the local Firestore emulator, then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load this tournament." body={error.message} tone="error" />
      ) : notFound ? (
        <EmptyState title="Tournament not found." body="This tournament may have been removed, or the link is out of date." />
      ) : loading || !tournament ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          <div className="mb-5">
            <div className="flex items-baseline justify-between gap-3">
              <h1 className="font-display text-3xl md:text-4xl text-gold-400">Register player</h1>
              <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
                Phase 3 — task 3.4
              </span>
            </div>
            <div className="mt-2 text-sm text-white/60 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-white/90 font-medium">{tournament.name}</span>
              <StatusBadge status={tournament.status} />
              <span>
                Buy-in {formatMoney(tournament.buyIn)}
                {tournament.hospitalityCost ? ` + ${formatMoney(tournament.hospitalityCost)} hospitality` : ''}
              </span>
              <span className="text-gold-300">Total {formatMoney(cost)}</span>
            </div>
          </div>

          {!open ? (
            <EmptyState
              title="Registration is closed."
              body={`This tournament is "${statusLabel(tournament.status)}". A manager can reopen late registration from the tournament's floor controls.`}
            />
          ) : (
            <>
              {/* ── 1 · Player ─────────────────────────────────────────────── */}
              <Panel title="1 · Player">
                {selectedPlayer ? (
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-white/90 font-medium">{playerDisplayName(selectedPlayer)}</div>
                      <div className="text-xs text-white/50 mt-0.5">
                        {selectedPlayer.phone} · Wallet {formatMoney(selectedPlayer.walletBalance)} · Tickets{' '}
                        {formatMoney(selectedPlayer.ticketBalance)}
                      </div>
                      {plan?.blockedReason ? (
                        <div className="text-xs text-red-300 mt-1.5">{plan.blockedReason}</div>
                      ) : plan && plan.entryType !== 'initial' ? (
                        <div className="text-xs text-amber-300 mt-1.5">
                          Re-entry — this will be entry #{plan.entryNumber}.
                        </div>
                      ) : null}
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
                                {p.email ? ` · ${p.email}` : ''}
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

              {/* ── 2 · Flight (multi-flight only) ─────────────────────────── */}
              {flights.length > 1 && (
                <Panel title="2 · Flight">
                  <Select
                    label="Which flight does this entry join?"
                    value={originSessionId}
                    onChange={setPickedSessionId}
                    options={[
                      { value: '', label: 'Choose a flight…' },
                      ...flights.map((f) => ({ value: f.id, label: f.sessionLabel })),
                    ]}
                  />
                </Panel>
              )}

              {/* ── Payment ────────────────────────────────────────────────── */}
              {selectedPlayer && plan && !plan.blockedReason && (
                <Panel title={`${paymentStep} · Payment — ${formatMoney(cost)}`}>
                  <div className="flex flex-wrap gap-2">
                    {METHODS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMethod(m.id)}
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

                  {method === 'wallet' && (
                    <div className="mt-4 text-sm">
                      <div className="text-white/60">
                        Wallet balance: <span className="tabular-nums text-white/90">{formatMoney(selectedPlayer.walletBalance)}</span>
                      </div>
                      {walletShort ? (
                        <div className="text-red-300 mt-1">
                          Not enough in the wallet for {formatMoney(cost)}. Take a deposit first, or use another method.
                        </div>
                      ) : (
                        <div className="text-emerald-300/80 mt-1">
                          {formatMoney(cost)} will be debited from the wallet.
                        </div>
                      )}
                    </div>
                  )}

                  {method === 'ticket' && (
                    <div className="mt-4">
                      {playerTickets.length === 0 ? (
                        <p className="text-sm text-white/50">This player has no unused tickets.</p>
                      ) : (
                        <>
                          <Select
                            label="Ticket"
                            value={ticketId}
                            onChange={setTicketId}
                            options={[
                              { value: '', label: 'Choose a ticket…' },
                              ...playerTickets.map((t) => ({
                                value: t.id,
                                label: `${formatMoney(t.faceValue)}${t.issuedReason ? ` — ${t.issuedReason}` : ''}`,
                              })),
                            ]}
                            disabled={busy}
                          />
                          {selectedTicket && shortfall <= 0 && (
                            <p className="text-xs text-emerald-300/80 mt-2">
                              Ticket ({formatMoney(selectedTicket.faceValue)}) covers the {formatMoney(cost)} buy-in.
                            </p>
                          )}
                          {selectedTicket && shortfall > 0 && (
                            <div className="mt-3 border border-amber-500/30 rounded-lg p-3">
                              <p className="text-xs text-amber-200/80 mb-2">
                                Ticket ({formatMoney(selectedTicket.faceValue)}) is {formatMoney(shortfall)} short of the{' '}
                                {formatMoney(cost)} buy-in.
                              </p>
                              <div className="flex gap-4 text-sm mb-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="shortfall"
                                    checked={shortfallMode === 'topup'}
                                    onChange={() => setShortfallMode('topup')}
                                    className="accent-gold-500"
                                  />
                                  Top up the difference
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="shortfall"
                                    checked={shortfallMode === 'override'}
                                    onChange={() => setShortfallMode('override')}
                                    className="accent-gold-500"
                                  />
                                  Manager override
                                </label>
                              </div>
                              {shortfallMode === 'topup' ? (
                                <div className="flex flex-wrap items-end gap-3">
                                  <div className="w-40">
                                    <Select
                                      label={`Top-up ${formatMoney(shortfall)} via`}
                                      value={topUpMethod}
                                      onChange={setTopUpMethod}
                                      options={[
                                        { value: 'cash', label: 'Cash' },
                                        { value: 'eftpos', label: 'EFTPOS' },
                                      ]}
                                      disabled={busy}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-[10rem]">
                                    <Text label="Top-up ref (optional)" value={topUpRef} onChange={setTopUpRef} disabled={busy} />
                                  </div>
                                </div>
                              ) : role === 'manager' ? (
                                <Text
                                  label="Override reason (required)"
                                  value={overrideReason}
                                  onChange={setOverrideReason}
                                  placeholder="Why allow the ticket below value?"
                                  disabled={busy}
                                />
                              ) : (
                                <p className="text-xs text-red-300">
                                  A manager must authorise using a ticket below its value. Switch the role, or use a top-up.
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </Panel>
              )}

              {/* ── Confirm ────────────────────────────────────────────────── */}
              {selectedPlayer && plan && !plan.blockedReason && method && (
                <div className="bg-felt-800 border border-white/10 rounded-lg p-4">
                  {!confirming ? (
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        disabled={!paymentReady() || busy}
                        className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40 disabled:opacity-40"
                      >
                        Review registration →
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-white/80 mb-1">
                        Register <span className="text-white">{playerDisplayName(selectedPlayer)}</span>
                        {plan.entryType !== 'initial' ? ` (entry #${plan.entryNumber})` : ''} into{' '}
                        <span className="text-white">{tournament.name}</span>
                        {flights.length > 1 && originSessionId
                          ? ` — ${flights.find((f) => f.id === originSessionId)?.sessionLabel}`
                          : ''}
                        .
                      </p>
                      <p className="text-sm text-white/60 mb-3">
                        {methodLabel(method)} · <span className="text-gold-300">{formatMoney(cost)}</span>
                        {method === 'ticket' && shortfall > 0 && shortfallMode === 'topup'
                          ? ` (ticket ${formatMoney(selectedTicket.faceValue)} + ${formatMoney(shortfall)} ${topUpMethod})`
                          : ''}
                        {method === 'ticket' && shortfall > 0 && shortfallMode === 'override'
                          ? ' (manager override — ticket below value)'
                          : ''}
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
                          onClick={doRegister}
                          disabled={busy}
                          className="px-5 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 active:bg-emerald-500/40 disabled:opacity-40"
                        >
                          {busy ? 'Registering…' : 'Confirm & register'}
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
