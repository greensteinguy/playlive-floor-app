// Tournament status metadata — human label + badge styling per Status enum value
// (see schema/tournament.js). Shared by the list page and the detail page; lives
// here (not alongside the StatusBadge component) so the component file stays
// component-only for Fast Refresh. Mirrors the gameTypes.js label-map convention.

export const STATUS_META = {
  draft:         { label: 'Draft',           badge: 'bg-white/10 text-white/60' },
  scheduled:     { label: 'Scheduled',       badge: 'bg-sky-500/15 text-sky-300' },
  lateRegOpen:   { label: 'Late reg open',   badge: 'bg-emerald-500/20 text-emerald-300' },
  lateRegClosed: { label: 'Late reg closed', badge: 'bg-amber-500/20 text-amber-200' },
  finished:      { label: 'Finished',        badge: 'bg-white/5 text-white/40' },
  cancelled:     { label: 'Cancelled',       badge: 'bg-red-500/15 text-red-300' },
}

export function statusLabel(status) {
  return STATUS_META[status]?.label ?? status
}

// ── Status-transition model (task 2.7 — floor controls) ─────────────────────
// The standard floor sequence: draft → scheduled → lateRegOpen → lateRegClosed →
// finished, with `cancelled` reachable from any non-terminal status (a normal
// floor action). Anything NOT listed in DEFAULT_TRANSITIONS is a NON-STANDARD
// transition (e.g. reopening late reg, un-finishing, un-publishing) that the
// domain op only permits with a manager override. `finished` and `cancelled`
// are terminal — no default way out (a manager can still override). The UI uses
// these to render the right buttons; setTournamentStatus enforces them.

export const ALL_STATUSES = ['draft', 'scheduled', 'lateRegOpen', 'lateRegClosed', 'finished', 'cancelled']

export const DEFAULT_TRANSITIONS = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['lateRegOpen', 'cancelled'],
  lateRegOpen: ['lateRegClosed', 'cancelled'],
  lateRegClosed: ['finished', 'cancelled'],
  finished: [],
  cancelled: [],
}

const TERMINAL_STATUSES = ['finished', 'cancelled']

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status)
}

export function defaultNextStatuses(from) {
  return DEFAULT_TRANSITIONS[from] ?? []
}

export function isDefaultTransition(from, to) {
  return defaultNextStatuses(from).includes(to)
}
