# Staging test script — stakeholder feedback round

**App:** https://admin.playlive.melbourne (backup address, same app: https://playlive-floor.web.app)
**When:** July 2026 feedback round. **Who:** Guy + the TD champion + the registration desk champion.

## Logins

One account per role — Guy distributes the passwords. Sign in with the email
account matching the role you're testing (the app looks different per role —
that's the point).

| Email | Role | You see |
|---|---|---|
| admin@playlive.melbourne | manager | Everything |
| td@playlive.melbourne | td | Floor tools: clock, tables, floor controls |
| cashier@playlive.melbourne | cashier | Desk tools: players, registration, deposits |
| readonly@playlive.melbourne | readonly | Look, don't touch |

## Ground rules

- **This is the real shared database.** Name anything you create so it's
  obviously fake — prefix tournaments and players with **ZZTEST**. It all gets
  cleaned up before go-live, but clear labels keep the cleanup safe.
- Works on PC, iPad, and phone. Please try your normal device — feedback about
  awkward touch targets is exactly what we want.
- Nothing you do here moves real money. The wallet records that money moved
  through the till/EFTPOS/PayID — it never moves it.

## What to try — Registration desk (cashier login)

1. **Player search** → find "ZZTEST Staging Smoke" by name fragment, then by phone.
2. **Create a player** (ZZTEST-prefixed name) via + New player.
3. **Record a deposit**: Wallet deposit → pick your player → $50 cash → confirm.
   Then try a **PayID** deposit and tell us if the wizard matches how PayID
   actually goes at the desk.
4. **Register a player into a tournament**: open the ZZTEST tournament →
   Register players → pay once by cash, once from wallet.
5. Open the player's profile → **Wallet & tickets** tab. Does the ledger read
   the way you'd expect? Try the CSV export.
6. Try to reach TD/admin screens — you should be politely blocked.

## What to try — Tournament floor (td login)

1. Open the ZZTEST tournament → **Open clock** → start / pause / resume /
   advance. Is the clock readable from across a room?
2. **Tables & seating**: draw seats, open an extra table, activate it, move a
   player by clicking seats, run a **Balance**, **Close** a table, eliminate a
   player (pick them up → eliminate). This whole area is flagged for your
   feedback — be harsh.
3. **Floor controls** on the tournament page: walk the status forward.
4. Check the tournament list sorting and filters.

## What to try — Manager (admin login)

1. Everything above, plus:
2. **Create a tournament** from scratch (ZZTEST prefix, status Draft) — is the
   wizard's order sensible? Anything missing at creation time?
3. **Templates**: build a structure template matching a real weekly event.
   (These can stay — real structures are useful permanent data. Name them
   properly, no ZZTEST.)
4. **Payouts tab**: auto-fill a payout structure, override a row, save.
5. **Audit log**: filter by action type and by date. Can you reconstruct what
   the cashier tester did?
6. **Override** a tournament status backwards (needs a reason) — check the
   audit trail shows it.

## What to try — Readonly login

1. Browse everywhere you can. Confirm every form is disabled and no
   create/save buttons appear. This is the future TV-display / observer role.

## Reporting feedback

Anything that made you pause, reread, mis-tap, or ask "why" — write it down,
however small. Format: **where you were → what you did → what you expected →
what happened**. Screenshots welcome. Send everything to Guy; items land in
`docs/FLOOR_FEEDBACK.md` and get prioritized like the last round.

Known gaps (don't report these): ticket issuance UI, thermal printing, TV
display, and the ICM deal calculator are later-phase work. The Google sign-in
button won't work until the provider is switched on — use email + password.
