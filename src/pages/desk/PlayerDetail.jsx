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
import { downloadCsv, csvFilename } from '../../lib/csv'
import {
  buildLedger,
  ledgerTypeLabel,
  ledgerMethodLabel,
  ledgerAmountTone,
  ledgerFilterMatch,
  LEDGER_FILTERS,
} from '../../lib/walletLedger'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'activity', label: 'Activity' },
  { id: 'wallet', label: 'Wallet & tickets' },
]

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
    <div className="px-6 py-8 md:px-10 md:py-10">
      <button
        type="button"
        onClick={() => navigate('/desk/players')}
        className="text-sm text-white/65 hover:text-white mb-4"
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
        <div className="py-12 text-center text-white/55 text-sm">Loading…</div>
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
              <div className="bg-felt-800 border border-white/10 rounded-lg px-4 py-2 mb-5 text-xs text-white/65">
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
                    : 'border-transparent text-white/65 hover:text-white/80')
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
          <div className="mt-1 text-sm text-white/70 flex flex-wrap items-center gap-x-3 gap-y-1">
            {player.displayName && name !== realName && <span>{realName}</span>}
            <span>{player.phone}</span>
            {player.email && <span className="text-white/55">{player.email}</span>}
          </div>
          <div className="mt-1 text-[11px] font-mono uppercase tracking-widest text-white/45">
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
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/45">{label}</div>
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
        <div className="py-8 text-center text-white/55 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No tournament history yet." body="Entries this player makes will appear here." />
      ) : (
        <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/55">
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
                  <td className="px-4 py-2.5 text-white/65 whitespace-nowrap">{fmtDate(e.registeredAt)}</td>
                  <td className="px-4 py-2.5 text-white/70 whitespace-nowrap">
                    {entryTypeLabel(e.entryType)} #{e.entryNumber}
                  </td>
                  <td className="px-4 py-2.5 text-right text-white/70 tabular-nums whitespace-nowrap">
                    {formatMoney(e.paymentAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-white/70 whitespace-nowrap">{entryResultLabel(e)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {entryWinnings(e) > 0 ? (
                      <span className="text-emerald-300">{formatMoney(entryWinnings(e))}</span>
                    ) : (
                      <span className="text-white/45">—</span>
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

const LEDGER_CSV_COLUMNS = [
  { key: 'date', label: 'Date' }, // Firestore Timestamp → ISO via the CSV default formatter
  { key: 'type', label: 'Type' },
  { key: 'method', label: 'Method' },
  { key: 'reference', label: 'Reference' },
  { key: 'amount', label: 'Amount' },
  { key: 'balance', label: 'Balance' },
]

function LedgerAmount({ delta, amount }) {
  const tone = ledgerAmountTone(delta)
  if (tone === 'credit') return <span className="text-emerald-300">+{formatMoney(amount)}</span>
  if (tone === 'debit') return <span className="text-rose-300">−{formatMoney(amount)}</span>
  // No wallet-balance effect (cash buy-in, ticket use, withdrawal request/cancel).
  return <span className="text-white/55">{formatMoney(amount)}</span>
}

function WalletTab({ player, canRegister }) {
  const toast = useToast()
  const { transactions, loading, error, mockMode } = useWalletTransactions(player.id)
  const [filter, setFilter] = useState('all')

  // Running balance is computed over the FULL history (anchored to the cached
  // wallet balance), then we filter which rows show — so every visible row keeps
  // its true running balance even when a filter hides its neighbours.
  const allRows = useMemo(
    () => buildLedger(transactions, player.walletBalance),
    [transactions, player.walletBalance]
  )
  const activeFilter = LEDGER_FILTERS.find((f) => f.id === filter) ?? LEDGER_FILTERS[0]
  const visible = useMemo(
    () => allRows.filter((r) => ledgerFilterMatch(activeFilter, r.tx.type)),
    [allRows, activeFilter]
  )
  const counts = useMemo(() => {
    const c = {}
    for (const f of LEDGER_FILTERS) {
      c[f.id] = allRows.filter((r) => ledgerFilterMatch(f, r.tx.type)).length
    }
    return c
  }, [allRows])

  function handleExport() {
    if (visible.length === 0) {
      toast.info('Nothing to export — no transactions in this view.')
      return
    }
    const rows = visible.map(({ tx, delta, balanceAfter }) => ({
      date: tx.timestamp,
      type: ledgerTypeLabel(tx),
      method: ledgerMethodLabel(tx),
      reference: tx.reference || tx.notes || '',
      amount: (delta < 0 ? '-' : delta > 0 ? '+' : '') + formatMoney(tx.amount),
      balance: formatMoney(balanceAfter),
    }))
    downloadCsv(rows, LEDGER_CSV_COLUMNS, csvFilename('wallet-ledger'))
    toast.success(`Exported ${rows.length} transaction${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <BalanceCard label="Wallet balance" value={formatMoney(player.walletBalance)} accent />
        <BalanceCard label="Ticket balance" value={formatMoney(player.ticketBalance)} />
        <BalanceCard label="Total deposited" value={formatMoney(player.totalDeposited)} />
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55">Transaction ledger</h3>
        {canRegister && (
          <div className="flex items-center gap-2">
            <Link
              to={`/desk/deposit?playerId=${player.id}`}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35 whitespace-nowrap"
            >
              + Record a deposit
            </Link>
            <Link
              to={`/desk/withdrawals?playerId=${player.id}`}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15 whitespace-nowrap"
            >
              ↖ New withdrawal
            </Link>
          </div>
        )}
      </div>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no wallet activity available."
          body="Record a deposit or register this player against the emulator to see the ledger."
        />
      ) : error ? (
        <EmptyState title="Couldn't load wallet activity." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-8 text-center text-white/55 text-sm">Loading…</div>
      ) : allRows.length === 0 ? (
        <EmptyState
          title="No wallet activity yet."
          body={
            canRegister
              ? 'Deposits, buy-ins, winnings, and withdrawals will appear here as they happen.'
              : 'Wallet transactions for this player will appear here.'
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {LEDGER_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={
                    'px-3 py-1.5 rounded-full text-xs font-medium ' +
                    (filter === f.id
                      ? 'bg-gold-500/20 text-gold-300'
                      : 'bg-white/5 text-white/65 hover:bg-white/10 hover:text-white/80')
                  }
                >
                  {f.label}
                  <span className="ml-1.5 text-white/45">{counts[f.id]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleExport}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15"
            >
              Export CSV
            </button>
          </div>

          {visible.length === 0 ? (
            <EmptyState title="No transactions match this filter." body="Try a different filter above." />
          ) : (
            <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/55">
                  <tr>
                    <th className="text-left px-4 py-2 whitespace-nowrap">Date</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Method</th>
                    <th className="text-left px-4 py-2">Reference</th>
                    <th className="text-right px-4 py-2 whitespace-nowrap">Amount</th>
                    <th className="text-right px-4 py-2 whitespace-nowrap">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ tx, delta, balanceAfter }) => (
                    <tr key={tx.id} className="border-t border-white/5">
                      <td className="px-4 py-2.5 text-white/65 whitespace-nowrap">{fmtDateTime(tx.timestamp)}</td>
                      <td className="px-4 py-2.5 text-white/80 whitespace-nowrap">{ledgerTypeLabel(tx)}</td>
                      <td className="px-4 py-2.5 text-white/70 whitespace-nowrap">{ledgerMethodLabel(tx)}</td>
                      <td className="px-4 py-2.5 text-white/55 break-all">{tx.reference || tx.notes || '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                        <LedgerAmount delta={delta} amount={tx.amount} />
                      </td>
                      <td className="px-4 py-2.5 text-right text-white/70 tabular-nums whitespace-nowrap">
                        {formatMoney(balanceAfter)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-white/45 mt-4">
            Running <span className="text-white/65">Balance</span> is the wallet balance after each
            transaction; rows with no wallet effect (a cash buy-in, a ticket used, a withdrawal
            request) leave it unchanged. Withdrawals live in the{' '}
            <Link to="/desk/withdrawals" className="underline hover:text-white/70">
              withdrawal queue
            </Link>
            .
          </p>
        </>
      )}
    </>
  )
}

function BalanceCard({ label, value, accent }) {
  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/45 mb-1">{label}</div>
      <div className={'text-2xl tabular-nums ' + (accent ? 'text-emerald-300' : 'text-white/80')}>{value}</div>
    </div>
  )
}

function EmptyState({ title, body, tone = 'neutral' }) {
  const border = tone === 'error' ? 'border-red-500/30' : 'border-white/5'
  return (
    <div className={`bg-felt-800 border ${border} rounded-lg p-8 text-center`}>
      <div className="font-display text-lg text-white mb-1">{title}</div>
      {body && <p className="text-sm text-white/65 max-w-md mx-auto">{body}</p>}
    </div>
  )
}
