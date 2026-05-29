// Blind-structure template management (manager-only). List ↔ editor toggled
// in-page (no extra routes), mirroring the Dedupe page. The editor reuses the
// shared StructureEditor component (also used by the create wizard in task 2.1).

import { useState } from 'react'
import { useAuth } from '../../../auth/useAuth'
import { useToast } from '../../../shell/useToast'
import { useStructureTemplates } from '../../../hooks/useTemplates'
import StructureEditor from '../../../components/StructureEditor'
import { Structure } from '../../../lib/schema'
import {
  createStructureTemplate,
  updateStructureTemplate,
  archiveStructureTemplate,
  TournamentError,
} from '../../../lib/tournaments'
import { downloadCsv, csvFilename } from '../../../lib/csv'

const CSV_COLUMNS = [
  { key: 'id', label: 'Template ID' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'levelCount', label: 'Levels' },
  { key: 'breakCount', label: 'Breaks' },
  { key: 'totalMinutes', label: 'Total minutes' },
  { key: 'createdAt', label: 'Created at' },
]

function levelCountOf(t) {
  return t.levels.filter((e) => e.type === 'level').length
}
function breakCountOf(t) {
  return t.levels.filter((e) => e.type === 'break').length
}
function totalMinutesOf(t) {
  return t.levels.reduce((sum, e) => sum + (Number(e.durationMinutes) || 0), 0)
}
function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export default function StructureTemplatesPanel() {
  const { templates, loading, error, mockMode, reload } = useStructureTemplates()
  const toast = useToast()
  const [editing, setEditing] = useState(null) // null = list view; {} = new; {id,...} = edit

  function handleExport() {
    if (templates.length === 0) {
      toast.info('Nothing to export — no structure templates yet.')
      return
    }
    const rows = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      levelCount: levelCountOf(t),
      breakCount: breakCountOf(t),
      totalMinutes: totalMinutesOf(t),
      createdAt: t.createdAt,
    }))
    downloadCsv(rows, CSV_COLUMNS, csvFilename('structure-templates'))
    toast.success(`Exported ${rows.length} template${rows.length === 1 ? '' : 's'} to CSV.`)
  }

  if (editing !== null) {
    return (
      <StructureTemplateEditor
        template={editing.id ? editing : null}
        onDone={() => {
          setEditing(null)
          reload()
        }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  if (mockMode) {
    return (
      <EmptyState
        title="Mock mode — no template data available."
        body="Run npm run emulator + npm run seed:templates to populate the local Firestore emulator, then reload. You can still build a template below; it just won't persist in mock mode."
      />
    )
  }
  if (error) return <EmptyState title="Couldn't load structure templates." body={error.message} tone="error" />
  if (loading) return <div className="py-12 text-center text-white/40 text-sm">Loading…</div>

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="text-xs text-white/40 font-mono">
          {templates.length} active template{templates.length === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setEditing({})}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 hover:bg-gold-500/25 active:bg-gold-500/35"
          >
            + New structure
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          title="No structure templates yet."
          body="Create a reusable blind structure here, then pick it when creating a tournament."
        />
      ) : (
        <div className="bg-felt-800 border border-white/5 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-felt-900/60 text-[10px] font-mono uppercase tracking-widest text-white/40">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2 whitespace-nowrap">Levels</th>
                <th className="text-left px-4 py-2 whitespace-nowrap">Duration</th>
                <th className="text-left px-4 py-2">Description</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-white/90">{t.name}</td>
                  <td className="px-4 py-3 text-white/70">
                    {levelCountOf(t)}
                    {breakCountOf(t) > 0 ? ` (+${breakCountOf(t)} brk)` : ''}
                  </td>
                  <td className="px-4 py-3 text-white/70 whitespace-nowrap">~{fmtDuration(totalMinutesOf(t))}</td>
                  <td className="px-4 py-3 text-xs text-white/50 max-w-xs truncate">{t.description ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      className="px-3 py-1.5 rounded text-xs bg-white/5 text-white/70 hover:bg-white/10 hover:text-white active:bg-white/15"
                    >
                      Edit →
                    </button>
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

function StructureTemplateEditor({ template, onDone, onCancel }) {
  const { user, role } = useAuth()
  const toast = useToast()
  const isEdit = Boolean(template)

  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [levels, setLevels] = useState(template?.levels ?? [])
  const [submitting, setSubmitting] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const structureValid = Structure.safeParse(levels).success
  const canSave = name.trim() !== '' && levels.length > 0 && structureValid && !submitting

  async function handleSave() {
    if (!canSave) {
      if (name.trim() === '') toast.error('Name is required.')
      else if (levels.length === 0) toast.error('Add at least one level.')
      else if (!structureValid) toast.error('Structure has validation errors — fix the highlighted rows.')
      return
    }
    setSubmitting(true)
    try {
      const args = {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        levels,
        actorId: user.uid,
        actorRole: role,
      }
      if (isEdit) {
        await updateStructureTemplate({ id: template.id, patch: args, actorId: user.uid, actorRole: role })
        toast.success(`Updated "${args.name}".`)
      } else {
        await createStructureTemplate(args)
        toast.success(`Created "${args.name}".`)
      }
      onDone()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Save failed: ${e.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleArchive() {
    setSubmitting(true)
    try {
      await archiveStructureTemplate({ id: template.id, actorId: user.uid, actorRole: role })
      toast.success(`Archived "${template.name}".`)
      onDone()
    } catch (e) {
      toast.error(e instanceof TournamentError ? e.message : `Archive failed: ${e.message}`)
    } finally {
      setSubmitting(false)
      setConfirmArchive(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <button type="button" onClick={onCancel} className="text-sm text-white/50 hover:text-white mb-4">
        ← Back to structures
      </button>

      <h2 className="font-display text-2xl text-white mb-4">
        {isEdit ? `Edit structure — ${template.name}` : 'New blind structure'}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Friday Deepstack"
            disabled={submitting}
            className="bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">Description (optional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short note for the floor"
            disabled={submitting}
            className="bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mb-6">
        <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">Levels & breaks</div>
        <StructureEditor value={levels} onChange={setLevels} disabled={submitting} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className={
            'px-4 py-2 rounded-lg text-sm font-medium ' +
            (canSave
              ? 'bg-gold-500/20 text-gold-200 hover:bg-gold-500/30'
              : 'bg-white/5 text-white/30 cursor-not-allowed')
          }
        >
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create structure'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5"
        >
          Cancel
        </button>

        {isEdit && (
          <div className="ml-auto">
            {confirmArchive ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/60">Archive this structure?</span>
                <button
                  type="button"
                  onClick={handleArchive}
                  disabled={submitting}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                  disabled={submitting}
                  className="px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                disabled={submitting}
                className="px-3 py-2 rounded-lg text-xs text-red-300/70 hover:text-red-200 hover:bg-red-500/10"
              >
                Archive
              </button>
            )}
          </div>
        )}
      </div>
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
