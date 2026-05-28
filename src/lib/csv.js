// Generic CSV export utility. Designed to be wired into every list-style page
// (audit log, tournaments, players, walletTransactions, reconciliation, ...).
//
// Why we hand-roll it:
//   - The data we export is tabular, not nested. Standard CSV is enough.
//   - Avoids pulling in another dep for ~50 LOC of well-known logic.
//   - Lets us control timestamp formatting and null handling consistently
//     across the app.
//
// Usage:
//   import { downloadCsv } from '../../lib/csv'
//   const columns = [
//     { key: 'timestamp', label: 'Timestamp', format: (v) => v.toDate().toISOString() },
//     { key: 'actorId',   label: 'Actor' },
//     { key: 'actionType', label: 'Action' },
//     { key: 'metadata',  label: 'Metadata' },  // objects auto-JSON.stringify
//   ]
//   downloadCsv(rows, columns, 'audit-log-2026-05-28.csv')

import { Timestamp } from 'firebase/firestore'

/**
 * @typedef {Object} ColumnSpec
 * @property {string} key
 * @property {string} label
 * @property {(value: unknown, row: object) => string} [format]
 *   Custom formatter for this column. Receives the raw value and the full row.
 *   Returns the cell text. Useful for derived columns or non-default formatting.
 */

/**
 * Default formatter applied when a column has no `format`. Handles the common
 * cases the app produces:
 *   - null / undefined   → ''
 *   - Firestore Timestamp → ISO 8601
 *   - Date               → ISO 8601
 *   - object / array     → JSON.stringify
 *   - everything else    → String(...)
 */
export function defaultCellFormat(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * CSV-escape a single field. Per RFC 4180:
 *   - Wrap in double quotes if the field contains a comma, quote, CR, or LF.
 *   - Double any embedded quotes.
 * Also wraps fields with leading/trailing whitespace so spreadsheets don't trim.
 */
export function escapeCell(text) {
  const s = text == null ? '' : String(text)
  const needsQuoting =
    s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r') ||
    s !== s.trim()
  if (!needsQuoting) return s
  return `"${s.replaceAll('"', '""')}"`
}

/**
 * Serialize an array of rows to a CSV string (header line + one line per row).
 * Pure — no DOM access, safe to unit test.
 *
 * @param {Array<object>} rows
 * @param {ColumnSpec[]} columns
 * @returns {string}
 */
export function toCsvString(rows, columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('toCsvString: columns must be a non-empty array')
  }
  const headerLine = columns.map((c) => escapeCell(c.label ?? c.key)).join(',')
  const bodyLines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = row?.[c.key]
        const cell = c.format ? c.format(raw, row) : defaultCellFormat(raw)
        return escapeCell(cell)
      })
      .join(',')
  )
  // CRLF line endings per RFC 4180 — Excel prefers them.
  return [headerLine, ...bodyLines].join('\r\n')
}

/**
 * Trigger a browser download of a CSV file.
 *
 * Includes a UTF-8 BOM so Excel reads non-ASCII characters correctly
 * (the cashier desk uses Australian spellings; this also helps if player
 * names contain diacritics or non-Latin characters).
 *
 * In test (Node) environments where `document` isn't available, this no-ops
 * after producing the CSV string — callers can still verify the content via
 * `toCsvString` directly.
 *
 * @param {Array<object>} rows
 * @param {ColumnSpec[]} columns
 * @param {string} filename  e.g. 'audit-log-2026-05-28.csv'
 */
export function downloadCsv(rows, columns, filename) {
  const csv = toCsvString(rows, columns)
  if (typeof document === 'undefined') return // Node — nothing to do

  const BOM = '﻿'
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

/**
 * Build a CSV-friendly filename for a given page + filter context.
 * Output: `<prefix>-<ISO-timestamp-with-safe-chars>.csv`.
 *   e.g. csvFilename('audit-log') → 'audit-log-2026-05-28T18-15-42.csv'
 */
export function csvFilename(prefix, now = new Date()) {
  const safe = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${prefix}-${safe}.csv`
}
