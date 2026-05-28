# Initial admin setup

How to provision the first Manager user for the Floor App.

> The Floor App has no signup screen — staff accounts are provisioned by you (the venue operator), not self-served. This doc walks through the one-time setup for the first user, and the same flow for adding subsequent users.

## Roles

The Floor App has four mutually-exclusive roles, carried as a Firebase Auth custom claim named `role`:

| Role | Who it's for |
|---|---|
| `manager` | Full access. Only role that can complete a withdrawal. |
| `td` | Tournament Director: clock, balancing, deal-making, payouts. |
| `cashier` | Registration desk: player search, deposits, withdrawal request creation. |
| `readonly` | View-only access. |

For the very first user, set them as `manager`.

## Step 1 — Create the user in Firebase Console

1. Go to https://console.firebase.google.com/project/playlive-25a17/authentication/users
2. Click **"Add user"**.
3. Enter the user's email and a temporary password.
4. Click **"Add user"**.
5. Copy the user's UID — you'll need it in Step 3.

## Step 2 — Get an admin service account

The role-setting script needs a service account with permission to modify Firebase Auth custom claims. The audit SA at `~/.config/playlive/audit-sa.json` does NOT have these permissions (it's read-only) — you'll need a separate one.

1. Go to https://console.cloud.google.com/iam-admin/serviceaccounts?project=playlive-25a17
2. Click **"+ Create Service Account"**.
3. Name it `floor-app-admin` (or similar).
4. Description: "Admin tasks for the Floor App — setting custom claims, etc."
5. **Grant access:** add role **"Firebase Authentication Admin"** (`roles/firebaseauth.admin`).
6. After creation, click into the SA → **Keys** → **Add Key** → **Create new key** → **JSON**.
7. Save the downloaded JSON file to `C:\Users\green\.config\playlive\admin-sa.json` (alongside the audit SA — keep both outside the repo).

## Step 3 — Set the user's role

From the repo root, in a bash shell (Git Bash on Windows):

```bash
cd scripts/admin
npm install   # first time only — installs firebase-admin
```

Then to set the role:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/c/Users/green/.config/playlive/admin-sa.json \
  node set-role.js <uid> manager
```

Replace `<uid>` with the user's UID from Step 1.

You should see:

```
OK. Set role="manager" on user you@playlive.com.au.
The user must sign out and back in (or wait up to ~1h for token refresh) for the new claim to take effect.
```

## Step 4 — Sign in

Open the Floor App. Sign in with the email + password from Step 1. The custom claim is picked up at sign-in (the app forces a token refresh) — you should land on the home page with your email and role shown in the corner.

## Subsequent users

For each additional staff member, repeat the same three steps with their email and the appropriate role.

## Local dev without a real Firebase project

If you're iterating on UI and don't need real auth, set `VITE_USE_MOCK_DATA=true` in `.env.local`. The app will sign you in automatically as a fake user. The fake user's role comes from `VITE_MOCK_ROLE` (defaults to `manager`); set it to `td`, `cashier`, or `readonly` to test other personas.

```
VITE_USE_MOCK_DATA=true
VITE_MOCK_ROLE=cashier
```

`npm run dev` and you'll be signed in as a cashier on load.

## Troubleshooting

- **"No account with that email"** at sign-in → the user wasn't created in Firebase Auth, or the email is mistyped. Re-do Step 1.
- **App says "no role"** after sign-in → the custom claim wasn't set, or the user signed in before the claim was set and is using a stale token. Sign out and back in.
- **`set-role.js` says "permission denied"** → the admin SA doesn't have `roles/firebaseauth.admin`. Re-check Step 2.
- **`set-role.js` says "user not found"** → wrong UID. Get it from the Firebase Console Users page (the UID column).
