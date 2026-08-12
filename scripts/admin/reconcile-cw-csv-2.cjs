// Follow-up analysis: is ATTID actually the same id space as the ingest's
// ttid? Signals from pass 1 said NO (815/827 id-overlaps disagree on entry
// count). This pass:
//   1. name-equality rate among id-overlaps (should be ~100% if same space)
//   2. ttid range in prod vs ATTID range in CSV
//   3. a name+date join (same name, started within 36h) to find the real
//      correspondence and re-count true holes
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
    entries: r[idx['Number of Entries']] === '' ? null : Number(r[idx['Number of Entries']]),
    ttidSuffix: (r[idx['Name']].match(/\((\d+)\)\s*$/) || [])[1] ?? null,
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
      id: d.id,
      ttid: t.ttid ?? null,
      name: t.name ?? '',
      startMs: t.startLocal?.toDate?.()?.getTime() ?? null,
      totalPlayers: t.totalPlayers ?? null,
    })
  })

  // 1. name equality among id-overlaps
  const prodByTtid = new Map(legacy.filter((t) => t.ttid != null).map((t) => [Number(t.ttid), t]))
  let sameName = 0, diffName = 0
  const diffSamples = []
  for (const row of csv) {
    const doc = prodByTtid.get(row.attid)
    if (!doc) continue
    if (norm(row.name) === norm(doc.name)) sameName++
    else { diffName++; if (diffSamples.length < 8) diffSamples.push(`  ATTID ${row.attid}: csv="${row.name}" vs prod="${doc.name}"`) }
  }
  console.log(`id-overlap name check: same=${sameName} different=${diffName}`)
  diffSamples.forEach((s) => console.log(s))

  // 2. ranges
  const ttids = [...prodByTtid.keys()]
  console.log(`\nprod ttid range: ${Math.min(...ttids)}–${Math.max(...ttids)} (${ttids.length} docs)`)
  console.log(`csv ATTID range: ${Math.min(...csv.map(r => r.attid))}–${Math.max(...csv.map(r => r.attid))} (${csv.length} rows)`)
  const suffixed = csv.filter((r) => r.ttidSuffix)
  console.log(`csv rows with (NNNN) name suffix: ${suffixed.length}`)
  for (const r of suffixed.slice(0, 5)) {
    const hit = prodByTtid.get(Number(r.ttidSuffix))
    console.log(`  ATTID ${r.attid} suffix ${r.ttidSuffix} → prod: ${hit ? `"${hit.name}" (players=${hit.totalPlayers}, csv entries=${r.entries})` : 'NO DOC'}`)
  }

  // 3. name+date join: same normalized name, |startLocal - Started| <= 36h
  const byName = new Map()
  for (const t of legacy) {
    const k = norm(t.name)
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(t)
  }
  const H36 = 36 * 3600 * 1000
  let matched = 0, ambiguous = 0, unmatched = 0
  const matchedProdIds = new Set()
  for (const row of csv) {
    const cands = (byName.get(norm(row.name)) || []).filter((t) => {
      if (t.startMs == null || !row.started) return false
      return Math.abs(t.startMs - new Date(row.started.replace(' ', 'T')).getTime()) <= H36
    })
    if (cands.length === 1) { matched++; matchedProdIds.add(cands[0].id) }
    else if (cands.length > 1) { ambiguous++; cands.forEach((c) => matchedProdIds.add(c.id)) }
    else unmatched++
  }
  console.log(`\nname+date join (±36h): matched=${matched} ambiguous=${ambiguous} unmatched=${unmatched} (of ${csv.length} csv rows)`)
  console.log(`prod legacy docs touched by any match: ${matchedProdIds.size} of ${legacy.length}`)
  console.log(`prod legacy docs matching NOTHING in csv: ${legacy.length - matchedProdIds.size}`)

  // entry-count agreement on clean 1:1 matches
  let agree = 0, disagree = 0
  for (const row of csv) {
    const cands = (byName.get(norm(row.name)) || []).filter((t) => {
      if (t.startMs == null || !row.started) return false
      return Math.abs(t.startMs - new Date(row.started.replace(' ', 'T')).getTime()) <= H36
    })
    if (cands.length === 1 && row.entries != null && cands[0].totalPlayers != null) {
      if (row.entries === cands[0].totalPlayers) agree++
      else disagree++
    }
  }
  console.log(`entry counts on clean matches: agree=${agree} disagree=${disagree}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
