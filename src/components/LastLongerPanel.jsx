// Last-longer (Upper Deck / Main Deck) settlement panel — Phase 4 task 4.3.
// Self-contained: rendered on the tournament detail Players tab when the
// tournament has hasUpperDeckMainDeck. One card per deck: who opted in, the
// derived winner-apparent (or why it's undetermined), settle with an inline
// confirm, a manual pick for when the derivation is wrong (busts recorded out
// of order), and an undo on the settled state. The app records the winner —
// the side-pot money itself is handled at the venue.

import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useToast } from '../shell/useToast'
import {
  LAST_LONGER_DECKS,
  lastLongerDeckLabel,
  deriveLastLongerStatus,
  lastLongerReasonLabel,
  settleLastLonger,
  unsettleLastLonger,
  TournamentError,
} from '../lib/tournaments'

const smallBtn =
  'text-xs px-3 py-1.5 rounded-lg border bg-white/5 text-white/80 hover:bg-white/10 border-white/10 disabled:opacity-40'
const goldBtn =
  'text-xs px-3 py-1.5 rounded-lg border bg-gold-500/20 text-gold-100 hover:bg-gold-500/30 border-gold-500/40 disabled:opacity-40'

export default function LastLongerPanel({ tournament, entries, nameOf, onChanged }) {
  const { user, role } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const canSettle = role === 'manager' || role === 'td'

  async function run(op, successMsg) {
    setBusy(true)
    try {
      await op()
      toast.success(successMsg)
      onChanged?.()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Something went wrong: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const settle = (deck, chosenEntryId = null) =>
    run(
      () => settleLastLonger({ tournament, deck, entries, chosenEntryId, actorId: user.uid, actorRole: role }),
      `${lastLongerDeckLabel(deck)} last-longer settled.`
    )
  const unsettle = (deck) =>
    run(
      () => unsettleLastLonger({ tournament, deck, entries, actorId: user.uid, actorRole: role }),
      `${lastLongerDeckLabel(deck)} settlement undone.`
    )

  return (
    <section>
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">
        Last longer — Upper / Main deck
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {LAST_LONGER_DECKS.map((deck) => (
          <DeckCard
            key={deck}
            deck={deck}
            status={deriveLastLongerStatus(entries, deck)}
            nameOf={nameOf}
            canSettle={canSettle}
            busy={busy}
            onSettle={(chosenEntryId) => settle(deck, chosenEntryId)}
            onUnsettle={() => unsettle(deck)}
          />
        ))}
      </div>
      <p className="text-[11px] text-white/55 mt-2">
        The winner is recorded here; the side pot itself is paid out at the venue.
      </p>
    </section>
  )
}

function DeckCard({ deck, status, nameOf, canSettle, busy, onSettle, onUnsettle }) {
  const [confirm, setConfirm] = useState(null) // null | 'settle' | 'undo' | { pick: entryId }
  const { participants, settledWinner, derivedWinner, determinable, reason } = status
  const [picking, setPicking] = useState(false)
  const [pickId, setPickId] = useState('')

  const pickable = participants.filter((e) => e.id !== derivedWinner?.id)
  const closePick = () => {
    setPicking(false)
    setPickId('')
    setConfirm(null)
  }

  return (
    <div className="bg-felt-800 border border-white/5 rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium text-white/90">{lastLongerDeckLabel(deck)}</span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/45">
          {participants.length} player{participants.length === 1 ? '' : 's'}
        </span>
      </div>

      {participants.length > 0 && (
        <p className="text-xs text-white/65 mb-2">{participants.map((e) => nameOf(e)).join(', ')}</p>
      )}

      {settledWinner ? (
        <div className="mt-1">
          <div className="text-sm text-emerald-300">
            Winner: <span className="font-medium">{nameOf(settledWinner)}</span>
          </div>
          {canSettle &&
            (confirm === 'undo' ? (
              <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-white/70">
                <span>Undo this settlement?</span>
                <button type="button" disabled={busy} onClick={() => { setConfirm(null); onUnsettle() }} className={goldBtn}>
                  Yes — undo
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={smallBtn}>
                  No
                </button>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirm('undo')} className={`${smallBtn} mt-2`}>
                Undo settlement
              </button>
            ))}
        </div>
      ) : (
        <div className="mt-1">
          {determinable ? (
            <div className="text-sm text-white/80">
              Winner apparent: <span className="text-gold-300 font-medium">{nameOf(derivedWinner)}</span>
            </div>
          ) : (
            <div className="text-sm text-white/55">
              Undetermined <span className="block text-xs mt-0.5 text-white/50">{lastLongerReasonLabel(reason)}</span>
            </div>
          )}

          {canSettle && (
            <div className="mt-2">
              {confirm === 'settle' ? (
                <div className="flex items-center gap-2 flex-wrap text-xs text-white/70">
                  <span>
                    Settle {lastLongerDeckLabel(deck)} — winner {nameOf(derivedWinner)}?
                  </span>
                  <button type="button" disabled={busy} onClick={() => { setConfirm(null); onSettle(null) }} className={goldBtn}>
                    Yes — settle
                  </button>
                  <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={smallBtn}>
                    No
                  </button>
                </div>
              ) : picking ? (
                <div className="flex items-end gap-2 flex-wrap">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/55">Winner</span>
                    <select
                      value={pickId}
                      onChange={(e) => setPickId(e.target.value)}
                      disabled={busy}
                      className="bg-felt-900 border border-white/10 rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">— choose —</option>
                      {participants.map((e) => (
                        <option key={e.id} value={e.id}>
                          {nameOf(e)}
                          {e.id === derivedWinner?.id ? ' (derived)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !pickId}
                    onClick={() => {
                      const id = pickId
                      closePick()
                      onSettle(id)
                    }}
                    className={goldBtn}
                  >
                    Settle with this winner
                  </button>
                  <button type="button" disabled={busy} onClick={closePick} className={smallBtn}>
                    Cancel
                  </button>
                  {derivedWinner && pickId && pickId !== derivedWinner.id && (
                    <p className="w-full text-[11px] text-amber-300/80">
                      Overrides the derived winner ({nameOf(derivedWinner)}) — recorded in the audit log.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {determinable && (
                    <button type="button" disabled={busy} onClick={() => setConfirm('settle')} className={goldBtn}>
                      Settle winner
                    </button>
                  )}
                  {participants.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPicking(true)
                        setPickId(derivedWinner?.id ?? '')
                      }}
                      className={smallBtn}
                    >
                      {determinable && pickable.length > 0 ? 'Pick a different winner…' : 'Pick the winner manually…'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
