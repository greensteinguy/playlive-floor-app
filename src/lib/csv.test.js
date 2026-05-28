// Unit tests for the CSV utility. Pure-function tests — no DOM, no Firestore.

import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { toCsvString, escapeCell, defaultCellFormat, csvFilename } from './csv'

describe('escapeCell', () => {
  it('returns plain strings unchanged', () => {
    expect(escapeCell('hello')).toBe('hello')
    expect(escapeCell('player-1')).toBe('player-1')
  })

  it('quotes and escapes embedded commas', () => {
    expect(escapeCell('a, b')).toBe('"a, b"')
  })

  it('quotes and escapes embedded double quotes', () => {
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes embedded newlines', () => {
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCell('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('quotes leading or trailing whitespace', () => {
    expect(escapeCell(' leading')).toBe('" leading"')
    expect(escapeCell('trailing ')).toBe('"trailing "')
  })

  it('returns empty string for null / undefined', () => {
    expect(escapeCell(null)).toBe('')
    expect(escapeCell(undefined)).toBe('')
  })

  it('coerces non-strings to strings', () => {
    expect(escapeCell(42)).toBe('42')
    expect(escapeCell(true)).toBe('true')
    expect(escapeCell(0)).toBe('0')
  })
})

describe('defaultCellFormat', () => {
  it('returns empty string for null / undefined', () => {
    expect(defaultCellFormat(null)).toBe('')
    expect(defaultCellFormat(undefined)).toBe('')
  })

  it('converts Firestore Timestamp to ISO 8601', () => {
    const ts = Timestamp.fromMillis(1_700_000_000_000)
    expect(defaultCellFormat(ts)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('converts Date to ISO 8601', () => {
    const d = new Date('2026-05-28T18:15:00Z')
    expect(defaultCellFormat(d)).toBe('2026-05-28T18:15:00.000Z')
  })

  it('JSON-stringifies objects', () => {
    expect(defaultCellFormat({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}')
  })

  it('JSON-stringifies arrays', () => {
    expect(defaultCellFormat([1, 2, 3])).toBe('[1,2,3]')
  })

  it('passes primitives through String()', () => {
    expect(defaultCellFormat(42)).toBe('42')
    expect(defaultCellFormat(true)).toBe('true')
    expect(defaultCellFormat('hello')).toBe('hello')
  })
})

describe('toCsvString', () => {
  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'meta', label: 'Meta' },
  ]

  it('produces just the header line when rows are empty', () => {
    expect(toCsvString([], columns)).toBe('ID,Name,Meta')
  })

  it('uses CRLF line endings between rows', () => {
    const csv = toCsvString(
      [
        { id: 1, name: 'a', meta: {} },
        { id: 2, name: 'b', meta: {} },
      ],
      columns
    )
    expect(csv).toMatch(/\r\n/)
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3) // header + 2 data
  })

  it('serializes a row through defaultCellFormat by default', () => {
    const ts = Timestamp.fromMillis(1_700_000_000_000)
    const csv = toCsvString(
      [{ id: 'tx-1', name: 'Test', meta: { type: 'deposit' }, when: ts }],
      [
        { key: 'id', label: 'ID' },
        { key: 'when', label: 'When' },
        { key: 'meta', label: 'Meta' },
      ]
    )
    expect(csv).toContain('tx-1,2023-11-14T22:13:20.000Z')
    // The JSON value contains a comma → must be quoted.
    expect(csv).toContain('"{""type"":""deposit""}"')
  })

  it('honors a per-column custom formatter', () => {
    const csv = toCsvString(
      [{ amount: 1234 }],
      [{ key: 'amount', label: 'Amount (AUD)', format: (v) => `$${(v / 100).toFixed(2)}` }]
    )
    expect(csv).toBe('Amount (AUD)\r\n$12.34')
  })

  it('passes the full row as the second arg to the formatter', () => {
    const csv = toCsvString(
      [{ first: 'Ada', last: 'Lovelace' }],
      [
        {
          key: 'first',
          label: 'Name',
          format: (_v, row) => `${row.first} ${row.last}`,
        },
      ]
    )
    expect(csv).toBe('Name\r\nAda Lovelace')
  })

  it('renders null/undefined fields as empty cells', () => {
    const csv = toCsvString(
      [{ id: 'p1', name: null }, { id: 'p2' /* name missing */ }],
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
      ]
    )
    expect(csv).toBe('ID,Name\r\np1,\r\np2,')
  })

  it('throws when columns is missing or empty', () => {
    expect(() => toCsvString([], [])).toThrow(/columns must be a non-empty array/)
    expect(() => toCsvString([], null)).toThrow(/columns must be a non-empty array/)
  })

  it('escapes a value containing both a comma and a quote', () => {
    const csv = toCsvString(
      [{ note: 'hello, "world"' }],
      [{ key: 'note', label: 'Note' }]
    )
    expect(csv).toBe('Note\r\n"hello, ""world"""')
  })
})

describe('csvFilename', () => {
  it('produces a filename with a safe ISO timestamp', () => {
    const now = new Date('2026-05-28T18:15:42.123Z')
    expect(csvFilename('audit-log', now)).toBe('audit-log-2026-05-28T18-15-42.csv')
  })

  it('defaults to the current time when no date is passed', () => {
    const name = csvFilename('foo')
    expect(name).toMatch(/^foo-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/)
  })
})
