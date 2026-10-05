// Pass 4 (final): on clean 1:1 name+date matches, test whether
//   prod.totalPlayers ≈ csv Entries + Re-Entries (+ Re-Buys / Add-Ons)
// to pin down the CSV count semantics for the import mapping. READ-ONLY.

const fs = require('node:fs')
const admin = require('firebase-admin')

const csvPath = process.argv[2]
const norm = (s) => (s || '').toUpperCase().replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim()

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i+1] === '"') { field += '"'; i++ } else if (c === '"') q = false; else field += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [] }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

async function main() {
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '')
  const [header, ...rows] = parseCsv(raw)
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const n = (v) => (v === '' || v == null ? 0 : Number(v))
  const csv = rows.map((r) => ({
    name: r[idx['Name']],
    startMs: new Date(r[idx['Started']].replace(' ', 'T')).getTime(),
    entries: n(r[idx['Number of Entries']]),
    reentries: n(r[idx['Number of Re-Entries']]),
    rebuys: n(r[idx['Number of Re-Buys']]),
    addons: n(r[idx['Number of Add-Ons']]),
  }))

  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'playlive-25a17' })
  const db = admin.firestore()
  const snap = await db.collection('tournaments')
    .select('name', 'startLocal', 'totalPlayers', 'scheduledStartTime')
    .get()
  const byName = new Map()
  snap.forEach((d) => {
    const t = d.data()
    if (t.scheduledStartTime != null) return
    const k = norm(t.name)
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push({ startMs: t.startLocal?.toDate?.()?.getTime() ?? null, totalPlayers: t.totalPlayers ?? null })
  })

  const H36 = 36 * 3600 * 1000
  const hyp = { entriesOnly: 0, plusReentries: 0, plusReentriesRebuys: 0, plusAll: 0, none: 0, n: 0 }
  const misses = []
  for (const row of csv) {
    const cands = (byName.get(norm(row.name)) || []).filter(
      (t) => t.startMs != null && Math.abs(t.startMs - row.startMs) <= H36
    )
    if (cands.length !== 1 || cands[0].totalPlayers == null || cands[0].totalPlayers === 0) continue
    const p = cands[0].totalPlayers
    hyp.n++
    if (p === row.entries) hyp.entriesOnly++
    else if (p === row.entries + row.reentries) hyp.plusReentries++
    else if (p === row.entries + row.reentries + row.rebuys) hyp.plusReentriesRebuys++
    else if (p === row.entries + row.reentries + row.rebuys + row.addons) hyp.plusAll++
    else { hyp.none++; if (misses.length < 6) misses.push(`  "${row.name}": prod=${p} e=${row.entries} re=${row.reentries} rb=${row.rebuys} ao=${row.addons}`) }
  }
  console.log(`clean matches with nonzero prod count: ${hyp.n}`)
  console.log(`  prod == Entries:                       ${hyp.entriesOnly}`)
  console.log(`  prod == Entries+ReEntries:             ${hyp.plusReentries}`)
  console.log(`  prod == Entries+ReEntries+ReBuys:      ${hyp.plusReentriesRebuys}`)
  console.log(`  prod == + AddOns too:                  ${hyp.plusAll}`)
  console.log(`  none of the above:                     ${hyp.none}`)
  misses.forEach((m) => console.log(m))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
