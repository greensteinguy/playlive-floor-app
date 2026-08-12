// One-off reconciliation: "CW TOURNAMENTS.csv" (the Casinoware master index,
// ATTID-keyed) vs the legacy tournament docs living in prod Firestore
// (ttid-keyed, written by the old player-app ingest function).
//
// READ-ONLY — nothing is written to Firestore. Answers, per Phase 6.2's
// gap-import plan:
//   1. Which CSV tournaments are MISSING from prod (the cleanup-cron holes) —
//      these are the gap-import candidates.
//   2. Which prod docs are NOT in the CSV (should be few; interesting if not).
//   3. For overlapping ids: do entry counts agree (CSV "Number of Entries" vs
//      doc totalPlayers)?
//
// Usage (Git Bash):
//   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/green/.config/playlive/admin-sa.json \
//     node scripts/admin/reconcile-cw-csv.js "../CW TOURNAMENTS.csv"
//
// Writes the hole list to "<csv dir>/cw-reconciliation-holes.csv" and prints
// a summary.

const fs = require('node:fs')
const path = require('node:path')
const admin = require('firebase-admin')

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS env var is not set — see usage in the header.')
  process.exit(1)
}

const csvPath = process.argv[2]
if (!csvPath || !fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`)
  process.exit(1)
}

// Minimal CSV parser (handles quoted fields with embedded commas/quotes).
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

async function main() {
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '')
  const [header, ...rows] = parseCsv(raw)
  const col = (name) => header.indexOf(name)
  const iId = col('ATTID')
  const iName = col('Name')
  const iStarted = col('Started')
  const iEntries = col('Number of Entries')
  if (iId < 0 || iStarted < 0) {
    console.error(`Unexpected header: ${header.join(', ')}`)
    process.exit(1)
  }

  const csvById = new Map()
  for (const r of rows) {
    csvById.set(Number(r[iId]), {
      attid: Number(r[iId]),
      name: r[iName],
      started: r[iStarted],
      entries: r[iEntries] === '' ? null : Number(r[iEntries]),
    })
  }
  console.log(`CSV: ${csvById.size} tournaments (ATTID ${Math.min(...csvById.keys())}–${Math.max(...csvById.keys())})`)

  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'playlive-25a17' })
  const db = admin.firestore()

  // Pull id + the few compare fields for every tournaments doc. Legacy docs
  // are the ones WITHOUT scheduledStartTime (the same shape-split rule both
  // apps rely on).
  const snap = await db.collection('tournaments')
    .select('ttid', 'legacyId', 'name', 'startLocal', 'scheduledStartTime', 'totalPlayers')
    .get()

  const legacy = []
  let canonical = 0
  snap.forEach((d) => {
    const t = d.data()
    if (t.scheduledStartTime != null) { canonical++; return }
    legacy.push({ id: d.id, ttid: t.ttid ?? null, name: t.name ?? '', totalPlayers: t.totalPlayers ?? null })
  })
  console.log(`Prod: ${snap.size} tournament docs = ${legacy.length} legacy + ${canonical} canonical`)

  const prodByTtid = new Map()
  const noTtid = []
  for (const t of legacy) {
    if (t.ttid == null) noTtid.push(t)
    else prodByTtid.set(Number(t.ttid), t)
  }
  if (noTtid.length) console.log(`  (${noTtid.length} legacy docs have NO ttid — listed at the end)`)

  // 1. Holes: in CSV, not in prod.
  const holes = [...csvById.values()].filter((r) => !prodByTtid.has(r.attid))
  // 2. Extras: in prod, not in CSV.
  const extras = [...prodByTtid.values()].filter((t) => !csvById.has(Number(t.ttid)))
  // 3. Entry-count drift on the overlap.
  let overlap = 0
  const drift = []
  for (const [attid, row] of csvById) {
    const doc = prodByTtid.get(attid)
    if (!doc) continue
    overlap++
    if (row.entries != null && doc.totalPlayers != null && row.entries !== doc.totalPlayers) {
      drift.push({ attid, name: row.name, csv: row.entries, prod: doc.totalPlayers })
    }
  }

  console.log('\n── Reconciliation ──')
  console.log(`overlap (both):            ${overlap}`)
  console.log(`HOLES (CSV only):          ${holes.length}   ← gap-import candidates`)
  console.log(`extras (prod only):        ${extras.length}`)
  console.log(`entry-count drift:         ${drift.length} of ${overlap}`)

  if (holes.length) {
    const byYear = {}
    holes.forEach((h) => {
      const y = (h.started || '').slice(0, 7)
      byYear[y] = (byYear[y] || 0) + 1
    })
    console.log('\nHoles by month:')
    Object.keys(byYear).sort().forEach((m) => console.log(`  ${m}: ${byYear[m]}`))
    const outPath = path.join(path.dirname(csvPath), 'cw-reconciliation-holes.csv')
    const lines = ['attid,name,started,entries']
    holes
      .sort((a, b) => a.started.localeCompare(b.started))
      .forEach((h) => lines.push(`${h.attid},"${(h.name || '').replace(/"/g, '""')}",${h.started},${h.entries ?? ''}`))
    fs.writeFileSync(outPath, lines.join('\n') + '\n')
    console.log(`\nHole list written: ${outPath}`)
  }

  if (extras.length) {
    console.log('\nProd-only docs (first 15):')
    extras.slice(0, 15).forEach((t) => console.log(`  ttid=${t.ttid}  ${t.name}  (doc ${t.id})`))
  }
  if (drift.length) {
    console.log('\nEntry-count drift (first 15):')
    drift.slice(0, 15).forEach((d) => console.log(`  ATTID ${d.attid}  ${d.name}: csv=${d.csv} prod=${d.prod}`))
  }
  if (noTtid.length) {
    console.log('\nLegacy docs without ttid (first 10):')
    noTtid.slice(0, 10).forEach((t) => console.log(`  doc ${t.id}  ${t.name}`))
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
