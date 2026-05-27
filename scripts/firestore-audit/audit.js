// Read-only audit of the playlive-25a17 Firestore.
//
// Design lives in docs/schema/firestore-audit.md. This is the executable
// counterpart. It connects with a read-only service account (Cloud Datastore
// Viewer role only), enumerates top-level collections, samples each, infers
// field shapes, dumps redacted samples to ./output/, and writes a summary
// report. The summary in docs/schema/firestore-audit.md is hand-curated from
// the report after a human review pass.
//
// Run from the repo root with:
//   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/green/.config/playlive/audit-sa.json \
//   node scripts/firestore-audit/audit.js
//
// Outputs (all gitignored — may contain PII):
//   scripts/firestore-audit/output/<collection>.dump.json   raw samples (redacted at sensitive fields)
//   scripts/firestore-audit/output/audit-report.json        machine-readable summary
//   scripts/firestore-audit/output/audit-summary.md         human-readable summary

import admin from 'firebase-admin'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, 'output')

const SAMPLE_LIMIT = 2000
const SAMPLES_PER_FIELD = 3

// Field names whose values should never leave the local disk, even in
// redacted dump files. Case-insensitive substring match.
const SENSITIVE_FIELD_PATTERNS = [
  'bsb',
  'account', // accountNumber, bankAccount, etc.
  'phone',
  'mobile',
  'email',
  'address',
  'dob',
  'birth',
  'licence',
  'license',
  'passport',
]

function isSensitiveField(name) {
  const lower = name.toLowerCase()
  return SENSITIVE_FIELD_PATTERNS.some((p) => lower.includes(p))
}

function fsTypeOf(v) {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  if (v instanceof admin.firestore.Timestamp) return 'timestamp'
  if (v instanceof admin.firestore.DocumentReference) return 'reference'
  if (v instanceof admin.firestore.GeoPoint) return 'geopoint'
  const t = typeof v
  if (t === 'object') return 'map'
  return t // string | number | boolean
}

function redact(fieldName, value) {
  if (isSensitiveField(fieldName)) return '[REDACTED]'
  return serializeForJson(value)
}

function redactDoc(data) {
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = redact(k, v)
  }
  return out
}

function serializeForJson(v) {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.map(serializeForJson)
  if (v instanceof admin.firestore.Timestamp) {
    return { _type: 'timestamp', iso: v.toDate().toISOString() }
  }
  if (v instanceof admin.firestore.DocumentReference) {
    return { _type: 'reference', path: v.path }
  }
  if (v instanceof admin.firestore.GeoPoint) {
    return { _type: 'geopoint', lat: v.latitude, lng: v.longitude }
  }
  if (typeof v === 'object') {
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = serializeForJson(val)
    return out
  }
  return v
}

function looksLikeMoney(fieldName) {
  const lower = fieldName.toLowerCase()
  return /(amount|price|cost|fee|buyin|buy_in|total|balance|guarantee|payout|prize|stake|bounty)/.test(lower)
}

function looksLikeTimestamp(fieldName) {
  const lower = fieldName.toLowerCase()
  return /(at$|time$|date$|timestamp$|_at|_time)/i.test(lower)
}

function inferFieldShape(docs) {
  const fields = {}
  const total = docs.length
  for (const doc of docs) {
    const data = doc.data()
    for (const [k, v] of Object.entries(data)) {
      if (!fields[k]) {
        fields[k] = {
          types: new Set(),
          presence: 0,
          samples: [],
          floatValues: 0, // numbers that have a non-zero decimal part
          stringTimestampLooking: 0, // strings that parse as ISO dates in a timestamp-named field
        }
      }
      const f = fields[k]
      f.presence++
      const t = fsTypeOf(v)
      f.types.add(t)
      if (f.samples.length < SAMPLES_PER_FIELD) {
        f.samples.push(redact(k, v))
      }
      if (t === 'number' && looksLikeMoney(k) && !Number.isInteger(v)) {
        f.floatValues++
      }
      if (t === 'string' && looksLikeTimestamp(k)) {
        const parsed = Date.parse(v)
        if (!Number.isNaN(parsed)) f.stringTimestampLooking++
      }
    }
  }
  const out = {}
  for (const [k, v] of Object.entries(fields)) {
    const issues = []
    if (v.types.size > 1) {
      issues.push(`type drift: appears as ${[...v.types].join(' | ')}`)
    }
    if (v.floatValues > 0) {
      issues.push(`money-as-float: ${v.floatValues}/${v.presence} sampled values have decimal parts (canonical schema stores money as integer cents)`)
    }
    if (v.stringTimestampLooking > 0 && !v.types.has('timestamp')) {
      issues.push(`timestamp-as-string: ${v.stringTimestampLooking}/${v.presence} values parse as ISO date strings in a timestamp-named field`)
    }
    out[k] = {
      types: [...v.types],
      presencePct: total > 0 ? Math.round((v.presence / total) * 100) : 0,
      samples: v.samples,
      issues,
    }
  }
  return out
}

async function safeCount(coll) {
  try {
    const snap = await coll.count().get()
    return snap.data().count
  } catch (e) {
    return { error: e.message }
  }
}

async function auditCollection(coll) {
  process.stdout.write(`  auditing ${coll.id} ... `)
  const [total, snap] = await Promise.all([
    safeCount(coll),
    coll.limit(SAMPLE_LIMIT).get(),
  ])
  const docs = snap.docs
  const shape = inferFieldShape(docs)
  const dump = docs.map((d) => ({ id: d.id, data: redactDoc(d.data()) }))
  process.stdout.write(`${docs.length} sampled (total: ${typeof total === 'number' ? total : 'unknown'})\n`)
  return {
    collection: coll.id,
    totalDocuments: total,
    sampleSize: docs.length,
    sampleHitLimit: docs.length === SAMPLE_LIMIT,
    sampleDocId: docs[0]?.id ?? null,
    fields: shape,
    sampleDocumentRedacted: docs[0] ? redactDoc(docs[0].data()) : null,
    dump, // written to its own file by the caller
  }
}

function renderSummaryMarkdown(report) {
  const lines = []
  lines.push(`# Firestore audit summary — auto-generated`)
  lines.push('')
  lines.push(`Run at: \`${report.runAt}\``)
  lines.push(`Project: \`${report.projectId}\``)
  lines.push(`Top-level collections found: **${report.collections.length}**`)
  lines.push('')
  lines.push(`> Raw samples are in the per-collection \`*.dump.json\` files alongside this summary.`)
  lines.push(`> Hand-curated findings live in \`docs/schema/firestore-audit.md\` — this file is the machine-generated input to that.`)
  lines.push('')

  for (const c of report.collections) {
    lines.push(`## \`${c.collection}\``)
    lines.push('')
    lines.push(`- Total documents: \`${typeof c.totalDocuments === 'number' ? c.totalDocuments.toLocaleString() : JSON.stringify(c.totalDocuments)}\``)
    lines.push(`- Sampled: \`${c.sampleSize}\`${c.sampleHitLimit ? ' (hit sample limit — there are more)' : ''}`)
    lines.push(`- Sample doc id: \`${c.sampleDocId ?? '(none)'}\``)
    lines.push('')
    lines.push(`### Fields`)
    lines.push('')
    lines.push(`| Field | Types | Presence | Issues |`)
    lines.push(`|---|---|---|---|`)
    const fieldEntries = Object.entries(c.fields).sort(([, a], [, b]) => b.presencePct - a.presencePct)
    for (const [name, f] of fieldEntries) {
      const issues = f.issues.length > 0 ? f.issues.join('; ') : ''
      lines.push(`| \`${name}\` | ${f.types.join(' \\| ')} | ${f.presencePct}% | ${issues} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  console.log('PlayLive Floor App — Firestore audit')
  console.log('=====================================')

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS env var is not set.')
    console.error('Set it to the path of the read-only service account JSON, e.g.:')
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/c/Users/green/.config/playlive/audit-sa.json node scripts/firestore-audit/audit.js')
    process.exit(1)
  }
  console.log(`Using credentials: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`)

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  })
  const projectId = admin.app().options.credential?.projectId ?? '(unknown)'

  const db = admin.firestore()

  await mkdir(OUTPUT_DIR, { recursive: true })

  console.log('Listing top-level collections...')
  const collections = await db.listCollections()
  console.log(`Found ${collections.length} top-level collections: ${collections.map((c) => c.id).join(', ') || '(none)'}`)
  console.log('')

  const report = {
    runAt: new Date().toISOString(),
    projectId,
    sampleLimit: SAMPLE_LIMIT,
    collections: [],
  }

  for (const coll of collections) {
    const audit = await auditCollection(coll)
    // Write the per-collection dump to its own file (PII-bearing — stays on disk).
    const { dump, ...summary } = audit
    await writeFile(
      path.join(OUTPUT_DIR, `${coll.id}.dump.json`),
      JSON.stringify(dump, null, 2)
    )
    report.collections.push(summary)
  }

  await writeFile(
    path.join(OUTPUT_DIR, 'audit-report.json'),
    JSON.stringify(report, null, 2)
  )
  await writeFile(
    path.join(OUTPUT_DIR, 'audit-summary.md'),
    renderSummaryMarkdown(report)
  )

  console.log('')
  console.log(`Done. Outputs in ${OUTPUT_DIR}/`)
  console.log(`  audit-report.json    — machine-readable summary`)
  console.log(`  audit-summary.md     — human-readable summary (next: curate into docs/schema/firestore-audit.md)`)
  console.log(`  <collection>.dump.json — raw redacted samples (kept on disk only)`)
  process.exit(0)
}

main().catch((e) => {
  console.error('Audit failed:')
  console.error(e)
  process.exit(1)
})
