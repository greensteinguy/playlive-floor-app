// Set a Firebase Auth custom claim `role` on a user.
//
// Roles: manager | td | cashier | readonly
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/c/Users/green/.config/playlive/admin-sa.json \
//     node set-role.js <uid> <role>
//
// Notes:
//   - The service account must have Firebase Auth admin permissions in the
//     playlive-25a17 project. The audit SA does NOT — use a separate SA with
//     either roles/firebase.admin or roles/firebaseauth.admin.
//   - After running, the affected user must sign out and sign back in (or
//     wait up to an hour for the ID token to refresh) for the new claim to
//     take effect in the app. The Floor App's signIn handler forces a token
//     refresh, so a fresh sign-in picks it up immediately.
//   - This script is intended for ad-hoc use by the venue operator. It is
//     not part of the Floor App's runtime — runs from your workstation.

import admin from 'firebase-admin'

const VALID_ROLES = ['manager', 'td', 'cashier', 'readonly']

const [, , uid, role] = process.argv

if (!uid || !role) {

  console.error('Usage: node set-role.js <uid> <role>')
  console.error(`  role: one of ${VALID_ROLES.join(' | ')}`)
  process.exit(1)
}

if (!VALID_ROLES.includes(role)) {

  console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(' | ')}`)
  process.exit(1)
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {

  console.error('GOOGLE_APPLICATION_CREDENTIALS env var is not set.')
  console.error('Set it to the path of an admin service account JSON, e.g.:')
  console.error('  GOOGLE_APPLICATION_CREDENTIALS=/c/Users/green/.config/playlive/admin-sa.json \\')
  console.error('    node set-role.js <uid> <role>')
  process.exit(1)
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
})

try {
  // Verify the user exists first — better error message than setCustomUserClaims would give
  const user = await admin.auth().getUser(uid)

  await admin.auth().setCustomUserClaims(uid, { role })


  console.log(`OK. Set role="${role}" on user ${user.email || user.uid}.`)
  console.log('The user must sign out and back in (or wait up to ~1h for token refresh) for the new claim to take effect.')
  process.exit(0)
} catch (e) {

  console.error('Failed:', e.message || e)
  process.exit(1)
}
