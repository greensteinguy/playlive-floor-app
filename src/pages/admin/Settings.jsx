// Manager-only venue settings. Today: the chip denominations that physically
// exist at the venue (Guy, 6 Oct 2026). Structures pick their smallest chip
// from this list and the structure editor checks blinds against it.

import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useToast } from '../../shell/useToast'
import { useVenueSettings } from '../../hooks/useVenueSettings'
import { venueSettings as venueSettingsApi } from '../../lib/firestore'
import { DEFAULT_CHIP_DENOMINATIONS, normaliseChips } from '../../lib/chips'
import { EmptyState } from '../../components/FormFields'

const fmt = (n) => n.toLocaleString('en-AU')

export default function Settings() {
  const { user } = useAuth()
  const toast = useToast()
  const { chipDenominations, isDefault, loading, error, mockMode } = useVenueSettings()
  // null = untouched, so the list tracks the live doc until the manager edits.
  const [draft, setDraft] = useState(null)
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)

  const chips = draft ?? chipDenominations
  const dirty = draft != null && draft.join(',') !== chipDenominations.join(',')
  const addValue = parseInt(adding, 10)
  const addValid = /^\d+$/.test(adding.trim()) && addValue > 0 && !chips.includes(addValue)

  const add = () => {
    if (!addValid) return
    setDraft(normaliseChips([...chips, addValue]))
    setAdding('')
  }
  const remove = (c) => setDraft(chips.filter((x) => x !== c))

  const save = async () => {
    setBusy(true)
    try {
      await venueSettingsApi.saveVenueSettings({ chipDenominations: chips }, user.uid)
      setDraft(null)
      toast.success('Chip denominations saved.')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-6 py-8 md:px-10 md:py-10 max-w-3xl">
      <h1 className="font-display text-3xl md:text-4xl text-gold-400 mb-2">Settings</h1>
      <p className="text-white/65 text-sm mb-6">Venue-wide configuration. Changes apply to every tournament and template.</p>

      {loading ? (
        <div className="py-12 text-center text-white/55 text-sm">Loading…</div>
      ) : error ? (
        <EmptyState title="Couldn't load settings." body={error.message} tone="error" />
      ) : (
        <section>
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/55 mb-2">Chip denominations</h3>
          <div className="bg-felt-800 border border-white/5 rounded-lg p-4 space-y-4">
            <p className="text-xs text-white/65">
              Every chip value in the venue&apos;s cases. Each blind structure picks its smallest chip from this list; every
              colour-up then removes the smallest chip still in play. Blinds that can&apos;t be made from the chips in play
              are highlighted in the structure editor.
            </p>

            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-gold-500/10 border border-gold-500/30 text-gold-200 text-sm tabular-nums"
                >
                  {fmt(c)}
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    disabled={busy || mockMode || chips.length <= 1}
                    aria-label={`Remove ${fmt(c)} chip`}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-30"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    add()
                  }
                }}
                disabled={busy || mockMode}
                placeholder="e.g. 25"
                aria-label="New chip value"
                className="w-28 px-3 py-2 rounded-lg text-sm bg-felt-900 border border-white/10 text-white/90 disabled:opacity-40"
              />
              <button
                type="button"
                onClick={add}
                disabled={busy || mockMode || !addValid}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40"
              >
                + Add chip
              </button>
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_CHIP_DENOMINATIONS)}
                disabled={busy || mockMode}
                className="px-3 py-2 rounded-lg text-xs font-medium text-white/55 hover:text-white/80"
              >
                Reset to defaults
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || mockMode || !(dirty || isDefault)}
                className="ml-auto px-4 py-2 rounded-lg text-sm font-medium bg-gold-500/20 text-gold-200 hover:bg-gold-500/30 disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>

            {mockMode ? (
              <p className="text-[11px] text-white/45">Mock mode — showing the defaults; saving needs Firestore.</p>
            ) : isDefault && !dirty ? (
              <p className="text-[11px] text-amber-200/80">Using the built-in defaults — nothing saved for this venue yet.</p>
            ) : null}
          </div>
        </section>
      )}
    </div>
  )
}
