// Diagnostic — try several Firestore operations to figure out which permission
// is actually missing. Run with:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/firestore-audit/diagnose.js

import admin from 'firebase-admin'

admin.initializeApp({ credential: admin.credential.applicationDefault() })
const db = admin.firestore()

async function tryOp(name, op) {
  try {
    const result = await op()
    console.log(`OK   ${name}: ${typeof result === 'string' ? result : JSON.stringify(result)}`)
  } catch (e) {
    const detail = e.details || e.message
    console.log(`FAIL ${name}: code=${e.code} ${detail}`)
  }
}

console.log('Firestore access diagnostic')
console.log('============================')
console.log('')

await tryOp('listCollections() (needs datastore.databases.listCollectionIds)',
  () => db.listCollections().then((cs) => `${cs.length} collections: [${cs.map((c) => c.id).join(', ')}]`))

await tryOp('doc.get on nonexistent path (needs datastore.entities.get)',
  () => db.doc('__diag__/__probe__').get().then((s) => `exists=${s.exists}`))

await tryOp('collection.limit(1).get on nonexistent name (needs datastore.entities.list)',
  () => db.collection('__diag_nonexistent__').limit(1).get().then((s) => `size=${s.size}`))

// Guesses at common collection names so we can confirm read works on a real one
for (const name of ['players', 'tournaments', 'series', 'users', 'entries', 'results']) {
  await tryOp(`collection.limit(1).get on guessed '${name}'`,
    () => db.collection(name).limit(1).get().then((s) => `size=${s.size}, sampleId=${s.docs[0]?.id ?? '(empty)'}`))
}

process.exit(0)
