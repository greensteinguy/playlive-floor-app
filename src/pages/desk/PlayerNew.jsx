// New player quick-create (task 3.3). A short single-page form — first / last /
// phone are required, the rest optional — reached from the player search page's
// "+ New player" button. Manager + cashier only (the route is role-gated; in
// pure-mock mode the write is disabled with a note, since createPlayer needs the
// emulator or production to persist).
//
// On success it opens the new player's detail page. Saves go through the
// createPlayer domain op (full-doc validation + best-effort player.created audit).

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { createPlayer, playerDisplayName, PlayerError } from '../../lib/players'
import { ValidationError, WriteTimeoutError } from '../../lib/firestore'
import { emptyPlayerForm, validatePlayerForm, buildPlayerArgs } from '../../lib/playerForm'
import PlayerProfileFields from '../../components/PlayerProfileFields'
import { USE_MOCK_DATA, USE_EMULATOR } from '../../firebase/config'

const LIVE_WRITES = !USE_MOCK_DATA || USE_EMULATOR

export default function PlayerNew() {
  const navigate = useNavigate()
  const { user, role } = useAuth()
  const toast = useToast()

  const [form, setForm] = useState(emptyPlayerForm)
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const disabled = saving || !LIVE_WRITES

  async function handleCreate() {
    const err = validatePlayerForm(form)
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      const created = await createPlayer({
        ...buildPlayerArgs(form),
        actorId: user.uid,
        actorRole: role,
      })
      toast.success(`Created ${playerDisplayName(created)}.`)
      navigate(`/desk/players/${created.id}`)
    } catch (e) {
      toast.error(
        e instanceof PlayerError || e instanceof ValidationError || e instanceof WriteTimeoutError
          ? e.message
          : `Create failed: ${e.message}`
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-3xl">
      <button
        type="button"
        onClick={() => navigate('/desk/players')}
        className="text-sm text-white/50 hover:text-white mb-4"
      >
        ← Back to players
      </button>

      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-display text-3xl md:text-4xl text-gold-400">New player</h1>
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap">
          Phase 3 — task 3.3
        </span>
      </div>
      <p className="text-white/50 text-sm mb-6">
        First name, last name, and phone are required. Everything else can be added later.
      </p>

      {!LIVE_WRITES && (
        <div className="bg-felt-800 border border-amber-500/30 rounded-lg px-4 py-2 mb-5 text-xs text-amber-200/80">
          Mock mode — creating a player needs the Firestore emulator or production. Inputs are disabled.
        </div>
      )}

      <PlayerProfileFields form={form} set={set} disabled={disabled} />

      <div className="flex items-center justify-end gap-3 mt-6">
        <button
          type="button"
          onClick={() => navigate('/desk/players')}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={disabled}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 active:bg-gold-500/40 disabled:opacity-40"
        >
          {saving ? 'Creating…' : 'Create player'}
        </button>
      </div>
    </div>
  )
}
