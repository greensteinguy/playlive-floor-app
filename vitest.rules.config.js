// Vitest configuration for Firestore rules tests (tier 2).
//
// These tests connect to a Firestore emulator started by
// `firebase emulators:exec`. Use `npm run test:rules` to run.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/firestore-rules/**/*.test.js'],
    globals: false,
    // Rules tests hit a local emulator over HTTP — slower than pure unit tests.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
