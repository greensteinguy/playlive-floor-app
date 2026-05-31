// Player detail / profile page (task 3.1). The click-through target of the player
// search list. A top bar (name, contact, derived wallet + ticket balances) over a
// two-tab body:
//   Profile — editable name/contact fields (manager + cashier; read-only role
//             gets a disabled, banner-flagged view)
//   Wallet  — the derived balances + pointers to the deposit (3.6), withdrawal
//             (4.8), and ledger (3.11) flows that fill this out
//
// Editing goes through the SAFE updatePlayer domain op (read-modify-write +
// full-schema re-validation) — never a partial data-layer update — so a profile
// edit re-runs every invariant and can never touch the cached balances (those
// move only through the wallet module). A merged record is shown read-only with a
// pointer to the record it was merged into.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { usePlayer } from '../../hooks/usePlayer'
import { updatePlayer, playerDisplayName, PlayerError } from '../../lib/players'
import { ValidationError, WriteTimeoutError } from '../../lib/firestore'
import { formatMoney } from '../../lib/money'
import { playerFormFromDoc, validatePlayerForm, buildPlayerPatch } from '../../lib/playerForm'
import PlayerProfileFields from '../../components/PlayerProfileFields'
import { usePlayerActivity } from '../../hooks/usePlayerActivity'
import { useWalletTransactions } from '../../hooks/useWalletTransactions'
import { summarizeEntries, entryWinnings, entryResultLabel, entryTypeLabel } from '../../lib/entryDisplay'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'activity', label: 'Activity' },
  { id: 'wallet', label: 'Wallet & tickets' },
]

const DEPOSIT_METHOD_LABELS = { cash: 'Cash', eftpos: 'EFTPOS', payid: 'PayID' }
const depositMethodLabel = (m) => DEPOSIT_METHOD_LABELS[m] ?? m ?? '—'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
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

export default function PlayerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const toast = useToast()
  const { player, loading, error, mockMode, notFound, reload } = usePlayer(id)

  const [tab, setTab] = useState('profile')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  // Seed the editable form once per loaded player id — not on every reload, so a
  // save doesn't clobber unsaved edits. The top bar still refreshes from `player`.
  const seededId = useRef(null)
  useEffect(() => {
    if (player && seededId.current !== player.id) {
      setForm(playerFormFromDoc(player))
      seededId.current = player.id
    }
  }, [player])

  const isMerged = player?.isMerged === true
  const canEdit = (role === 'manager' || role === 'cashier') && !isMerged
  const canRegister = role === 'manager' || role === 'cashier'
  const d = saving || !canEdit
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  async function handleSave() {
    const err = validatePlayerForm(form)
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      const updated = await updatePlayer({
        id,
        patch: buildPlayerPatch(form),
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(`Saved ${playerDisplayName(updated)}.`)
      reload()
    } catch (e) {
      toast.error(
        e instanceof PlayerError || e instanceof ValidationError || e instanceof WriteTimeoutError
          ? e.message
          : `Save failed: ${e.message}`
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-5xl">
      <button
        type="button"
        onClick={() => navigate('/desk/players')}
        className="text-sm text-white/50 hover:text-white mb-4"
      >
        ← Back to players
      </button>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no player data available."
          body="Run npm run emulator + seed or create players against the local Firestore emulator, then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load this player." body={error.message} tone="error" />
      ) : notFound ? (
        <EmptyState title="Player not found." body="This player may have been removed, or the link is out of date." />
      ) : loading || !player || !form ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          <TopBar player={player} canRegister={canRegister} />

          {isMerged ? (
            <div className="bg-felt-800 border border-amber-500/30 rounded-lg px-4 py-3 mb-5 text-xs text-amber-200/80">
              This record was merged into another player.{' '}
              {player.mergedIntoId && (
                <Link to={`/desk/players/${player.mergedIntoId}`} className="underline hover:text-amber-100">
                  Open the current record →
                </Link>
              )}
            </div>
          ) : (
            !canEdit && (
              <div className="bg-felt-800 border border-white/10 rounded-lg px-4 py-2 mb-5 text-xs text-white/50">
                Read-only access — ask a manager or cashier to make changes.
              </div>
            )
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

          {tab === 'profile' && (
            <>
              <PlayerProfileFields form={form} set={set} disabled={d} />
              {canEdit && (
                <div className="flex items-center justify-end gap-3 mt-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={d}
                    className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40 disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Save profile'}
                  </button>
                </div>
              )}
            </>
          )}

          {tab === 'activity' && <ActivityTab playerId={player.id} />}

          {tab === 'wallet' && <WalletTab player={player} canRegister={canRegister} />}
        </>
      )}
    </div>
  )
}

function TopBar({ player, canRegister }) {
  const name = playerDisplayName(player)
  const realName = `${player.firstName} ${player.lastName}`.trim()
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg p-5 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-gold-300">{name}</h1>
          <div className="mt-1 text-sm text-white/60 flex flex-wrap items-center gap-x-3 gap-y-1">
            {player.displayName && name !== realName && <span>{realName}</span>}
            <span>{player.phone}</span>
            {player.email && <span className="text-white/40">{player.email}</span>}
          </div>
          <div className="mt-1 text-[11px] font-mono uppercase tracking-widest text-white/30">
            Added {fmtDate(player.createdAt)}
          </div>
        </div>
        <div className="flex items-stretch gap-2">
          <Stat label="Wallet" value={formatMoney(player.walletBalance)} accent />
          <Stat label="Tickets" value={formatMoney(player.ticketBalance)} />
          {canRegister && (
            <Link
              to="/td/tournaments"
              className="self-center px-3 py-2 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35 whitespace-nowrap"
            >
              Register →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-felt-900/60 border border-white/5 text-right min-w-[5.5rem]">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">{label}</div>
      <div className={'text-base tabular-nums ' + (accent ? 'text-emerald-300' : 'text-white/80')}>{value}</div>
    </div>
  )
}

function ActivityTab({ playerId }) {
  const { entries, tournamentNameById, loading, error, mockMode } = usePlayerActivity(playerId)
  const totals = useMemo(() => summarizeEntries(entries), [entries])
  const rows = useMemo(
    () =>
      entries
        .filter((e) => e.voidedAt === null)
        .sort((a, b) => (b.registeredAt?.toMillis?.() ?? 0) - (a.registeredAt?.toMillis?.() ?? 0)),
    [entries]
  )

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <BalanceCard label="Tournaments played" value={String(totals.played)} />
        <BalanceCard label="Total buy-ins" value={formatMoney(totals.totalSpent)} />
        <BalanceCard label="Total winnings" value={formatMoney(totals.totalWinnings)} accent />
      </div>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no activity available."
          body="Register this player into a tournament against the emulator to see their history."
        />
      ) : error ? (
        <EmptyState title="Couldn't load activity." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-8 text-center text-white/40 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No tournament history yet." body="Entries this player makes will appear here." />
      ) : (
        <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
              <tr>
                <th className="text-left px-4 py-2">Tournament</th>
                <th className="text-left px-4 py-2 whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-2 whitespace-nowrap">Entry</th>
                <th className="text-right px-4 py-2 whitespace-nowrap">Buy-in</th>
                <th className="text-left px-4 py-2 whitespace-nowrap">Result</th>
                <th className="text-right px-4 py-2 whitespace-nowrap">Winnings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white/90">{tournamentNameById[e.tournamentId] ?? '—'}</td>
                  <td className="px-4 py-2.5 text-white/50 whitespace-nowrap">{fmtDate(e.registeredAt)}</td>
                  <td className="px-4 py-2.5 text-white/60 whitespace-nowrap">
                    {entryTypeLabel(e.entryType)} #{e.entryNumber}
                  </td>
                  <td className="px-4 py-2.5 text-right text-white/70 tabular-nums whitespace-nowrap">
                    {formatMoney(e.paymentAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-white/60 whitespace-nowrap">{entryResultLabel(e)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {entryWinnings(e) > 0 ? (
                      <span className="text-emerald-300">{formatMoney(entryWinnings(e))}</span>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
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

function WalletTab({ player, canRegister }) {
  const { transactions, loading, error, mockMode } = useWalletTransactions(player.id)
  const deposits = useMemo(() => transactions.filter((t) => t.type === 'deposit'), [transactions])

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <BalanceCard label="Wallet balance" value={formatMoney(player.walletBalance)} accent />
        <BalanceCard label="Ticket balance" value={formatMoney(player.ticketBalance)} />
        <BalanceCard label="Total deposited" value={formatMoney(player.totalDeposited)} />
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40">Deposits</h3>
        {canRegister && (
          <Link
            to={`/desk/deposit?playerId=${player.id}`}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35"
          >
            + Record a deposit
          </Link>
        )}
      </div>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no wallet activity available."
          body="Record a deposit against the emulator to see it here."
        />
      ) : error ? (
        <EmptyState title="Couldn't load wallet activity." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-8 text-center text-white/40 text-sm">Loading…</div>
      ) : deposits.length === 0 ? (
        <EmptyState
          title="No deposits yet."
          body={
            canRegister
              ? 'Use “+ Record a deposit” to add cash, EFTPOS, or PayID to this wallet.'
              : 'Deposits to this wallet will appear here.'
          }
        />
      ) : (
        <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
              <tr>
                <th className="text-left px-4 py-2 whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-2">Method</th>
                <th className="text-left px-4 py-2">Reference</th>
                <th className="text-right px-4 py-2 whitespace-nowrap">Amount</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((t) => (
                <tr key={t.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-white/50 whitespace-nowrap">{fmtDateTime(t.timestamp)}</td>
                  <td className="px-4 py-2.5 text-white/80">{depositMethodLabel(t.method)}</td>
                  <td className="px-4 py-2.5 text-white/50 break-all">{t.reference || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-300 tabular-nums whitespace-nowrap">
                    {formatMoney(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-white/30 mt-4">
        The full per-player ledger (every spend, win credit, withdrawal) arrives with task 3.11; the
        withdrawal queue is Phase 4.
      </p>
    </>
  )
}

function BalanceCard({ label, value, accent }) {
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
      <div className={'text-2xl tabular-nums ' + (accent ? 'text-emerald-300' : 'text-white/80')}>{value}</div>
    </div>
  )
}

function EmptyState({ title, body, tone = 'neutral' }) {
  const border = tone === 'error' ? 'border-red-500/30' : 'border-white/5'
  return (
    <div className={`bg-felt-800 border ${border} rounded-lg p-8 text-center`}>
      <div className="font-display text-lg text-white mb-1">{title}</div>
      {body && <p className="text-sm text-white/50 max-w-md mx-auto">{body}</p>}
    </div>
  )
}
