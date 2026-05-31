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

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { usePlayer } from '../../hooks/usePlayer'
import { updatePlayer, playerDisplayName, PlayerError } from '../../lib/players'
import { ValidationError } from '../../lib/firestore'
import { formatMoney } from '../../lib/money'
import { playerFormFromDoc, validatePlayerForm, buildPlayerPatch } from '../../lib/playerForm'
import PlayerProfileFields from '../../components/PlayerProfileFields'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'wallet', label: 'Wallet & tickets' },
]

function fmtDate(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
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
        e instanceof PlayerError || e instanceof ValidationError ? e.message : `Save failed: ${e.message}`
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

function WalletTab({ player, canRegister }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <BalanceCard label="Wallet balance" value={formatMoney(player.walletBalance)} accent />
        <BalanceCard label="Ticket balance" value={formatMoney(player.ticketBalance)} />
        <BalanceCard label="Total deposited" value={formatMoney(player.totalDeposited)} />
      </div>
      <div className="bg-felt-800 border border-white/5 rounded-lg p-5 text-sm text-white/50">
        <p className="mb-3">
          These balances are derived from the player's wallet ledger and update atomically as money
          moves. The screens that record those movements arrive across Phase 3 and 4:
        </p>
        <ul className="space-y-1 text-white/40 text-xs">
          <li>• Wallet deposits (cash / EFTPOS / PayID) — task 3.6</li>
          <li>• Tournament registration &amp; payment — task 3.4</li>
          <li>• The full per-player transaction ledger — task 3.11</li>
          <li>• Withdrawals &amp; win credits — Phase 4</li>
        </ul>
        {canRegister && (
          <Link
            to="/td/tournaments"
            className="inline-block mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25"
          >
            Register into a tournament →
          </Link>
        )}
      </div>
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
