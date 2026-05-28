// Vitest configuration.
//
// Tier 1: pure unit tests for validators + wallet operations (data layer mocked).
// Node environment — no jsdom yet. UI tests land later with a different env.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Replace `import.meta.env.VITE_USE_MOCK_DATA` at parse time so
  // src/firebase/config.js skips real Firebase init in the test runtime.
  // Tests that need Firestore behaviour mock the data layer directly.
  define: {
    'import.meta.env.VITE_USE_MOCK_DATA': '"true"',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    globals: false,
  },
})
