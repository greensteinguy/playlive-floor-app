# `src/lib/schema/` — Zod runtime validators

Runtime schemas for every Firestore collection in the Floor App. Implementation of the contract spelled out in `docs/schema/canonical-schema.md`. Used by Firestore writes (reject malformed data before it lands), Firestore reads (catch dirty / legacy shapes at the boundary), form validation, and the migration import (Phase 1 task R1.0b).

## Quick start

```js
import { Tournament, Player, WalletTransaction } from '../lib/schema'

// Throws ZodError on invalid shape
const t = Tournament.parse(rawTournamentDoc)

// Or safer: returns { success, data?, error? }
const result = WalletTransaction.safeParse(rawTxDoc)
if (!result.success) {
  console.error(result.error.format())
  return
}
const tx = result.data
```

## File layout

```
src/lib/schema/
├── README.md                  ← you are here
├── index.js                   ← re-exports everything
├── _shared.js                 ← primitives (Money, Timestamp, IDs, audit fields)
├── structure.js               ← embedded blind structure (discriminated union: level | break)
├── payoutStructure.js         ← embedded payout structure
├── tournament.js              ← tournaments collection
├── player.js                  ← players collection
├── withdrawalRequest.js       ← withdrawalRequests collection
├── structureTemplate.js       ← structureTemplates collection
├── tournamentTemplate.js      ← tournamentTemplates collection
├── auditLog.js                ← auditLog collection
├── session.js                 ← tournaments/{tid}/sessions subcollection
├── entry.js                   ← tournaments/{tid}/entries subcollection
├── table.js                   ← tournaments/{tid}/tables subcollection
├── bountyDraw.js              ← tournaments/{tid}/bountyDraws subcollection
├── walletTransaction.js       ← players/{pid}/walletTransactions subcollection
└── ticket.js                  ← players/{pid}/tickets subcollection
```

One file per collection (plus the two embedded sub-schemas: `structure` and `payoutStructure`). One main exported schema per file, named for the singular form (e.g., `Tournament`, `Player`, `WalletTransaction`).

## Conventions

- **`.strict()` everywhere.** Unknown fields are rejected, not silently allowed through. Catches typos at write time.
- **`.superRefine()` for cross-field invariants.** Single-field validation (type, range, enum) lives on the field itself; anything that involves multiple fields (e.g., "satelliteConfig set iff gameType is 'satellite'", "isMultiFlight implies isMultiDay") lives in a superRefine block at the bottom of the schema.
- **Hard invariants** like `walletBalance >= 0` and `walletTransaction.amount > 0` are encoded in the validator (Money is `z.number().int().nonnegative()`; PositiveMoney is `z.number().int().positive()`). The wallet module also enforces these, but the validator is the safety net.
- **Default invariants with manager override** (e.g., ticket face-value rule) are NOT enforced in the validator — they live in the wallet module / UI flow. Validators only encode what should NEVER be true, not what is true by default.
- **Firestore Timestamp** is validated via `instanceof Timestamp`. This means tests have to either pass real Timestamp instances or stub the class.
- **Money is always integer cents AUD.** No decimals. Validator rejects floats.

## When the schema doc changes

The Zod schemas need to keep up with `docs/schema/canonical-schema.md`. The expected workflow:

1. Schema doc gets edited (a field added, a constraint relaxed, a new collection introduced).
2. The corresponding validator file here gets updated.
3. If the change breaks any callers, fix them.
4. Run `npm run lint` and `npm run build` to make sure nothing else broke.

This will happen frequently in Phases 2-4 as we hit the "real" requirements. Plan for it.

## What validators DON'T cover

For completeness:

- **Business logic** (e.g., correct prize-pool calculation, payouts assigned to the right players). Logic bugs live in the wallet / tournament modules.
- **Atomicity guarantees** (e.g., entry write + walletTransaction write succeed together). Use Firestore transactions in the wallet module; validators run inside each write.
- **Authorization** (who can write what). Firestore rules + UI role gates.
- **Cross-document invariants** (e.g., "structure index in bounds of the parent tournament's structure array"). Validators can't see other documents at parse time.

For these we rely on the corresponding module's logic. Validators are the shape-correctness layer, not the everything layer.

## Adding a new collection

1. Create `src/lib/schema/<singular>.js`.
2. Import primitives from `_shared.js`.
3. Define a `z.object({...}).strict()` matching the schema doc.
4. Add a `.superRefine()` block for cross-field invariants.
5. Export from `index.js`.
6. Update the file layout in this README.
