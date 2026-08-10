// Tables & seating (task 3.7: seat assignment — random draw, manual override,
// seat list). Tables are per-session, so the page picks a tournament then a
// session and manages that session's room.
//
// Flow: pick tournament (deep-linkable via ?tournamentId=) → pick session (auto
// for single-session) → Draw seats (random draw over evenly-filled tables) or,
// once drawn, manually move players (pick an unseated player or a seated one,
// then click an empty seat) / unseat / Clear & redraw. A Seat list view exports
// the seat-card data (player · table · seat · starting stack) to CSV; the thermal
// print job itself is Phase 5. TD + manager (route-gated).

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useTournaments } from '../../hooks/useTournaments'
import { useSeating } from '../../hooks/useSeating'
import { usePlayers } from '../../hooks/usePlayers'
import {
  drawSeats,
  clearSeating,
  seatEntry,
  unseatEntry,
  eliminateEntry,
  nextFinishingPlace,
  balanceTables,
  breakTable,
  seatNextAlternate,
  openTable,
  setTableActive,
  planBalance,
  planBreak,
  canBreakTable,
  waitlist,
  firstEmptySeat,
  fillableTables,
  tableSizes,
  seatableEntries,
  isSeatable,
  occupiedSeatCount,
  buildSeatList,
  SeatingError,
  TournamentError,
  drawBounty,
  isMysteryBounty,
  remainingBountySummary,
  bountyBoardRows,
  reachSatelliteMilestone,
  isSatellite,
  satelliteMilestoneThreshold,
  isMilestoneWinner,
} from '../../lib/tournaments'
import { ValidationError, WriteTimeoutError } from '../../lib/firestore'
import { playerDisplayName } from '../../lib/players'
import { formatMoney } from '../../lib/money'
import { useBountyDraws } from '../../hooks/useBountyDraws'
import { ordinal } from '../../lib/entryDisplay'
import { downloadCsv, csvFilename } from '../../lib/csv'
import { Select, EmptyState } from '../../components/FormFields'
import StatusBadge from '../../components/StatusBadge'

function friendlyError(e) {
  if (
    e instanceof SeatingError ||
    e instanceof TournamentError ||
    e instanceof ValidationError ||
    e instanceof WriteTimeoutError
  ) {
    return e.message
  }
  return `Something went wrong: ${e.message}`
}

const fmtChips = (n) => (typeof n === 'number' ? n.toLocaleString('en-AU') : '—')

const SEAT_LIST_COLUMNS = [
  { key: 'tableNumber', label: 'Table' },
  { key: 'seatNumber', label: 'Seat' },
  { key: 'playerName', label: 'Player' },
  { key: 'startingStack', label: 'Starting stack' },
  { key: 'tournamentName', label: 'Tournament' },
]

const ALTERNATE_COLUMNS = [
  { key: 'queue', label: 'Alt #' },
  { key: 'player', label: 'Player' },
  { key: 'tournament', label: 'Tournament' },
]

function Panel({ title, right, children }) {
  return (
    <section className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40">{title}</h3>
        {right}
      </div>
      <div className="bg-felt-800 border border-white/5 rounded-lg p-4">{children}</div>
    </section>
  )
}

export default function Tables() {
  const { user, role } = useAuth()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const tournamentsList = useTournaments()
  const players = usePlayers()

  // Tournament + session selection. Both initialise from the URL / first option
  // synchronously (no set-state-in-effect): the tournament from ?tournamentId=,
  // the session derived as `sessionId || first`. Switching tournament resets the
  // session pick in the handler.
  const [tournamentId, setTournamentId] = useState(searchParams.get('tournamentId') ?? '')
  const [sessionId, setSessionId] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmBalance, setConfirmBalance] = useState(false)
  const [breakTableId, setBreakTableId] = useState(null)
  const [showSeatList, setShowSeatList] = useState(false)
  const [openCount, setOpenCount] = useState(1) // batch open-table count (A2)
  const [confirmEliminate, setConfirmEliminate] = useState(false)
  // Satellite: inline confirm for the "milestone reached" action (task 4.2).
  const [confirmMilestone, setConfirmMilestone] = useState(false)
  // Mystery Bounty (task 4.2): the post-elimination "who knocked them out?"
  // prompt ({ eliminatedEntryId } — null id = the standalone "record a draw"
  // flow, which asks for the knockout first) and the drawn-amount reveal.
  const [bountyPrompt, setBountyPrompt] = useState(null)
  const [bountyReveal, setBountyReveal] = useState(null)
  // Per-table drill-down: tables collapse to an at-a-glance ✓/✗ seat map by default;
  // expanding one reveals its named seat list. Set of expanded table ids.
  const [expandedTables, setExpandedTables] = useState(() => new Set())

  const seating = useSeating(tournamentId)
  const { tournament, sessions, tables, entries } = seating

  const isMB = isMysteryBounty(tournament)
  const isSat = isSatellite(tournament)
  const bounty = useBountyDraws(isMB ? tournamentId : '')

  const canEdit = role === 'manager' || role === 'td'
  const activeSessionId = sessionId || sessions[0]?.id || ''
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  const playersById = useMemo(
    () => Object.fromEntries(players.players.map((p) => [p.id, p])),
    [players.players]
  )
  const entriesById = useMemo(() => Object.fromEntries(entries.map((e) => [e.id, e])), [entries])

  const sessionTables = useMemo(
    () => tables.filter((t) => t.sessionId === activeSessionId).sort((a, b) => a.tableNumber - b.tableNumber),
    [tables, activeSessionId]
  )
  // Broken tables (status !== 'open') are closed — they stay in the collection for
  // dealerMinutes but drop out of the live grid / balancing / breaking views.
  const openTables = useMemo(() => sessionTables.filter((t) => t.status === 'open'), [sessionTables])
  const pool = useMemo(() => seatableEntries(entries, activeSessionId), [entries, activeSessionId])
  const seatedIds = useMemo(
    () => new Set(openTables.flatMap((t) => t.seats.map((s) => s.entryId).filter(Boolean))),
    [openTables]
  )
  const unseated = pool.filter((e) => !seatedIds.has(e.id))
  // Alternates waiting for a seat, FIFO (queue #1 = next). nextSeat is where a
  // "Seat next alternate" would place #1 (the emptiest open seat, or null if full).
  const waitlistEntries = useMemo(() => waitlist(entries, activeSessionId, seatedIds), [entries, activeSessionId, seatedIds])
  const nextSeat = useMemo(() => firstEmptySeat(openTables), [openTables])
  const balanceMoves = useMemo(() => planBalance(openTables), [openTables])
  const breakMoves = useMemo(
    () => (breakTableId ? planBreak(openTables, breakTableId) : null),
    [openTables, breakTableId]
  )
  const selectedEntry = selectedEntryId ? entriesById[selectedEntryId] ?? null : null
  const allExpanded = openTables.length > 0 && openTables.every((t) => expandedTables.has(t.id))
  // Players knocked out of this session (busted, not voided) — surfaced in the summary.
  const eliminatedCount = useMemo(
    () => entries.filter((e) => e.originSessionId === activeSessionId && e.voidedAt === null && e.bustedAt !== null).length,
    [entries, activeSessionId]
  )
  // The place the next bust-out receives (tournament-wide alive count — a UI
  // preview; the op recomputes from fresh reads inside its transaction).
  const nextPlace = useMemo(() => nextFinishingPlace(entries), [entries])

  // ── Mystery Bounty derivations (task 4.2) ─────────────────────────────────
  const bountySummary = useMemo(
    () => (isMB ? remainingBountySummary(tournament, bounty.draws) : null),
    [isMB, tournament, bounty.draws]
  )
  const bountyRows = useMemo(
    () => (isMB ? bountyBoardRows({ draws: bounty.draws, entriesById, playersById }) : []),
    [isMB, bounty.draws, entriesById, playersById]
  )
  const drawnAgainst = useMemo(() => new Set(bounty.draws.map((d) => d.knockedOutEntryId)), [bounty.draws])
  // Eliminator picker: currently seated, still-alive players.
  const eliminatorCandidates = useMemo(
    () => entries.filter((e) => isSeatable(e) && seatedIds.has(e.id)),
    [entries, seatedIds]
  )
  // Standalone "record draw": knockouts that don't have a bounty drawn yet.
  const undrawnKnockouts = useMemo(
    () => entries.filter((e) => e.voidedAt === null && e.bustedAt !== null && !drawnAgainst.has(e.id)),
    [entries, drawnAgainst]
  )

  // ── Satellite derivations (task 4.2) ──────────────────────────────────────
  const milestoneThreshold = isSat ? satelliteMilestoneThreshold(tournament) : null
  const ticketReward = isSat ? tournament.satelliteConfig.ticketReward : null
  // Milestone winners in this session — shown beside the "out" count (they left
  // the field as WINNERS, not bust-outs).
  const sessionTicketWinners = useMemo(
    () =>
      isSat
        ? entries.filter((e) => e.originSessionId === activeSessionId && isMilestoneWinner(e)).length
        : 0,
    [isSat, entries, activeSessionId]
  )

  const nameForEntry = (entry) => {
    const p = entry ? playersById[entry.playerId] : null
    return p ? playerDisplayName(p) : '—'
  }

  function pickTournament(id) {
    setTournamentId(id)
    setSessionId('')
    setSelectedEntryId(null)
    setConfirmClear(false)
    setConfirmBalance(false)
    setConfirmEliminate(false)
    setConfirmMilestone(false)
    setBountyPrompt(null)
    setBountyReveal(null)
    setBreakTableId(null)
    setShowSeatList(false)
    setExpandedTables(new Set())
  }
  function pickSession(id) {
    setSessionId(id)
    setSelectedEntryId(null)
    setConfirmClear(false)
    setConfirmBalance(false)
    setConfirmEliminate(false)
    setConfirmMilestone(false)
    setBountyPrompt(null)
    setBountyReveal(null)
    setBreakTableId(null)
    setExpandedTables(new Set())
  }

  async function run(fn) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDraw() {
    await run(async () => {
      const res = await drawSeats({
        tournament,
        sessionId: activeSessionId,
        entries,
        seatCount: tournament.maxSeatsPerTable,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(`Drew ${res.seatedCount} players across ${res.tableCount} table${res.tableCount === 1 ? '' : 's'}.`)
      seating.reload()
    })
  }

  async function handleClear() {
    await run(async () => {
      const res = await clearSeating({ tournament, sessionId: activeSessionId, actorId: user.uid, actorRole: role })
      toast.success(`Cleared ${res.tablesRemoved} table${res.tablesRemoved === 1 ? '' : 's'}.`)
      setConfirmClear(false)
      setBreakTableId(null)
      setSelectedEntryId(null)
      seating.reload()
    })
  }

  async function handleBalance() {
    await run(async () => {
      const res = await balanceTables({ tournament, sessionId: activeSessionId, actorId: user.uid, actorRole: role })
      toast.success(
        res.moves.length ? `Balanced — ${res.moves.length} move${res.moves.length === 1 ? '' : 's'}.` : 'Tables already balanced.'
      )
      setConfirmBalance(false)
      setSelectedEntryId(null)
      seating.reload()
    })
  }

  async function handleBreak() {
    const tableId = breakTableId
    await run(async () => {
      const res = await breakTable({ tournament, sessionId: activeSessionId, tableId, actorId: user.uid, actorRole: role })
      toast.success(
        res.moves.length
          ? `Closed Table ${res.brokenTableNumber} — moved ${res.moves.length} player${res.moves.length === 1 ? '' : 's'}.`
          : `Closed Table ${res.brokenTableNumber}.`
      )
      setBreakTableId(null)
      setSelectedEntryId(null)
      seating.reload()
    })
  }

  async function handleOpenTables() {
    await run(async () => {
      // openTable reads the current max tableNumber then writes; call it
      // sequentially so each sees the previous table and numbers don't collide
      // (A2 batch open — a parallel loop would race on the next table number).
      const opened = []
      for (let i = 0; i < openCount; i++) {
        const res = await openTable({ tournament, sessionId: activeSessionId, actorId: user.uid, actorRole: role })
        opened.push(res.tableNumber)
      }
      const label =
        opened.length === 1
          ? `Opened Table ${opened[0]}`
          : `Opened ${opened.length} tables (T${opened[0]}–T${opened[opened.length - 1]})`
      toast.success(`${label} — deactivated; activate when you're ready to fill.`)
      seating.reload()
    })
  }

  async function handleSetActive(tableId, active) {
    await run(async () => {
      await setTableActive({ tournament, tableId, active, actorId: user.uid, actorRole: role })
      seating.reload()
    })
  }

  async function handleSeatClick(table, seat) {
    setConfirmEliminate(false)
    setConfirmMilestone(false)
    if (seat.entryId) {
      // Occupied — pick this player up to move (toggle).
      setSelectedEntryId((cur) => (cur === seat.entryId ? null : seat.entryId))
      return
    }
    // Empty seat — place the selected player here.
    if (!selectedEntry) {
      toast.error('Pick a player first (from the unseated list or another seat).')
      return
    }
    await run(async () => {
      await seatEntry({
        tournament,
        entry: selectedEntry,
        targetTableId: table.id,
        targetSeatNumber: seat.seatNumber,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(`Seated ${nameForEntry(selectedEntry)} at table ${table.tableNumber}, seat ${seat.seatNumber}.`)
      setSelectedEntryId(null)
      seating.reload()
    })
  }

  async function handleUnseat(entry) {
    await run(async () => {
      await unseatEntry({ tournament, entry, actorId: user.uid, actorRole: role })
      toast.success(`Unseated ${nameForEntry(entry)}.`)
      setSelectedEntryId(null)
      setConfirmEliminate(false)
      setConfirmMilestone(false)
      seating.reload()
    })
  }

  async function handleEliminate(entry) {
    await run(async () => {
      const res = await eliminateEntry({ tournament, entry, sessionId: activeSessionId, actorId: user.uid, actorRole: role })
      toast.success(`Eliminated ${nameForEntry(entry)} in ${ordinal(res.finishingPlace)} place.`)
      setConfirmEliminate(false)
      setSelectedEntryId(null)
      seating.reload()
      // Mystery Bounty: every knockout triggers a draw — prompt for the
      // eliminator as a FOLLOW-UP (skippable; never blocks the elimination).
      if (isMB) setBountyPrompt({ eliminatedEntryId: entry.id })
    })
  }

  // Mystery Bounty: draw for the knockout in `bountyPrompt` against the picked
  // eliminator, then show the reveal. The op is race-safe against concurrent
  // draws; the wallet credit happens at the cashier's confirm (task 4.7).
  async function handleDrawBounty(eliminatorEntry) {
    const eliminatedEntryId = bountyPrompt?.eliminatedEntryId
    if (!eliminatedEntryId) return
    await run(async () => {
      const res = await drawBounty({
        tournament,
        eliminatorEntryId: eliminatorEntry.id,
        eliminatedEntryId,
        actorId: user.uid,
        actorRole: role,
      })
      setBountyPrompt(null)
      setBountyReveal({
        amount: res.bountyValue,
        knockerName: nameForEntry(eliminatorEntry),
        remainingCount: res.remainingCount,
        remainingTotal: res.remainingTotal,
      })
      bounty.reload()
      seating.reload() // the eliminator entry's bountyEarnings changed
    })
  }

  // Satellite: the TD saw the stack reach the milestone — record the ticket win
  // and remove the player from the field (the ticket itself is issued when the
  // cashier confirms, task 4.7).
  async function handleMilestone(entry) {
    await run(async () => {
      const res = await reachSatelliteMilestone({
        tournament,
        entry,
        sessionId: activeSessionId,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(
        `${nameForEntry(entry)} reached the milestone — ${formatMoney(res.ticketReward)} ticket recorded (issued at the cashier).`
      )
      setConfirmMilestone(false)
      setSelectedEntryId(null)
      seating.reload()
    })
  }

  function toggleExpand(tableId) {
    setExpandedTables((cur) => {
      const next = new Set(cur)
      if (next.has(tableId)) next.delete(tableId)
      else next.add(tableId)
      return next
    })
  }
  function toggleExpandAll() {
    setExpandedTables(allExpanded ? new Set() : new Set(openTables.map((t) => t.id)))
  }

  async function handleSeatNext() {
    await run(async () => {
      const res = await seatNextAlternate({
        tournament,
        sessionId: activeSessionId,
        entries,
        tables: openTables,
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(
        `Seated ${nameForEntry(entriesById[res.entryId])} at table ${res.tableNumber}, seat ${res.seatNumber}.`
      )
      setSelectedEntryId(null)
      seating.reload()
    })
  }

  function exportAlternates() {
    if (waitlistEntries.length === 0) {
      toast.error('No alternates waiting.')
      return
    }
    const rows = waitlistEntries.map((e, i) => ({ queue: i + 1, player: nameForEntry(e), tournament: tournament?.name ?? '' }))
    downloadCsv(rows, ALTERNATE_COLUMNS, csvFilename(`alternates-${tournament?.name ?? 'tournament'}`))
    toast.success(`Exported ${rows.length} alternate${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  function exportSeatList() {
    const rows = buildSeatList({ tables: openTables, entriesById, playersById, tournament })
    if (rows.length === 0) {
      toast.error('No seated players to export yet.')
      return
    }
    downloadCsv(
      rows.map((r) => ({ ...r, startingStack: r.startingStack ?? '' })),
      SEAT_LIST_COLUMNS,
      csvFilename(`seat-list-${tournament?.name ?? 'tournament'}`)
    )
    toast.success(`Exported ${rows.length} seat${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  const tournamentOptions = [
    { value: '', label: 'Choose a tournament…' },
    ...tournamentsList.tournaments.map((t) => ({ value: t.id, label: t.name })),
  ]

  return (
    <div className="px-6 py-8 md:px-10 md:py-10">
      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl md:text-4xl text-gold-400">Tables &amp; seating</h1>
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
            Phase 3 — seating
          </span>
        </div>
        <p className="mt-2 text-sm text-white/50">
          An at-a-glance room overview — each table shows which seats are filled (✓) or open (✗). Expand a table
          for the named seats to move players by hand, or pick a player up to eliminate them. Tables are per-session.
        </p>
      </div>

      {/* Tournament + session pickers */}
      <Panel title="Tournament">
        {tournamentsList.mockMode ? (
          <p className="text-sm text-white/50">Mock mode — seating needs the emulator or production.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[16rem]">
              <Select label="Tournament" value={tournamentId} onChange={pickTournament} options={tournamentOptions} />
            </div>
            {tournament && sessions.length > 1 && (
              <div className="min-w-[12rem]">
                <Select
                  label="Session"
                  value={activeSessionId}
                  onChange={pickSession}
                  options={sessions
                    .slice()
                    .sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0) || a.sessionLabel.localeCompare(b.sessionLabel))
                    .map((s) => ({ value: s.id, label: s.sessionLabel }))}
                />
              </div>
            )}
          </div>
        )}
      </Panel>

      {!tournamentId ? (
        <EmptyState title="Pick a tournament to manage its seating." />
      ) : seating.mockMode ? (
        <EmptyState title="Mock mode — seating needs the emulator." body="Run the emulator + seed/create a tournament, then reload." />
      ) : seating.error ? (
        <EmptyState title="Couldn't load this tournament." body={seating.error.message} tone="error" />
      ) : seating.notFound ? (
        <EmptyState title="Tournament not found." />
      ) : seating.loading || !tournament ? (
        <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
      ) : (
        <>
          <div className="mb-5 text-sm text-white/60 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-white/90 font-medium">{tournament.name}</span>
            <StatusBadge status={tournament.status} />
            {activeSession && <span>{activeSession.sessionLabel}</span>}
            <span>Starting stack {fmtChips(tournament.startingStack)}</span>
            <span className="text-gold-300">
              {pool.length} in field · {seatedIds.size} seated · {unseated.length} unseated
            </span>
            {eliminatedCount - sessionTicketWinners > 0 && (
              <span className="text-white/40">{eliminatedCount - sessionTicketWinners} out</span>
            )}
            {isSat && sessionTicketWinners > 0 && (
              <span className="text-emerald-300">{sessionTicketWinners} ticket{sessionTicketWinners === 1 ? '' : 's'} won</span>
            )}
            {isSat && milestoneThreshold != null && (
              <span className="text-white/40">
                Milestone {fmtChips(milestoneThreshold)} chips → {formatMoney(ticketReward)} ticket
              </span>
            )}
            {isMB && bountySummary && (
              <span className="text-white/40">
                {bountySummary.count} bounties undrawn · {formatMoney(bountySummary.total)}
              </span>
            )}
          </div>

          {/* Draw / clear / export controls */}
          <Panel
            title="Seating"
            right={
              canEdit && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* Batch open (A2): stepper + a prominent button. Tables start
                      deactivated — activate when ready to fill. */}
                  <div className="flex items-center rounded-lg border border-white/10 bg-felt-900 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenCount((c) => Math.max(1, c - 1))}
                      disabled={busy || openCount <= 1}
                      aria-label="Fewer tables"
                      className="px-2.5 py-2 text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm tabular-nums text-white/90">{openCount}</span>
                    <button
                      type="button"
                      onClick={() => setOpenCount((c) => Math.min(12, c + 1))}
                      disabled={busy || openCount >= 12}
                      aria-label="More tables"
                      className="px-2.5 py-2 text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenTables}
                    disabled={busy}
                    title="Open new tables (they start deactivated — activate when ready to fill)"
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 active:bg-emerald-500/40 disabled:opacity-40"
                  >
                    {busy ? 'Opening…' : openCount === 1 ? '+ Open table' : `+ Open ${openCount} tables`}
                  </button>
                  {openTables.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSeatList((v) => !v)}
                      className="px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
                    >
                      {showSeatList ? 'Hide seat list' : 'Seat list'}
                    </button>
                  )}
                </div>
              )
            }
          >
            {sessionTables.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleDraw}
                  disabled={!canEdit || busy || pool.length === 0}
                  className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40 disabled:opacity-40"
                >
                  {busy ? 'Drawing…' : `Draw seats (${pool.length})`}
                </button>
                <span className="text-xs text-white/40">{tournament.maxSeatsPerTable}-handed tables</span>
                {pool.length === 0 && <span className="text-xs text-white/40">No seatable players in this session yet.</span>}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {unseated.length > 0 && (
                  <span className="text-xs text-amber-300">{unseated.length} player(s) still need a seat — pick them below.</span>
                )}
                {!confirmClear ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    disabled={!canEdit || busy}
                    className="px-4 py-2 rounded-lg text-sm text-red-300/90 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40"
                  >
                    Clear &amp; redraw…
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/70">Clear all tables for this session?</span>
                    <button type="button" onClick={handleClear} disabled={busy} className="px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-40">
                      {busy ? 'Clearing…' : 'Yes, clear'}
                    </button>
                    <button type="button" onClick={() => setConfirmClear(false)} disabled={busy} className="px-3 py-1.5 rounded text-xs text-white/60 hover:bg-white/5">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </Panel>

          {/* Balance */}
          {fillableTables(openTables).length > 1 && (
            <Panel title="Balance">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="text-white/50 text-xs font-mono">
                  {tableSizes(openTables).map((s) => `T${s.tableNumber}: ${s.size}`).join('  ·  ')}
                </span>
                {balanceMoves.length === 0 ? (
                  <span className="text-emerald-300/80 text-xs">Balanced (within ±1).</span>
                ) : !confirmBalance ? (
                  <button
                    type="button"
                    onClick={() => setConfirmBalance(true)}
                    disabled={!canEdit || busy}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40 disabled:opacity-40"
                  >
                    Balance tables ({balanceMoves.length} move{balanceMoves.length === 1 ? '' : 's'})
                  </button>
                ) : (
                  <div className="w-full">
                    <p className="text-xs text-white/60 mb-2">Move {balanceMoves.length} player(s) to even the tables:</p>
                    <ul className="text-xs text-white/70 space-y-0.5 mb-3">
                      {balanceMoves.map((m, i) => (
                        <li key={i}>
                          <span className="text-white/90">{nameForEntry(entriesById[m.entryId])}</span> — Table {m.fromTableNumber}{' '}
                          seat {m.fromSeatNumber} → Table {m.toTableNumber} seat {m.toSeatNumber}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleBalance}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 active:bg-emerald-500/40 disabled:opacity-40"
                      >
                        {busy ? 'Balancing…' : 'Confirm balance'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmBalance(false)}
                        disabled={busy}
                        className="px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-[11px] text-white/30 mt-2">
                      Rule: the highest-seat player on the fullest table fills the lowest empty seat on the emptiest — review
                      and hand-adjust afterward if needed.
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {/* Selection hint / actions for the picked-up player */}
          {selectedEntry && (
            <div className="mb-4 bg-gold-500/10 border border-gold-500/30 rounded-lg px-4 py-2.5 text-sm text-gold-200">
              {!confirmEliminate && !confirmMilestone ? (
                <div className="flex items-center justify-between gap-3">
                  <span>
                    Holding <span className="font-medium">{nameForEntry(selectedEntry)}</span> — click an empty seat to move them, or{' '}
                    <button
                      type="button"
                      onClick={() => handleUnseat(selectedEntry)}
                      disabled={busy || !selectedEntry.currentTableId}
                      className="underline disabled:no-underline disabled:opacity-40"
                    >
                      unseat
                    </button>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => setConfirmEliminate(true)}
                      disabled={busy}
                      className="underline text-red-300 hover:text-red-200 disabled:no-underline disabled:opacity-40"
                    >
                      eliminate
                    </button>
                    {isSat && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => setConfirmMilestone(true)}
                          disabled={busy}
                          className="underline text-emerald-300 hover:text-emerald-200 disabled:no-underline disabled:opacity-40"
                        >
                          milestone reached
                        </button>
                      </>
                    )}
                    .
                  </span>
                  <button type="button" onClick={() => setSelectedEntryId(null)} className="text-gold-300/70 hover:text-gold-200 text-xs shrink-0">
                    Cancel
                  </button>
                </div>
              ) : confirmMilestone ? (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="text-white/85">
                    <span className="font-medium text-white">{nameForEntry(selectedEntry)}</span> reached the milestone
                    {milestoneThreshold != null && <> ({fmtChips(milestoneThreshold)} chips)</>}? They leave the field and win a{' '}
                    <span className="font-medium text-emerald-300">{formatMoney(ticketReward)}</span> ticket — issued when the
                    cashier confirms.
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMilestone(selectedEntry)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 active:bg-emerald-500/40 disabled:opacity-40"
                    >
                      {busy ? 'Recording…' : 'Yes, milestone reached'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmMilestone(false)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded text-xs text-white/60 hover:text-white hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="text-white/85">
                    {nextPlace > 1 ? (
                      <>
                        Eliminate <span className="font-medium text-white">{nameForEntry(selectedEntry)}</span> in{' '}
                        <span className="font-medium text-white">{ordinal(nextPlace)} place</span>? They’ll leave the field and
                        show in the finishing order.
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-white">{nameForEntry(selectedEntry)}</span> is the last player standing —
                        record them as the winner via payouts, not an elimination.
                      </>
                    )}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEliminate(selectedEntry)}
                      disabled={busy || nextPlace <= 1}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30 active:bg-red-500/40 disabled:opacity-40"
                    >
                      {busy ? 'Eliminating…' : 'Yes, eliminate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmEliminate(false)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded text-xs text-white/60 hover:text-white hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mystery Bounty: post-knockout draw prompt (skippable — the draw is a
              follow-up, never a blocker; the standalone "Record draw…" button on
              the bounty board reopens it for skipped knockouts). */}
          {isMB && bountyPrompt && (
            <div className="mb-4 bg-felt-800 border border-gold-500/40 rounded-lg px-4 py-3 text-sm">
              {bountyPrompt.eliminatedEntryId === null ? (
                <>
                  <p className="text-white/80 mb-2">
                    <span className="text-gold-300 font-medium">Record a bounty draw</span> — whose knockout is it for?
                  </p>
                  {undrawnKnockouts.length === 0 ? (
                    <p className="text-xs text-white/40 mb-2">Every recorded knockout already has its bounty drawn.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {undrawnKnockouts.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setBountyPrompt({ eliminatedEntryId: e.id })}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg text-sm bg-white/5 text-white/80 hover:bg-white/10 disabled:opacity-50"
                        >
                          {nameForEntry(e)}
                          {e.finishingPlace != null && (
                            <span className="text-[10px] font-mono text-white/40 ml-1.5">{ordinal(e.finishingPlace)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setBountyPrompt(null)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded text-xs text-white/60 hover:text-white hover:bg-white/5"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <p className="text-white/80 mb-2">
                    <span className="text-gold-300 font-medium">Mystery bounty</span> — who knocked out{' '}
                    <span className="text-white font-medium">
                      {nameForEntry(entriesById[bountyPrompt.eliminatedEntryId])}
                    </span>
                    ?
                  </p>
                  {eliminatorCandidates.length === 0 ? (
                    <p className="text-xs text-white/40 mb-2">No seated players to pick from.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {eliminatorCandidates.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => handleDrawBounty(e)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg text-sm bg-gold-500/15 text-gold-200 hover:bg-gold-500/30 disabled:opacity-50"
                        >
                          {nameForEntry(e)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBountyPrompt(null)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded text-xs text-white/60 hover:text-white hover:bg-white/5"
                    >
                      Skip — no bounty / unknown eliminator
                    </button>
                    <span className="text-[11px] text-white/30">You can record it later from the bounty board.</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Close preview */}
          {breakTableId &&
            (() => {
              const t = openTables.find((x) => x.id === breakTableId)
              if (!t) return null
              return (
                <div className="mb-4 bg-felt-800 border border-red-500/30 rounded-lg px-4 py-3 text-sm">
                  <p className="text-white/80 mb-2">
                    Close <span className="text-white font-medium">Table {t.tableNumber}</span>
                    {breakMoves && breakMoves.length > 0
                      ? ` — move ${breakMoves.length} player${breakMoves.length === 1 ? '' : 's'} to the other active tables:`
                      : ' — no players to move; the table will just close.'}
                  </p>
                  {breakMoves && breakMoves.length > 0 && (
                    <ul className="text-xs text-white/70 space-y-0.5 mb-3">
                      {breakMoves.map((m, i) => (
                        <li key={i}>
                          <span className="text-white/90">{nameForEntry(entriesById[m.entryId])}</span> — seat{' '}
                          {m.fromSeatNumber} → Table {m.toTableNumber} seat {m.toSeatNumber}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBreak}
                      disabled={busy || breakMoves === null}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30 active:bg-red-500/40 disabled:opacity-40"
                    >
                      {busy ? 'Closing…' : `Confirm close of Table ${t.tableNumber}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakTableId(null)}
                      disabled={busy}
                      className="px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )
            })()}

          {/* Alternates / waitlist */}
          {openTables.length > 0 && waitlistEntries.length > 0 && (
            <Panel
              title={`Alternates / waitlist (${waitlistEntries.length})`}
              right={
                <div className="flex items-center gap-3">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={handleSeatNext}
                      disabled={busy || !nextSeat}
                      title={
                        nextSeat
                          ? 'Seat #1 in a random open seat on an active table'
                          : 'No active seat free — activate a table first'
                      }
                      className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200 disabled:text-white/30"
                    >
                      Seat next →
                    </button>
                  )}
                  <button type="button" onClick={exportAlternates} className="text-[11px] text-gold-300 hover:text-gold-200">
                    Export CSV
                  </button>
                </div>
              }
            >
              <p className="text-[11px] text-white/40 mb-2">
                #1 is next (FIFO by registration). “Seat next →” drops them in a <span className="text-white/70">random</span>{' '}
                open seat on an active table; or click a name then an empty seat to place by hand
                {nextSeat ? '' : ' — no active seat free right now'}.
              </p>
              <div className="flex flex-wrap gap-2">
                {waitlistEntries.map((e, i) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => {
                      if (!canEdit) return
                      setConfirmEliminate(false)
                      setConfirmMilestone(false)
                      setSelectedEntryId((cur) => (cur === e.id ? null : e.id))
                    }}
                    disabled={!canEdit || busy}
                    className={
                      'px-3 py-1.5 rounded-lg text-sm disabled:opacity-50 ' +
                      (selectedEntryId === e.id ? 'bg-gold-500/30 text-gold-100' : 'bg-white/5 text-white/80 hover:bg-white/10')
                    }
                  >
                    <span className="text-[10px] font-mono text-white/40 mr-1.5">#{i + 1}</span>
                    {nameForEntry(e)}
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {/* Mystery Bounty board (task 4.2): drawn bounties + the remaining-pool
              figure. Self-contained; the Phase-5 TV display reuses the same pure
              derivations (remainingBountySummary / bountyBoardRows). */}
          {isMB && (
            <Panel
              title={`Mystery bounty board${bountySummary ? ` — ${bountySummary.count} of ${bountySummary.count + bountySummary.drawnCount} undrawn` : ''}`}
              right={
                canEdit && (
                  <button
                    type="button"
                    onClick={() => setBountyPrompt({ eliminatedEntryId: null })}
                    disabled={busy || undrawnKnockouts.length === 0}
                    title={
                      undrawnKnockouts.length === 0
                        ? 'Every recorded knockout already has its bounty drawn'
                        : 'Draw a bounty for a knockout that was skipped earlier'
                    }
                    className="text-[11px] font-medium text-gold-300 hover:text-gold-200 disabled:text-white/30"
                  >
                    Record draw…
                  </button>
                )
              }
            >
              {bountySummary && (
                <p className="text-xs text-white/50 mb-3">
                  <span className="text-gold-300">{formatMoney(bountySummary.total)}</span> still in the pool
                  {' · '}
                  {formatMoney(bountySummary.drawnTotal)} drawn so far
                </p>
              )}
              {bountyRows.length === 0 ? (
                <p className="text-sm text-white/40">No bounties drawn yet — the first knockout starts the reveals.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                      <tr>
                        <th className="text-left px-2 py-1.5">Won by</th>
                        <th className="text-right px-2 py-1.5">Bounty</th>
                        <th className="text-left px-2 py-1.5">Knocked out</th>
                        <th className="text-left px-2 py-1.5">When</th>
                        <th className="text-left px-2 py-1.5">Wallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bountyRows.map((r) => (
                        <tr key={r.id} className="border-t border-white/5">
                          <td className="px-2 py-1.5 text-white/90">{r.knockerName}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gold-300">{formatMoney(r.bountyValue)}</td>
                          <td className="px-2 py-1.5 text-white/70">{r.knockedOutName}</td>
                          <td className="px-2 py-1.5 text-white/50">
                            {r.drawnAt?.toDate?.().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) ?? '—'}
                          </td>
                          <td className="px-2 py-1.5">
                            {r.isCredited ? (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/80">credited</span>
                            ) : (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">at cashier</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {/* Room overview — tables collapse to an at-a-glance ✓/✗ seat map; expand
              a card (or "Expand all") to drill into the named seats for moves. */}
          {openTables.length > 0 && (
            <section className="mb-5">
              <div className="flex items-center justify-between mb-2 gap-3">
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                  Room — {openTables.length} table{openTables.length === 1 ? '' : 's'}
                  <span className="ml-2 text-white/30 normal-case tracking-normal">✓ taken · ✗ open</span>
                </h3>
                <button
                  type="button"
                  onClick={toggleExpandAll}
                  className="text-[11px] text-white/50 hover:text-white shrink-0"
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {openTables.map((table) => {
                  const isActive = table.active !== false
                  const expanded = expandedTables.has(table.id)
                  const seatsSorted = [...table.seats].sort((a, b) => a.seatNumber - b.seatNumber)
                  return (
                    <div
                      key={table.id}
                      className={'bg-felt-800 border rounded-lg p-4 ' + (isActive ? 'border-white/5' : 'border-amber-500/20 opacity-70')}
                    >
                      {/* Header: table number + occupancy */}
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-display text-lg text-gold-300">Table {table.tableNumber}</span>
                          {!isActive && (
                            <span className="text-[9px] font-mono uppercase tracking-widest text-amber-300/80 bg-amber-500/10 rounded px-1.5 py-0.5">
                              deactivated
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                          {occupiedSeatCount(table)}/{table.seatCount}
                        </span>
                      </div>

                      {/* Table-level actions + expand toggle */}
                      <div className="flex items-center gap-2 mb-3">
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSetActive(table.id, !isActive)}
                              disabled={busy}
                              className={
                                'px-3 py-2 min-h-[44px] rounded text-xs font-medium disabled:opacity-30 ' +
                                (isActive
                                  ? 'text-amber-300/80 bg-amber-500/10 hover:bg-amber-500/20'
                                  : 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25')
                              }
                            >
                              {isActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setBreakTableId(table.id)}
                              disabled={busy || !canBreakTable(openTables, table.id)}
                              title={
                                canBreakTable(openTables, table.id)
                                  ? 'Close this table (move any players to the other active tables)'
                                  : 'Nowhere to move the players — activate another table first'
                              }
                              className="px-3 py-2 min-h-[44px] rounded text-xs font-medium text-red-300/80 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-30"
                            >
                              Close
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleExpand(table.id)}
                          className="ml-auto text-[10px] font-mono uppercase tracking-wider text-white/40 hover:text-white/80"
                        >
                          {expanded ? 'Hide seats' : 'Show seats'}
                        </button>
                      </div>

                      {/* At-a-glance ✓/✗ seat map (always shown). Click a seat to pick up
                          a player or drop the held one — same as the named list below. */}
                      <div className="flex flex-wrap gap-2">
                        {seatsSorted.map((seat) => {
                          const occupied = !!seat.entryId
                          const isSel = occupied && seat.entryId === selectedEntryId
                          // Deactivated tables aren't a placement target: empty seats are
                          // display-only, but a seated player can still be picked up to move.
                          const interactive = canEdit && (occupied || isActive)
                          const pipClass = isSel
                            ? 'bg-gold-500/30 text-gold-100 border-gold-400/50'
                            : occupied
                              ? 'bg-white/10 text-white/80 border-white/10 hover:bg-white/15'
                              : isActive && selectedEntry
                                ? 'bg-emerald-500/10 text-emerald-200/90 border-emerald-500/30 hover:bg-emerald-500/20'
                                : 'bg-felt-900/40 text-white/25 border-white/5'
                          return (
                            <button
                              key={seat.seatNumber}
                              type="button"
                              onClick={() => interactive && handleSeatClick(table, seat)}
                              disabled={!interactive || busy}
                              title={occupied ? nameForEntry(entriesById[seat.entryId]) : `Seat ${seat.seatNumber} — empty`}
                              className={
                                // 44px-min tap target — this pip is the TD's primary seating
                                // control on the iPad (iPad pass 2026-08-10, finding B1)
                                'w-11 min-h-[44px] rounded border flex flex-col items-center justify-center py-2 disabled:cursor-default ' +
                                pipClass
                              }
                            >
                              <span className="text-[9px] font-mono leading-none opacity-70">{seat.seatNumber}</span>
                              <span className="text-sm leading-none mt-0.5">{occupied ? '✓' : '✗'}</span>
                            </button>
                          )
                        })}
                      </div>

                      {/* Drill-down: the named seat list, for reading who's where + moves */}
                      {expanded && (
                        <ul className="mt-3 pt-3 border-t border-white/5 space-y-1">
                          {seatsSorted.map((seat) => {
                            const occupied = !!seat.entryId
                            const isSel = occupied && seat.entryId === selectedEntryId
                            const interactive = canEdit && (occupied || isActive)
                            return (
                              <li key={seat.seatNumber}>
                                <button
                                  type="button"
                                  onClick={() => interactive && handleSeatClick(table, seat)}
                                  disabled={!interactive || busy}
                                  className={
                                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left disabled:opacity-60 ' +
                                    (occupied
                                      ? isSel
                                        ? 'bg-gold-500/30 text-gold-100'
                                        : 'bg-felt-900/60 text-white/90 hover:bg-white/10'
                                      : isActive && selectedEntry
                                        ? 'bg-emerald-500/10 text-emerald-200/90 hover:bg-emerald-500/20'
                                        : 'bg-felt-900/40 text-white/30')
                                  }
                                >
                                  <span className="text-[10px] font-mono text-white/40 w-4 shrink-0">{seat.seatNumber}</span>
                                  <span className="truncate flex-1">
                                    {occupied ? nameForEntry(entriesById[seat.entryId]) : isActive && selectedEntry ? 'seat here' : 'empty'}
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Seat list (printable data) */}
          {showSeatList && openTables.length > 0 && (
            <Panel
              title="Seat list"
              right={
                <button type="button" onClick={exportSeatList} className="text-[11px] text-gold-300 hover:text-gold-200">
                  Export CSV
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                    <tr>
                      <th className="text-left px-2 py-1.5">Table</th>
                      <th className="text-left px-2 py-1.5">Seat</th>
                      <th className="text-left px-2 py-1.5">Player</th>
                      <th className="text-right px-2 py-1.5">Starting stack</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildSeatList({ tables: openTables, entriesById, playersById, tournament }).map((r) => (
                      <tr key={`${r.tableNumber}-${r.seatNumber}`} className="border-t border-white/5">
                        <td className="px-2 py-1.5 text-white/70">{r.tableNumber}</td>
                        <td className="px-2 py-1.5 text-white/70">{r.seatNumber}</td>
                        <td className="px-2 py-1.5 text-white/90">{r.playerName}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-white/70">{fmtChips(r.startingStack)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          {/* Mystery Bounty reveal — the table-side moment. Full-screen so the
              amount is unmissable; dismiss by clicking anywhere or "Done". */}
          {bountyReveal && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6"
              role="dialog"
              aria-modal="true"
              aria-label="Mystery bounty drawn"
              onClick={() => setBountyReveal(null)}
            >
              <div
                className="bg-felt-800 border border-gold-500/40 rounded-2xl px-8 py-10 md:px-16 md:py-12 text-center max-w-xl w-full shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-[11px] font-mono uppercase tracking-[0.3em] text-gold-300/70 mb-3">Mystery bounty</p>
                <p className="font-display text-6xl md:text-7xl text-gold-300 tabular-nums mb-4">
                  {formatMoney(bountyReveal.amount)}
                </p>
                <p className="text-lg text-white/90 mb-1">
                  <span className="font-medium">{bountyReveal.knockerName}</span> wins the bounty
                </p>
                <p className="text-xs text-white/40 mb-6">
                  {bountyReveal.remainingCount} bount{bountyReveal.remainingCount === 1 ? 'y' : 'ies'} ·{' '}
                  {formatMoney(bountyReveal.remainingTotal)} left in the pool · paid when the cashier confirms
                </p>
                <button
                  type="button"
                  onClick={() => setBountyReveal(null)}
                  className="px-6 py-2.5 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
