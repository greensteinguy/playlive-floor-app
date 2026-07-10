// Sidebar navigation config + permission helpers.
//
// Single source of truth for "which roles see / can act on which nav items."
// The sidebar reads this to decide what to render; route guards (see
// `ProtectedRoute` / per-route `requiredRoles`) read the same map to decide
// what to gate. Adding a new page = add a row here and a route in App.jsx.
//
// Roles: manager, td, cashier, readonly.
// Manager is implicitly included in every `allowedRoles` set — see
// `roleCanSee()` below. This matches Guy's direction: "Manager is elevated
// permissions but still does anything TD or Cashier can do."

export const ALL_ROLES = ['manager', 'td', 'cashier', 'readonly']

/**
 * Each item:
 *   to            — route path
 *   label         — sidebar text
 *   icon          — single character glyph (matches analytics dashboard style)
 *   allowedRoles  — who sees this item in the sidebar AND can navigate to it.
 *                   Manager always passes; do NOT list 'manager' here unless
 *                   it's a manager-only item (then list ONLY 'manager').
 *   readonlyView  — if true, readonly role can SEE the page (no actions).
 *                   We list readonly explicitly in allowedRoles when this is true.
 */
const NAV_ITEMS = [
  // ── Registration Desk ────────────────────────────────────────────────────
  {
    section: 'desk',
    to: '/desk',
    label: 'Desk home',
    icon: '◈',
    allowedRoles: ['cashier', 'readonly'],
  },
  {
    section: 'desk',
    to: '/desk/players',
    label: 'Player search',
    icon: '♟',
    allowedRoles: ['cashier', 'readonly'],
  },
  {
    section: 'desk',
    to: '/desk/deposit',
    label: 'Wallet deposit',
    icon: '↘',
    allowedRoles: ['cashier'],
  },
  {
    section: 'desk',
    to: '/desk/withdrawals',
    label: 'Withdrawals',
    icon: '↖',
    // Money-out mirrors money-in: cashier + (implicit) manager, like Wallet
    // deposit. Not readonly/td — the route is cashier+manager gated in App.jsx.
    allowedRoles: ['cashier'],
  },
  // NOTE: Tickets (/desk/tickets) is a Phase-4 placeholder — removed from the
  // sidebar so floor staff don't hit dead-ends. Re-add a row here when the real
  // page lands. The route still exists in App.jsx.

  // ── Tournament Floor ─────────────────────────────────────────────────────
  {
    section: 'td',
    to: '/td',
    label: 'Floor home',
    icon: '♠',
    allowedRoles: ['td', 'cashier', 'readonly'],
  },
  {
    section: 'td',
    to: '/td/tournaments',
    label: 'Tournaments',
    icon: '▦',
    allowedRoles: ['td', 'cashier', 'readonly'],
  },
  {
    section: 'td',
    to: '/td/tournaments/new',
    label: 'Create tournament',
    icon: '＋',
    allowedRoles: [], // manager-only — see roleCanSee()
  },
  {
    section: 'td',
    to: '/td/templates',
    label: 'Templates',
    icon: '▤',
    allowedRoles: [], // manager-only — blind structures + tournament configs
  },
  {
    section: 'td',
    to: '/td/tables',
    label: 'Tables & seating',
    icon: '⊞',
    allowedRoles: ['td'],
  },
  // NOTE: the standalone Live clock (/td/clock) is gone — the clock is run
  // per-tournament (Tournaments → open → Open clock), so a separate sidebar
  // entry was a redundant dead-end. Mystery bounty (/td/bounty) + Payouts
  // (/td/payouts) are Phase-4 placeholders, removed until the real pages land.

  // ── Admin (manager-only) ─────────────────────────────────────────────────
  {
    section: 'admin',
    to: '/admin/audit',
    label: 'Audit log',
    icon: '⎙',
    allowedRoles: [], // manager-only
  },
  {
    section: 'admin',
    to: '/admin/dedupe',
    label: 'Dedupe players',
    icon: '⇌',
    allowedRoles: [], // manager-only
  },
  // NOTE: Reconciliation (/admin/reconcile) is a Phase-4 placeholder — removed
  // from the sidebar until the end-of-day reconciliation view is built.
]

export const NAV_SECTIONS = [
  { id: 'desk',  label: 'Registration desk' },
  { id: 'td',    label: 'Tournament floor' },
  { id: 'admin', label: 'Admin' },
]

/**
 * Can a given role see (and navigate to) the nav item? Manager always passes.
 * Empty allowedRoles ⇒ manager-only.
 */
export function roleCanSee(role, item) {
  if (role === 'manager') return true
  return item.allowedRoles.includes(role)
}

/**
 * The nav items visible to a given role, ordered as declared above.
 */
export function visibleNavItems(role) {
  if (!role) return []
  return NAV_ITEMS.filter((item) => roleCanSee(role, item))
}

/**
 * Where to land a role on `/`. Per Guy:
 *   - manager  → /desk (registration page is the manager landing)
 *   - cashier  → /desk
 *   - td       → /td
 *   - readonly → /td (read-only observer)
 */
export function landingPathFor(role) {
  switch (role) {
    case 'manager':
    case 'cashier':
      return '/desk'
    case 'td':
    case 'readonly':
      return '/td'
    default:
      return '/login'
  }
}

/**
 * Resolve a route path back to its NAV_ITEMS entry. Used by route guards to
 * fetch `allowedRoles` from the same source the sidebar reads from.
 */
export function findNavItem(pathname) {
  return NAV_ITEMS.find((item) => item.to === pathname)
}

export { NAV_ITEMS }
