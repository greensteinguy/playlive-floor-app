// Firebase initialization.
//
// Three modes, controlled by .env.local:
//
//   1. Pure mock (VITE_USE_MOCK_DATA=true, VITE_FIRESTORE_EMULATOR=false)
//      → No Firebase init. Auth is mocked. The data layer throws MockModeError
//        on every call. Useful for pure UI iteration without any backend.
//
//   2. Emulator-backed dev (VITE_USE_MOCK_DATA=true, VITE_FIRESTORE_EMULATOR=true)
//      → Initialize Firestore against a local emulator on 127.0.0.1:8080. Auth
//        is still mocked (so we don't need to run the Auth emulator too). Lets
//        us verify the read/write/query/index paths end-to-end without touching
//        production. Pair with `npm run emulator` (boots the emulator with our
//        firestore.rules loaded) and `npm run seed:*` scripts.
//
//   3. Production (VITE_USE_MOCK_DATA=false)
//      → Real Firebase Auth + Firestore against the configured project. All
//        rules apply. Only used on deployed builds and (rarely) for production
//        smoke tests.

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

export const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true'
export const USE_EMULATOR = import.meta.env.VITE_FIRESTORE_EMULATOR === 'true'

// Project ID to use for the emulator partition. Keep this distinct from the
// real project so an accidental "emulator host" misconfiguration can't write
// to playlive-25a17. The matching seed scripts hardcode the same id.
const EMULATOR_PROJECT_ID = 'demo-playlive'

let app, auth, db

if (USE_EMULATOR) {
  // Mode 2 — emulator-backed. Init with just the demo project id; auth stays
  // mocked so we don't need real API keys.
  app = initializeApp({ projectId: EMULATOR_PROJECT_ID })
  db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
} else if (!USE_MOCK_DATA) {
  // Mode 3 — production.
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
  // NOTE: per ADR-001, we do NOT enable offline persistence. The Floor App is
  // online-only in v1. If offline support is added in a future version, that
  // decision should be re-recorded as a new ADR superseding ADR-001.
}
// Mode 1 (pure mock) — `app`, `auth`, `db` all undefined; AuthProvider runs
// against its mock branch and the data layer throws MockModeError.

export { app, auth, db }
