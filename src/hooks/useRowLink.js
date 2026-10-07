// Whole-row click for list tables (Tournaments, Player search).
//
// Replaces the "stretched link" pattern (an absolutely-positioned ::after on
// the name link, contained by `position: relative` on the <tr>). Safari does
// not make a table row a containing block, so every row's overlay stretched
// over the whole table and the LAST one won: hovering any row highlighted one
// row, and every click opened the same record (venue PC, 7 Oct 2026).
//
// The name cell keeps a real <Link> (keyboard, middle-click, open in new
// tab); this handler makes the rest of the row clickable too.

import { useNavigate } from 'react-router-dom'

export function useRowLink() {
  const navigate = useNavigate()
  return (to) => (e) => {
    // The link (or any control) in the row handles its own click.
    if (e.target.closest('a, button, input, select, textarea, label')) return
    // Don't hijack a drag-to-select of the row's text.
    if (window.getSelection?.()?.toString()) return
    if (e.metaKey || e.ctrlKey) window.open(to, '_blank', 'noopener')
    else navigate(to)
  }
}
