// Payouts landing (/td/payouts) — a thin tournament picker. The real payouts
// work happens on the per-tournament screen (/td/tournaments/:id/payouts);
// this page just gets the cashier/TD there fast: running and recently
// finished tournaments first, newest first (drafts hidden — nothing to pay).

import { Link } from 'react-router-dom'
import { useTournaments } from '../../hooks/useTournaments'
import { formatMoney } from '../../lib/money'
import { EmptyState } from '../../components/FormFields'
import StatusBadge from '../../components/StatusBadge'

// Tournaments most likely to need payout work float to the top.
const STATUS_PRIORITY = { lateRegClosed: 0, finished: 1, lateRegOpen: 2, scheduled: 3, cancelled: 4 }

export default function Payouts() {
  const { tournaments, loading, error, mockMode } = useTournaments()

  const rows = tournaments
    .filter((t) => t.status !== 'draft')
    .sort(
      (a, b) =>
        (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9) ||
        (b.scheduledStartTime?.toMillis?.() ?? 0) - (a.scheduledStartTime?.toMillis?.() ?? 0)
    )

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <h1 className="font-display text-2xl md:text-3xl text-gold-400 mb-1">Payouts</h1>
      <p className="text-sm text-white/50 mb-6">
        Pick a tournament to calculate payouts, enter a deal, and confirm each player's payout.
      </p>

      {mockMode ? (
        <EmptyState
          title="Mock mode — no tournaments available."
          body="Run npm run emulator + seed tournaments against the local Firestore emulator, then reload."
        />
      ) : error ? (
        <EmptyState title="Couldn't load tournaments." body={error.message} tone="error" />
      ) : loading ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No tournaments yet." body="Payouts appear here once tournaments are scheduled and played." />
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                to={`/td/tournaments/${t.id}/payouts`}
                className="flex items-center gap-4 bg-felt-800 border border-white/5 hover:border-gold-500/30 rounded-lg px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white/90 truncate">{t.name}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">
                    {t.entryCount} entries · {t.remainingPlayerCount} remaining
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">Prize pool</div>
                  <div className="text-sm text-gold-300 tabular-nums">{formatMoney(t.totalPrizePool)}</div>
                </div>
                <span className="text-white/30">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
