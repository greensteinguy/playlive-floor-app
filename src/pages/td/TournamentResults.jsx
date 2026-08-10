// Final results page — Phase 4 task 4.10. The end-of-night artifact: what
// happened, who won what. READ-ONLY — every figure is derived from data other
// screens already wrote (entries, tournament counters, bounty draws, audit
// rows); this page performs no writes and owns no ops.
//
// Layout:
//   Header      — name, status, game type, entries / re-entries, prize pool
//                 (the denormalized SSOT — hospitality excluded), guarantee
//                 met/missed when one exists.
//   Standings   — grouped honestly (lib/tournaments/results.js): placed rows
//                 (1st = recorded winner), satellite ticket winners, players
//                 still in (so a mid-tournament view doesn't pretend the night
//                 is decided), and busts with no place recorded. Paid marker
//                 per row from winningsPaidAt. CSV export of the same rows.
//   Side sections, each only when relevant:
//     Mystery bounty — drawn/remaining summary + the draw list (bountyBoardRows).
//     Last-longer    — the settled winner per deck (deriveLastLongerStatus).
//     Deal note      — the newest tournament.dealEntered audit row, queried by
//                      (targetType, targetId, timestamp) — the composite index
//                      that already exists — and filtered client-side, so no
//                      new index is required.
//
// All floor roles can view (route matches the detail page's gating: any
// authenticated role, no requiredRoles).

import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { query, where, orderBy, limit } from 'firebase/firestore'
import { useTournament } from '../../hooks/useTournament'
import { useEntries } from '../../hooks/useEntries'
import { usePlayers } from '../../hooks/usePlayers'
import { bountyDraws as bountyDrawsApi, auditLog as auditLogApi, MockModeError } from '../../lib/firestore'
import {
  entryTypeCounts,
  guaranteeStatus,
  buildResultsStandings,
  flattenStandings,
  latestDealFromAudit,
  RESULTS_GROUP_LABEL,
  RESULT_PAID_STATE_LABEL,
  remainingBountySummary,
  bountyBoardRows,
  deriveLastLongerStatus,
  lastLongerDeckLabel,
  LAST_LONGER_DECKS,
} from '../../lib/tournaments'
import { playerDisplayName } from '../../lib/players'
import { ordinal } from '../../lib/entryDisplay'
import { formatMoney } from '../../lib/money'
import { GAME_TYPE_LABEL } from '../../lib/gameTypes'
import { downloadCsv, csvFilename } from '../../lib/csv'
import { EmptyState } from '../../components/FormFields'
import StatusBadge from '../../components/StatusBadge'

function fmtTime(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : ts
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

const btnPlain =
  'px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 border border-white/10 disabled:opacity-40'

export default function TournamentResults() {
  const { id } = useParams()
  const { tournament, loading, error, mockMode, notFound } = useTournament(id)
  const { entries, loading: entriesLoading } = useEntries(id)
  const players = usePlayers()

  const nameById = useMemo(() => {
    const m = {}
    for (const p of players.players) m[p.id] = playerDisplayName(p)
    return m
  }, [players.players])
  const nameOf = (playerId) => nameById[playerId] ?? (playerId ? `${playerId.slice(0, 8)}…` : '—')

  const standings = useMemo(() => buildResultsStandings(entries), [entries])
  const flat = useMemo(() => flattenStandings(standings), [standings])
  const counts = useMemo(() => entryTypeCounts(entries), [entries])
  const guarantee = tournament ? guaranteeStatus(tournament) : null
  const inProgress = standings.stillIn.length > 0

  function handleExport() {
    const data = flat.map((r) => ({
      group: RESULTS_GROUP_LABEL[r.group],
      place: r.place != null ? ordinal(r.place) : r.group === 'ticketWinners' ? 'Ticket' : '',
      player: nameOf(r.playerId),
      cash: formatMoney(r.cash),
      bounty: formatMoney(r.bounty),
      ticket: formatMoney(r.ticket),
      total: formatMoney(r.total),
      status: r.paidState ? RESULT_PAID_STATE_LABEL[r.paidState] : '',
    }))
    downloadCsv(
      data,
      [
        { key: 'group', label: 'Group' },
        { key: 'place', label: 'Place' },
        { key: 'player', label: 'Player' },
        { key: 'cash', label: 'Cash' },
        { key: 'bounty', label: 'Bounty' },
        { key: 'ticket', label: 'Ticket' },
        { key: 'total', label: 'Total' },
        { key: 'status', label: 'Status' },
      ],
      csvFilename(`results-${tournament.name}`)
    )
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <Link to={`/td/tournaments/${id}`} className="text-sm text-white/50 hover:text-white mb-4 inline-block">
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
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h1 className="font-display text-2xl md:text-3xl text-gold-400">{tournament.name}</h1>
            <StatusBadge status={tournament.status} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Results</span>
          </div>

          <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3 flex flex-wrap gap-x-8 gap-y-3 mb-5">
            <Meta label="Game" value={GAME_TYPE_LABEL[tournament.gameType] ?? tournament.gameType} />
            <Meta
              label="Entries"
              value={counts.reentries > 0 ? `${counts.total} (${counts.reentries} re-entries)` : counts.total}
            />
            <Meta label="Prize pool" value={formatMoney(tournament.totalPrizePool)} />
            {guarantee && (
              <Meta
                label="Guarantee"
                value={
                  guarantee.met ? (
                    <span className="text-emerald-300">{formatMoney(guarantee.guarantee)} — met</span>
                  ) : (
                    <span className="text-amber-300">
                      {formatMoney(guarantee.guarantee)} — missed by {formatMoney(guarantee.shortfall)}
                    </span>
                  )
                }
              />
            )}
          </div>

          {inProgress && (
            <p className="text-[11px] text-amber-300/80 mb-3">
              This tournament is still in play — {standings.stillIn.length}{' '}
              {standings.stillIn.length === 1 ? 'player remains' : 'players remain'}. Standings below are as of now.
            </p>
          )}

          <StandingsTable standings={standings} flat={flat} nameOf={nameOf} onExport={handleExport} />

          <DealNote tournamentId={tournament.id} />

          {tournament.gameType === 'mysteryBounty' && (
            <BountySummary tournament={tournament} entries={entries} players={players.players} />
          )}

          {tournament.hasUpperDeckMainDeck && <LastLongerSummary entries={entries} nameOf={nameOf} />}
        </>
      )}
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

// ── Standings ────────────────────────────────────────────────────────────────

function StandingsTable({ standings, flat, nameOf, onExport }) {
  const hasBounty = flat.some((r) => r.bounty > 0)
  const hasTicket = flat.some((r) => r.ticket > 0)
  const colCount = 4 + (hasBounty ? 1 : 0) + (hasTicket ? 1 : 0) + 1 // place, player, cash, [bounty], [ticket], total, status

  const groups = ['placed', 'ticketWinners', 'stillIn', 'unplaced'].filter(
    (g) => standings[g].length > 0
  )

  return (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40">Final standings</h3>
        <button type="button" onClick={onExport} disabled={flat.length === 0} className={btnPlain}>
          ⤓ Export CSV
        </button>
      </div>
      <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
            <tr>
              <th className="text-left px-4 py-2 w-16">Place</th>
              <th className="text-left px-4 py-2">Player</th>
              <th className="text-right px-4 py-2 whitespace-nowrap">Cash</th>
              {hasBounty && <th className="text-right px-4 py-2 whitespace-nowrap">Bounties</th>}
              {hasTicket && <th className="text-right px-4 py-2 whitespace-nowrap">Tickets</th>}
              <th className="text-right px-4 py-2 whitespace-nowrap">Total</th>
              <th className="text-left px-4 py-2 whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {flat.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-white/40">
                  No entries yet — results appear once players are registered.
                </td>
              </tr>
            ) : (
              groups.map((g) => (
                <GroupRows
                  key={g}
                  group={g}
                  rows={standings[g]}
                  nameOf={nameOf}
                  hasBounty={hasBounty}
                  hasTicket={hasTicket}
                  colCount={colCount}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function GroupRows({ group, rows, nameOf, hasBounty, hasTicket, colCount }) {
  return (
    <>
      {group !== 'placed' && (
        <tr className="border-t border-white/10 bg-felt-900/40">
          <td colSpan={colCount} className="px-4 py-1.5 text-[10px] font-mono uppercase tracking-widest text-white/40">
            {RESULTS_GROUP_LABEL[group]}
          </td>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={r.entryId} className="border-t border-white/5">
          <td className="px-4 py-2.5 font-mono text-gold-300/90 tabular-nums">
            {r.place != null ? (
              ordinal(r.place)
            ) : (
              <span className="text-white/40">
                {group === 'ticketWinners' ? 'ticket' : group === 'stillIn' ? 'in play' : '—'}
              </span>
            )}
          </td>
          <td className="px-4 py-2.5 text-white/90">{nameOf(r.playerId)}</td>
          <td className="px-4 py-2.5 text-right text-white/80 tabular-nums whitespace-nowrap">
            {r.cash > 0 ? formatMoney(r.cash) : <span className="text-white/25">—</span>}
          </td>
          {hasBounty && (
            <td className="px-4 py-2.5 text-right text-white/80 tabular-nums whitespace-nowrap">
              {r.bounty > 0 ? formatMoney(r.bounty) : <span className="text-white/25">—</span>}
            </td>
          )}
          {hasTicket && (
            <td className="px-4 py-2.5 text-right text-white/80 tabular-nums whitespace-nowrap">
              {r.ticket > 0 ? formatMoney(r.ticket) : <span className="text-white/25">—</span>}
            </td>
          )}
          <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
            {r.total > 0 ? (
              <span className="text-gold-200">{formatMoney(r.total)}</span>
            ) : (
              <span className="text-white/25">—</span>
            )}
          </td>
          <td className="px-4 py-2.5 whitespace-nowrap">
            {r.paidState === 'paid' ? (
              <span className="text-emerald-300">Paid ✓</span>
            ) : r.paidState === 'staged' ? (
              <span className="text-amber-300/90">Awaiting cashier</span>
            ) : (
              <span className="text-white/25">—</span>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}

// ── Deal note ────────────────────────────────────────────────────────────────

function DealNote({ tournamentId }) {
  const [deal, setDeal] = useState(null)

  // One-shot fetch: the newest deal audit row for this tournament, via the
  // existing (targetType, targetId, timestamp desc) composite index —
  // actionType is filtered client-side (latestDealFromAudit) so no new index
  // is needed. Errors (including mock mode) fail silent: the note is a
  // nice-to-have annotation, never a blocker.
  useEffect(() => {
    let cancelled = false
    auditLogApi
      .listAuditLog((c) =>
        query(
          c,
          where('targetType', '==', 'tournament'),
          where('targetId', '==', tournamentId),
          orderBy('timestamp', 'desc'),
          limit(250)
        )
      )
      .then((rows) => {
        if (cancelled) return
        setDeal(latestDealFromAudit(rows, tournamentId))
      })
      .catch((e) => {
        if (!(e instanceof MockModeError)) console.warn('[results] deal-note lookup failed (continuing):', e)
      })
    return () => {
      cancelled = true
    }
  }, [tournamentId])

  if (!deal) return null
  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Deal</h3>
      <div className="bg-felt-800 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-white/80">
        <p>
          A deal was entered {fmtTime(deal.timestamp)}
          {deal.playerCount != null && <> covering {deal.playerCount} {deal.playerCount === 1 ? 'player' : 'players'}</>}
          {deal.grandTotal != null && (
            <>
              {' '}— total <span className="text-gold-200 tabular-nums">{formatMoney(deal.grandTotal)}</span>
              {deal.prizePool != null && <span className="text-white/50"> vs {formatMoney(deal.prizePool)} pool</span>}
              {deal.delta != null && deal.delta !== 0 && (
                <span className="text-amber-300">
                  {' '}({deal.delta > 0 ? '+' : '−'}{formatMoney(Math.abs(deal.delta))}
                  {deal.override && ', manager acknowledged'})
                </span>
              )}
            </>
          )}
          .
        </p>
        {deal.notes && <p className="text-white/50 mt-1">“{deal.notes}”</p>}
      </div>
    </section>
  )
}

// ── Mystery bounty summary ───────────────────────────────────────────────────

function BountySummary({ tournament, entries, players }) {
  const [draws, setDraws] = useState([])
  const [drawsLoading, setDrawsLoading] = useState(true)
  const [drawsError, setDrawsError] = useState(null)

  useEffect(() => {
    let cancelled = false
    bountyDrawsApi
      .listBountyDraws(tournament.id)
      .then((rows) => {
        if (cancelled) return
        setDraws(rows)
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
  }, [tournament.id])

  const entriesById = useMemo(() => Object.fromEntries(entries.map((e) => [e.id, e])), [entries])
  const playersById = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players])
  const summary = useMemo(() => remainingBountySummary(tournament, draws), [tournament, draws])
  const board = useMemo(() => bountyBoardRows({ draws, entriesById, playersById }), [draws, entriesById, playersById])

  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Mystery bounties</h3>
      <div className="bg-felt-800 border border-white/5 rounded-lg overflow-x-auto">
        {drawsLoading ? (
          <div className="py-6 text-center text-white/40 text-sm">Loading draws…</div>
        ) : drawsError ? (
          <div className="py-6 text-center text-red-300/80 text-sm">Couldn't load bounty draws: {drawsError.message}</div>
        ) : (
          <>
            <div className="px-4 py-3 flex flex-wrap gap-x-8 gap-y-3 border-b border-white/5">
              <Meta label="Drawn" value={`${summary.drawnCount} — ${formatMoney(summary.drawnTotal)}`} />
              <Meta label="Remaining" value={`${summary.count} — ${formatMoney(summary.total)}`} />
            </div>
            {board.length === 0 ? (
              <div className="py-4 text-center text-white/40 text-sm">No bounties were drawn.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
                  <tr>
                    <th className="text-left px-4 py-2">Drawn</th>
                    <th className="text-left px-4 py-2">Winner (knocker)</th>
                    <th className="text-left px-4 py-2">Knocked out</th>
                    <th className="text-right px-4 py-2 whitespace-nowrap">Bounty</th>
                    <th className="text-left px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((d) => (
                    <tr key={d.id} className="border-t border-white/5">
                      <td className="px-4 py-2.5 text-white/50 whitespace-nowrap">{fmtTime(d.drawnAt)}</td>
                      <td className="px-4 py-2.5 text-white/90">{d.knockerName}</td>
                      <td className="px-4 py-2.5 text-white/60">{d.knockedOutName}</td>
                      <td className="px-4 py-2.5 text-right text-white/80 tabular-nums whitespace-nowrap">
                        {formatMoney(d.bountyValue)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {d.isCredited ? (
                          <span className="text-emerald-300">Paid ✓</span>
                        ) : (
                          <span className="text-amber-300/90">Awaiting cashier</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ── Last-longer winners ──────────────────────────────────────────────────────

function LastLongerSummary({ entries, nameOf }) {
  const decks = LAST_LONGER_DECKS.map((deck) => deriveLastLongerStatus(entries, deck)).filter(
    (s) => s.participants.length > 0
  )
  if (decks.length === 0) return null

  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Last longer</h3>
      <div className="bg-felt-800 border border-white/5 rounded-lg px-4 py-3">
        <ul className="text-sm space-y-1.5">
          {decks.map((s) => (
            <li key={s.deck} className="flex items-center gap-3 flex-wrap">
              <span className="text-white/50 w-28">{lastLongerDeckLabel(s.deck)}</span>
              {s.settledWinner ? (
                <span className="text-gold-200">🏆 {nameOf(s.settledWinner.playerId)}</span>
              ) : (
                <span className="text-white/40">
                  Not settled — {s.participants.length}{' '}
                  {s.participants.length === 1 ? 'participant' : 'participants'}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
