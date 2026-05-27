// Firebase initialization stub.
//
// Phase 1 task 1.6 will flesh this out with proper helpers (typed query/write
// wrappers that validate through the lib/schema module).
//
// Until then this file just initializes the SDK against the staging Firebase
// project — values come from .env.local (see .env.example for the keys).

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

export const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true'

let app, auth, db
if (!USE_MOCK_DATA) {
  app  = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db   = getFirestore(app)
  // NOTE: per ADR-001, we do NOT enable offline persistence. The Floor App is
  // online-only in v1. If offline support is added in a future version, that
  // decision should be re-recorded as a new ADR superseding ADR-001.
}

export { app, auth, db }
