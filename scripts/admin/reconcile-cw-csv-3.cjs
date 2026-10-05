// Pass 3: characterize the CSV↔prod relationship now we know ATTID ≠ ttid.
//   A. unmatched CSV rows by month  (hypothesis: pre-ingest history)
//   B. unmatched PROD docs by month (hypothesis: post-export + ingest-only era)
//   C. ambiguous matches: is csv "Number of Entries" ≈ Σ candidates' totalPlayers
//      (hypothesis: CSV row = whole event, prod docs = per-flight instances)
//   D. clean 1:1 matches: drift direction/stats of csv-entries vs totalPlayers
// READ-ONLY.

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
  const csv = rows.map((r) => ({
    attid: Number(r[idx['ATTID']]),
    name: r[idx['Name']],
    started: r[idx['Started']],
    startMs: new Date(r[idx['Started']].replace(' ', 'T')).getTime(),
    entries: r[idx['Number of Entries']] === '' ? null : Number(r[idx['Number of Entries']]),
  }))

  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'playlive-25a17' })
  const db = admin.firestore()
  const snap = await db.collection('tournaments')
    .select('ttid', 'name', 'startLocal', 'totalPlayers', 'scheduledStartTime')
    .get()
  const legacy = []
  snap.forEach((d) => {
    const t = d.data()
    if (t.scheduledStartTime != null) return
    legacy.push({
      id: d.id, ttid: t.ttid ?? null, name: t.name ?? '',
      startMs: t.startLocal?.toDate?.()?.getTime() ?? null,
      totalPlayers: t.totalPlayers ?? null,
    })
  })

  const byName = new Map()
  for (const t of legacy) {
    const k = norm(t.name)
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(t)
  }
  const H36 = 36 * 3600 * 1000
  const month = (ms) => new Date(ms).toISOString().slice(0, 7)

  const matchedProdIds = new Set()
  const unmatchedByMonth = {}
  let unmatchedTotal = 0
  const sumChecks = { close: 0, notClose: 0, samples: [] }
  const drift = []

  for (const row of csv) {
    const cands = (byName.get(norm(row.name)) || []).filter(
      (t) => t.startMs != null && Math.abs(t.startMs - row.startMs) <= H36
    )
    cands.forEach((c) => matchedProdIds.add(c.id))
    if (cands.length === 0) {
      unmatchedTotal++
      const m = month(row.startMs)
      unmatchedByMonth[m] = (unmatchedByMonth[m] || 0) + 1
    } else if (cands.length === 1) {
      if (row.entries != null && cands[0].totalPlayers != null) {
        drift.push(row.entries - cands[0].totalPlayers)
      }
    } else if (row.entries != null) {
      const sum = cands.reduce((s, c) => s + (c.totalPlayers || 0), 0)
      const close = Math.abs(sum - row.entries) <= Math.max(2, row.entries * 0.1)
      if (close) sumChecks.close++
      else sumChecks.notClose++
      if (sumChecks.samples.length < 6) {
        sumChecks.samples.push(`  "${row.name}" ${row.started.slice(0,10)}: csv=${row.entries} Σflights(${cands.length})=${sum}`)
      }
    }
  }

  console.log(`A. unmatched CSV rows: ${unmatchedTotal} — by month:`)
  Object.keys(unmatchedByMonth).sort().forEach((m) => console.log(`  ${m}: ${unmatchedByMonth[m]}`))

  const prodUnmatched = legacy.filter((t) => !matchedProdIds.has(t.id))
  const prodUnByMonth = {}
  prodUnmatched.forEach((t) => {
    const m = t.startMs ? month(t.startMs) : 'no-date'
    prodUnByMonth[m] = (prodUnByMonth[m] || 0) + 1
  })
  console.log(`\nB. unmatched PROD docs: ${prodUnmatched.length} — by month:`)
  Object.keys(prodUnByMonth).sort().forEach((m) => console.log(`  ${m}: ${prodUnByMonth[m]}`))

  console.log(`\nC. ambiguous (multi-doc) matches — CSV entries vs Σ flight totals:`)
  console.log(`  within 10%: ${sumChecks.close}   not close: ${sumChecks.notClose}`)
  sumChecks.samples.forEach((s) => console.log(s))

  drift.sort((a, b) => a - b)
  const exact = drift.filter((d) => d === 0).length
  const pos = drift.filter((d) => d > 0).length
  const neg = drift.filter((d) => d < 0).length
  const median = drift[Math.floor(drift.length / 2)] ?? 0
  console.log(`\nD. clean 1:1 drift (csvEntries − prodTotalPlayers): n=${drift.length}`)
  console.log(`  exact=${exact}  csv>prod=${pos}  csv<prod=${neg}  median=${median}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
