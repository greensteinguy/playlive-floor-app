// Player App request queues (Phase 6.2): registration requests the instant
// wallet-paid path couldn't take, and account-link requests phone auto-match
// couldn't settle. Both are CREATED by Cloud Functions; this screen is where
// the desk resolves them.
//
//  - Registration request → staff register the player through the normal
//    tournament registration screen (taking payment at the desk), then mark
//    the request confirmed here (the confirm action looks up the entry and
//    stamps entryId). Or cancel with a reason.
//  - Link request → staff pick the matching player (creating them first if
//    needed) and resolve via the resolveLinkRequest callable — the custom
//    claim can only be stamped server-side. Or reject with a note.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useAppRequests } from '../../hooks/useAppRequests'
import { usePlayers } from '../../hooks/usePlayers'
import {
  registrationRequests as regReqApi,
  entries as entriesApi,
} from '../../lib/firestore'
import { fns } from '../../firebase/config'
import { playerDisplayName } from '../../lib/players'
import { formatMoney } from '../../lib/money'
import { Text, EmptyState } from '../../components/FormFields'
import PlayerPicker from '../../components/PlayerPicker'

const REASON_LABELS = {
  insufficientBalance: 'Wallet balance too low — take payment at the desk',
  multiSession: 'Multi-day event — pick the flight with the player',
  playerChoice: 'Player chose to pay at the desk',
  noMatch: 'No player record matched the phone number',
  multipleMatches: 'Several player records share this phone number',
  matchedPlayerAlreadyLinked: 'The matching player is already linked to another account',
}

function fmtWhen(ts) {
  const d = ts?.toDate ? ts.toDate() : ts
  return d
    ? d.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '—'
}

export default function AppRequests() {
  const { user, role } = useAuth()
  const toast = useToast()
  const { regRequests, linkRequests, playersById, tournamentsById, loading, error, mockMode } =
    useAppRequests()
  const { players: allPlayers } = usePlayers()

  const [busyId, setBusyId] = useState(null)
  const [cancelFor, setCancelFor] = useState(null) // regRequest being cancelled
  const [cancelReason, setCancelReason] = useState('')
  const [linkFor, setLinkFor] = useState(null) // linkRequest being resolved
  const [rejectFor, setRejectFor] = useState(null)
  const [rejectNote, setRejectNote] = useState('')

  const candidateFirst = useMemo(() => {
    if (!linkFor) return allPlayers
    const inCandidates = new Set(linkFor.candidatePlayerIds)
    return [...allPlayers].sort((a, b) => (inCandidates.has(b.id) ? 1 : 0) - (inCandidates.has(a.id) ? 1 : 0))
  }, [allPlayers, linkFor])

  async function markConfirmed(req) {
    setBusyId(req.id)
    try {
      const entries = await entriesApi.listEntries(req.tournamentId)
      const entry = entries.find((e) => e.playerId === req.playerId && e.voidedAt === null)
      if (!entry) {
        toast.error('No entry found for this player yet — register them first, then confirm.')
        return
      }
      const now = new Date()
      await regReqApi.updateRegistrationRequest(req.id, {
        state: 'confirmed',
        entryId: entry.id,
        resolvedBy: user.uid,
        resolvedAt: now,
        updatedAt: now,
      })
      toast.success('Registration request confirmed.')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function cancelRequest() {
    if (!cancelFor || cancelReason.trim() === '') return
    setBusyId(cancelFor.id)
    try {
      const now = new Date()
      await regReqApi.updateRegistrationRequest(cancelFor.id, {
        state: 'cancelled',
        cancelReason: cancelReason.trim(),
        resolvedBy: user.uid,
        resolvedAt: now,
        updatedAt: now,
      })
      toast.success('Request cancelled.')
      setCancelFor(null)
      setCancelReason('')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function resolveLink(player) {
    if (!linkFor) return
    setBusyId(linkFor.id)
    try {
      await httpsCallable(fns, 'resolveLinkRequest')({ linkRequestId: linkFor.id, playerId: player.id })
      toast.success(`Linked ${playerDisplayName(player)} to the app account.`)
      setLinkFor(null)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function rejectLink() {
    if (!rejectFor) return
    setBusyId(rejectFor.id)
    try {
      await httpsCallable(fns, 'resolveLinkRequest')({
        linkRequestId: rejectFor.id,
        reject: true,
        note: rejectNote.trim() || null,
      })
      toast.success('Link request rejected.')
      setRejectFor(null)
      setRejectNote('')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (mockMode) return <EmptyState title="Mock mode" body="App requests need the emulator or production Firestore." />

  return (
    <div className="px-6 py-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">App requests</h1>
        <p className="text-sm text-white/70 mt-1">
          Registrations and account links started in the Player App that need the desk.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">Error: {error.message}</p>}
      {loading && <p className="text-sm text-white/70 font-mono">Loading…</p>}

      {/* ── Registration requests ─────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-white">
          Registration requests
          {regRequests.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
              {regRequests.length} pending
            </span>
          )}
        </h2>
        {regRequests.length === 0 && !loading ? (
          <p className="text-sm text-white/65">No pending registration requests.</p>
        ) : (
          <div className="space-y-2">
            {regRequests.map((req) => {
              const player = playersById[req.playerId]
              const tournament = tournamentsById[req.tournamentId]
              return (
                <div key={req.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <p className="text-white font-medium">
                      {player ? playerDisplayName(player) : req.playerId}
                      <span className="text-white/65 font-normal"> → {tournament?.name ?? req.tournamentId}</span>
                    </p>
                    <p className="text-sm text-amber-300/90 mt-0.5">{REASON_LABELS[req.reason] ?? req.reason}</p>
                    <p className="text-xs text-white/65 font-mono mt-1">
                      requested {fmtWhen(req.requestedAt)}
                      {tournament && <> · buy-in {formatMoney((tournament.buyIn ?? 0) + (tournament.hospitalityCost ?? 0))}</>}
                      {player && <> · wallet {formatMoney(player.walletBalance ?? 0)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/td/tournaments/${req.tournamentId}/register`}
                      className="rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white hover:bg-white/15"
                    >
                      Open registration →
                    </Link>
                    <button
                      onClick={() => markConfirmed(req)}
                      disabled={busyId === req.id}
                      className="rounded-lg bg-emerald-600/80 px-4 py-2.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      Mark confirmed
                    </button>
                    <button
                      onClick={() => { setCancelFor(req); setCancelReason('') }}
                      disabled={busyId === req.id}
                      className="rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white/80 hover:bg-white/15 disabled:opacity-50"
                    >
                      Cancel…
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Account-link requests ─────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-white">
          Account-link requests
          {linkRequests.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
              {linkRequests.length} pending
            </span>
          )}
        </h2>
        {linkRequests.length === 0 && !loading ? (
          <p className="text-sm text-white/65">No pending link requests.</p>
        ) : (
          <div className="space-y-2">
            {linkRequests.map((req) => (
              <div key={req.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-white font-medium font-mono">{req.phone}</p>
                  <p className="text-sm text-amber-300/90 mt-0.5">{REASON_LABELS[req.reason] ?? req.reason}</p>
                  <p className="text-xs text-white/65 font-mono mt-1">
                    requested {fmtWhen(req.requestedAt)}
                    {req.candidatePlayerIds.length > 0 && (
                      <> · candidates: {req.candidatePlayerIds.map((pid) => playersById[pid] ? playerDisplayName(playersById[pid]) : pid).join(', ')}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLinkFor(req)}
                    disabled={busyId === req.id}
                    className="rounded-lg bg-emerald-600/80 px-4 py-2.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    Link player…
                  </button>
                  <button
                    onClick={() => { setRejectFor(req); setRejectNote('') }}
                    disabled={busyId === req.id}
                    className="rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white/80 hover:bg-white/15 disabled:opacity-50"
                  >
                    Reject…
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-white/65">
          Verify the person at the desk before linking — the linked account sees the player's wallet.
          Create the player first (<Link to="/desk/players/new" className="underline">new player</Link>) if they're not in the system.
        </p>
      </section>

      {/* ── Cancel dialog ─────────────────────────────────────────────── */}
      {cancelFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCancelFor(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg text-white">Cancel registration request</h3>
            <Text label="Reason (required)" value={cancelReason} onChange={setCancelReason} placeholder="e.g. player changed their mind" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setCancelFor(null)} className="rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white/80">Keep request</button>
              <button
                onClick={cancelRequest}
                disabled={cancelReason.trim() === '' || busyId === cancelFor.id}
                className="rounded-lg bg-red-600/80 px-4 py-2.5 text-sm text-white disabled:opacity-50"
              >
                Cancel request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link player dialog ────────────────────────────────────────── */}
      {linkFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setLinkFor(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-900 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg text-white">Link {linkFor.phone} to a player</h3>
            <PlayerPicker players={candidateFirst} onSelect={resolveLink} action="Link" emptyHint="No players found — create the player first." />
            <div className="flex justify-end">
              <button onClick={() => setLinkFor(null)} className="rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white/80">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject dialog ─────────────────────────────────────────────── */}
      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setRejectFor(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg text-white">Reject link request</h3>
            <Text label="Note (optional)" value={rejectNote} onChange={setRejectNote} placeholder="e.g. could not verify identity" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRejectFor(null)} className="rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white/80">Back</button>
              <button
                onClick={rejectLink}
                disabled={busyId === rejectFor.id}
                className="rounded-lg bg-red-600/80 px-4 py-2.5 text-sm text-white disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {role === 'readonly' && <p className="text-xs text-white/65">Read-only role: actions are disabled by the rules layer.</p>}
    </div>
  )
}
