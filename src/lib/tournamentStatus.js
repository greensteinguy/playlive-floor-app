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
