// Tournament status pill, shared by the list page and the detail page top bar.
// Status label + badge styling come from lib/tournamentStatus so this file stays
// component-only (Fast Refresh).

import { STATUS_META } from '../lib/tournamentStatus'

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { label: status, badge: 'bg-white/10 text-white/60' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${meta.badge}`}>
      {meta.label}
    </span>
  )
}
