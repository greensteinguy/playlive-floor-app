# Canonical Firestore schema — v1 draft

> Phase 1 task 1.3 output. The contract for every Firestore read and write in the Floor App. Zod validators (task 1.4) implement these shapes; Firestore rules (task 1.2) enforce role-based access only (NOT business invariants — per the "enforce at app, not rules" decision in `DECISIONS.md`); the wallet module (task 1.7) uses these shapes for its ledger writes; the import (task R1.0b) converts Casinoware CSVs into these shapes.
>
> Status: **v1 draft 27 May 2026, revised same day after Guy's review.** Key revisions: dropped `fee` field (rake doesn't exist at this venue; only optional hospitality cost), `format` enum split into `isMultiDay` + `isMultiFlight` booleans, structure array now a discriminated union (`level` | `break`), `bsb`/`accountNumber` removed from players, recurring-schedule moved off templates onto per-tournament creation flow, "hard invariants" relaxed to "default behaviour with manager override."

---

## 1. Conventions

Apply across every collection.

**Collection naming.** Plural, camelCase (`tournaments`, `players`, `walletTransactions`). Subcollections same convention.

**Document IDs.** Opaque UUID v4 unless there's a strong reason otherwise. Imported records preserve their Casinoware ID in a `legacyId` field for cross-reference, but the document ID itself is a fresh UUID.

**Money.** Always **integer cents AUD**. Field names are plain (`buyIn: 10000` means $100). Validators assert integers; floats are a write-time error. Casinoware-CSV import multiplies dollar amounts by 100.

**Timestamps.** Firestore `Timestamp`. Always stored UTC. Rendering converts to venue local (Australia/Melbourne) in the UI.

**Soft delete.** Prefer `archivedAt: Timestamp | null` over hard delete. Preserves audit history. Hard delete only for things genuinely never needed again (e.g., a cancelled, never-played draft tournament).

**Standard audit fields.** Every collection has:
- `createdAt: Timestamp`
- `updatedAt: Timestamp`
- `createdBy: string` (Firebase Auth uid)

Exception: `walletTransactions` (immutable — once written, never edited; `timestamp` + `actorId` fields suffice, no need for separate createdAt/updatedAt).

**Field naming.** camelCase. Booleans prefixed with `is`/`has`/`can` (e.g., `isOnBreak`, `hasAddOn`, `canReenter`).

**Enums.** Stored as strings. All enum values in this doc are lowercase camelCase (e.g., `'lateRegOpen'`). Validators enforce against the enum's known set.

**Subcollection paths.** Where an entity clearly "belongs to" a parent (entries to a tournament, transactions to a player), use subcollections. Cross-entity queries use Firestore collection group queries. Detailed rationale in the section header below.

**References.** Foreign-key references are the referenced document's ID as a string. Where the relationship is denormalized for query performance (e.g., entries hold their tournamentId for collection-group filtering), this is called out per field.

**Optional fields.** Marked `| null` in this doc. The Zod validator's optional fields default to `null`, never `undefined`.

---

## 2. Collection topology

**Top-level collections** (six):

| Collection | Purpose |
|---|---|
| `tournaments` | Each tournament instance. |
| `players` | Player profiles, including derived `walletBalance` and `ticketBalance`. |
| `withdrawalRequests` | The cashier-managed withdrawal queue. Top-level because it's a staff queue, not a per-player view. |
| `structureTemplates` | Reusable blind structures. |
| `tournamentTemplates` | Reusable full tournament configurations (may reference a structure template). |
| `auditLog` | All sensitive actions and sensitive-field reads. |

**Subcollections** (six):

| Path | Purpose |
|---|---|
| `players/{pid}/walletTransactions/{txId}` | Append-only ledger per player. Collection group query for global/daily reconciliation. |
| `players/{pid}/tickets/{ticketId}` | Tickets owned by a player. |
| `tournaments/{tid}/sessions/{sid}` | Per-day or per-flight session records. |
| `tournaments/{tid}/entries/{eid}` | Per-buy-in entry records. Collection group query for "all entries for player X". |
| `tournaments/{tid}/tables/{tid}` | Live table state, per-session. |
| `tournaments/{tid}/bountyDraws/{drawId}` | Mystery Bounty draws as they happen. |

Why subcollections and not top-level for entries / walletTransactions / tickets / etc.: see §1. The path expresses ownership; collection group queries make cross-parent queries cheap; no Firestore 1MB-document-limit risk; atomic per-entity writes.

---

## 3. Top-level collections

### 3.1 `tournaments`

The configuration and live state of a single tournament instance.

```
tournaments/{id}
  // Identity
  id:                          string          (UUID v4)
  legacyId:                    number | null   (Casinoware ttid for imported tournaments)

  // Identity & display
  name:                        string          (internal name)
  shortDescription:            string          (1-line description shown on lists)

  // Multi-day / multi-flight. Two denormalized booleans (cached from the sessions
  // subcollection, see §5.1). Hierarchy: every multi-flight tournament is also
  // multi-day, but not vice versa. Validator enforces: isMultiFlight implies isMultiDay.
  // Detailed definitions:
  //   isMultiDay     = max(dayNumber across sessions) > 1
  //   isMultiFlight  = any dayNumber across sessions has more than one session
  // Updated alongside any change to the sessions subcollection.
  isMultiDay:                  boolean
  isMultiFlight:               boolean

  gameType:                    'nlh' | 'plo' | 'plo5' | 'omaha' | 'horse' | 'stud'
                              | 'mixed' | 'mainEvent' | 'mysteryBounty' | 'satellite'

  // Money (integer cents AUD). No rake/fee at this venue — only an optional hospitality cost.
  buyIn:                       integer         (goes entirely into the prize pool)
  hospitalityCost:             integer         (optional venue charge for food/drink; 0 = no hospitality.
                                                Player pays buyIn + hospitalityCost on entry. Hospitality
                                                does NOT enter the prize pool — venue keeps it.)
  guarantee:                   integer         (0 = no guarantee)
  houseConsumption:            integer         (venue's total cost budget for this tournament; includes trophy if any.
                                                Tracked for analytics — not deducted from prize pool.)

  // Structure
  structureTemplateId:         string | null   (optional ref to structureTemplates)
  startingStack:               number          (chip count, not money)

  // Scheduling
  scheduledStartTime:          Timestamp
  lateRegCutoffTime:           Timestamp | null  (null = late reg open until manually closed)

  // Status (orthogonal: status + isOnBreak + pausedAt are independent)
  status:                      'draft' | 'scheduled' | 'lateRegOpen' | 'lateRegClosed' | 'finished' | 'cancelled'
  isOnBreak:                   boolean         (true during scheduled break between levels; orthogonal to status)
  pausedAt:                    Timestamp | null  (set when manually paused, cleared on resume; orthogonal to status)

  // Reentry config
  reentryConfig: {
    type:                      'freezeout' | 'reentry' | 'rebuy'
    maxReentries:              number | null   (null = unlimited; ignored when type == 'freezeout')
    maxRebuys:                 number | null   (null = unlimited; ignored when type == 'freezeout')
    hasAddOn:                  boolean
  }

  // Side bets
  hasUpperDeckMainDeck:        boolean         (= last-longer side bet enabled; same concept per F3)

  // Satellite-specific config (null for non-satellite formats)
  satelliteConfig: {
    ticketReward:              integer         (cents; the value of the ticket awarded on milestone)
    // Milestone threshold (chip multiple) is derived at runtime:
    //   threshold = (ticketReward / buyIn) * startingStack
    // Stored derivation prevents drift; not persisted.
  } | null

  // Mystery Bounty-specific config (null for non-mysteryBounty formats)
  bountyPoolConfig: {
    totalPool:                 integer         (cents; total bounty pool size)
    bountyValues:              integer[]       (cents; array of individual bounty values that can be drawn)
    // Drawn bounties recorded in bountyDraws subcollection.
    // "Remaining" = bountyValues minus drawn ones, computed at runtime.
  } | null

  // Templates & recurrence
  fromTemplateId:              string | null   (ref to tournamentTemplates if instantiated from one)

  // Live state (populated as the tournament runs)
  currentStructureIndex:       number | null   (null until tournament starts; 0-indexed pointer into the embedded structure array.
                                                Can point to either a level or a break entry. Kept in sync with the active session's value.)

  // Derived counters (maintained atomically with entry writes; cached for fast list display)
  entryCount:                  number          (total entries including re-entries)
  uniquePlayerCount:           number          (distinct players)
  remainingPlayerCount:        number
  totalPrizePool:              integer         (cents; entryCount * buyIn — entire buyIn goes to the prize pool;
                                                hospitalityCost does NOT contribute; houseConsumption is venue's cost,
                                                not deducted)

  // Final results (populated at tournament end)
  finishedAt:                  Timestamp | null

  // Standard
  createdAt, updatedAt, createdBy
  archivedAt:                  Timestamp | null
```

**Notes**

- `status` is the lifecycle. `isOnBreak` and `pausedAt` are orthogonal — a tournament can be `lateRegOpen` AND `isOnBreak: true` simultaneously (per Guy's correction).
- `currentStructureIndex` points at an index in the embedded structure array — which can be either a level entry or a break entry (the array is a discriminated union — see below). The structure itself is copied from `structureTemplateId` at create time and may be edited per-tournament without affecting the template.
- Visibility on the Player App: any tournament with `status !== 'draft'` is visible. No separate `isPublished` field (per Guy's decision; that was a legacy artefact).

**Embedded structure** (per tournament, copied at create time): a flat sequenced array of either `level` or `break` entries. Breaks are first-class steps in the structure (they take real time at designated points), so they live in the array alongside levels. Only `level` entries have a `blindNumber`; `blindNumber` increments across levels only, not across breaks.

```
tournaments/{id}.structure: Array<
  | {
      type:                    'level'
      blindNumber:             number          (1, 2, 3, ...; increments only across level entries, not breaks)
      smallBlind:              number          (chip count)
      bigBlind:                number          (chip count)
      ante:                    number          (0 = no ante)
      bringIn:                 number          (0 except for stud variants)
      durationMinutes:         number
    }
  | {
      type:                    'break'
      durationMinutes:         number
      label:                   string | null   (optional; e.g. "Dinner break", "Chip color-up", "Stretch")
      isColorUp:               boolean         (true if a chip color-up happens during this break)
    }
>
```

Validator enforces: `blindNumber` values on `level` entries are sequential 1, 2, 3, … (no gaps, no duplicates).

**Embedded payout structure** (per tournament):

```
tournaments/{id}.payoutStructure: {
  type:                        'byPlace' | 'byPercent'
  rounding:                    'nearest5' | 'nearest10' | 'none'
  positions:                   Array<{
    place:                     number          (1, 2, 3, ...)
    payout:                    integer         (cents; absolute for 'byPlace')
    percent:                   number | null   (0..1; for 'byPercent', null for 'byPlace')
  }>
}
```

(Mystery Bounty's bounty-pool config is separate, in `bountyPoolConfig` above.)

---

### 3.2 `players`

```
players/{id}
  id:                          string          (UUID v4)
  legacyId:                    number | null   (Casinoware player ID for imported)

  // Names
  firstName:                   string          (mandatory)
  lastName:                    string          (mandatory)
  displayName:                 string | null   (override for unusual cases — "Lname, Fname" or chosen handle)

  // Contact
  phone:                       string          (mandatory; stored as entered, no format normalization in v1)
  email:                       string | null
  streetAddress:               string | null

  // Country (legacy 'ensign' field; used for flag display)
  countryCode:                 string | null   (ISO 3166-1 alpha-2, e.g. "AU")

  // NOTE: bank details (BSB, account number) deliberately NOT stored in v1.
  // Bank-transfer withdrawals capture destination details out-of-band (handled
  // by venue staff outside the Floor App). Per Guy's call on 27 May 2026:
  // sensitivity of stored bank data isn't worth the compliance / breach
  // surface in v1. Revisit in v1.5+ if a workflow needs it.

  // Derived / cached (updated atomically with walletTransaction writes)
  walletBalance:               integer         (cents; always >= 0 by hard invariant — see wallet-design.md §6)
  ticketBalance:               integer         (cents; sum of unused ticket face values)
  totalDeposited:              integer         (cents; lifetime sum of deposit-type transactions)

  // Merge history (per Phase 1 task 1.8 — duplicate merge tool)
  isMerged:                    boolean         (true if this player was merged into another; if true, do not use for new operations)
  mergedIntoId:                string | null   (the destination player id)
  mergedAt:                    Timestamp | null

  // Standard
  createdAt, updatedAt, createdBy
  archivedAt:                  Timestamp | null
```

**Notes**

- Phone is mandatory (matches SOW §3.2). v1 stores as entered (no E.164 normalization) — easier UX, defer normalization to v1.5+ if a search bug surfaces.
- Bank details (BSB, account number) deliberately not stored in v1 — see note in the field list above.
- The derived balances (`walletBalance`, `ticketBalance`, `totalDeposited`) are kept in sync via the wallet module (task 1.7). They are conceptually a cache of the player's `walletTransactions` subcollection; if drift is ever detected, the cache can be rebuilt by summing the ledger.

---

### 3.3 `withdrawalRequests`

```
withdrawalRequests/{id}
  id:                          string          (UUID v4)
  playerId:                    string          (ref → players/{id})

  amount:                      integer         (cents)
  payoutMethod:                'cash' | 'eftposRefund' | 'bankTransfer'

  state:                       'pending' | 'completed' | 'cancelled'

  // Two-step pattern (per SOW §3.4)
  requestedBy:                 string          (auth uid; any Cashier or Manager)
  requestedAt:                 Timestamp

  completedBy:                 string | null   (auth uid; MUST be a Manager — enforced at rules layer)
  completedAt:                 Timestamp | null
  externalReference:           string | null   (bank transfer ref, EFTPOS approval, etc.)
  walletTransactionId:         string | null   (ref to the walletTransaction that debited the wallet on complete)

  cancelledBy:                 string | null
  cancelledAt:                 Timestamp | null
  cancelReason:                string | null

  // Standard (createdAt == requestedAt; updatedAt tracks state changes)
  createdAt, updatedAt
```

**Notes**

- Atomic completion: marking `state: 'completed'` and writing the corresponding `walletTransactions` row (type `withdrawal_complete`, debits player.walletBalance) happen in one Firestore transaction. The new walletTransaction's `relatedDocId` references this request, and this request's `walletTransactionId` references that transaction.

---

### 3.4 `structureTemplates`

```
structureTemplates/{id}
  id:                          string          (UUID v4)
  name:                        string          (e.g., "Standard 30-min", "Turbo 15-min", "Deep 60-min")
  description:                 string | null

  levels:                      Array<{         (same shape as tournament's embedded structure — see §3.1)
    blindNumber:               number
    smallBlind:                number
    bigBlind:                  number
    ante:                      number
    bringIn:                   number
    durationMinutes:           number
    breakAfterMinutes:         number
    isColorUp:                 boolean
  }>

  // Standard
  createdAt, updatedAt, createdBy
  archivedAt:                  Timestamp | null
```

**Notes**

- When a tournament references a structure template via `structureTemplateId`, the template's `levels` are **copied** into `tournaments/{id}.structure` at create time. Editing the template later does not affect already-created tournaments.

---

### 3.5 `tournamentTemplates`

```
tournamentTemplates/{id}
  id:                          string          (UUID v4)
  name:                        string          (e.g., "Wednesday Night NLH")
  description:                 string | null

  // The tournament config this template represents. Same field shape as the equivalent
  // fields on tournaments/{id} — see §3.1. The schema doc does NOT re-list them all;
  // the validator (task 1.4) shares a sub-schema between tournamentTemplate.config
  // and tournament-creation-input.
  config: {
    name:                      string          (default name for instantiated tournaments)
    shortDescription:          string
    isMultiDay, isMultiFlight: boolean         (defaults for instantiated tournaments)
    gameType:                  same enum as tournaments
    buyIn, hospitalityCost, guarantee, houseConsumption:  integers (cents)
    structureTemplateId:       string | null
    startingStack:             number
    reentryConfig:             same shape as tournaments
    hasUpperDeckMainDeck:      boolean
    satelliteConfig:           same shape as tournaments
    bountyPoolConfig:          same shape as tournaments
  }

  // Standard
  createdAt, updatedAt, createdBy
  archivedAt:                  Timestamp | null
```

**Notes**

- Templates carry **only** the static config. Recurrence is **not** a property of a template — it's a choice the manager makes when creating a tournament instance.
- Recurrence flow (Phase 2 task 2.5): when creating a tournament (from a template or from scratch), the manager can optionally tick "make this recurring" and pick a window (next 1 month / 6 months / 1 year). The system bulk-creates N tournament instances upfront (one per week for the chosen window), all configured identically. Each instance is independent after creation — editing or cancelling one does not affect the others. The shared `fromTemplateId` (when applicable) is the link that groups them for reporting; no separate `recurringSeriesId` field needed in v1.

---

### 3.6 `auditLog`

```
auditLog/{id}
  id:                          string          (UUID v4)
  timestamp:                   Timestamp
  actorId:                     string          (auth uid; 'system' for migration / scheduled jobs)
  actorRole:                   'manager' | 'td' | 'cashier' | 'readonly' | 'system'

  actionType:                  string          (dot-separated; see well-known types below)

  targetType:                  string | null   ('player' | 'tournament' | 'walletTransaction' | 'withdrawalRequest' | 'entry' | etc.)
  targetId:                    string | null

  metadata:                    map             (free-form context; see per-action conventions below)
```

**Well-known `actionType` values**

| actionType | When written |
|---|---|
| `auth.signIn` | User signs in. |
| `auth.signOut` | User signs out. |
| `player.created` | New player record created. |
| `player.updated` | Player profile edited. |
| `player.merged` | Duplicate-merge tool merged player A into player B. |
| `manager.override` | A manager bypassed a default invariant (e.g., allowed a wallet balance to go negative, allowed a ticket to be split below face value). `metadata.overrideType` + `metadata.reason` + relevant context. Required by the "enforce at app, not rules" philosophy — see DECISIONS.md. |
| `tournament.created` | Tournament doc created (draft or scheduled). |
| `tournament.published` | Tournament moved from draft to scheduled. |
| `tournament.statusChanged` | Status enum changed. `metadata.from` / `metadata.to`. |
| `tournament.paused` / `tournament.resumed` | Manual pause. |
| `tournament.cancelled` | Manual cancellation. |
| `tournament.structureEdited` | Embedded structure edited mid-tournament. `metadata.diff`. |
| `tournament.payoutEdited` | Embedded payout structure edited. |
| `tournament.dealEntered` | Manual deal-making entry recorded. `metadata.payouts`. |
| `entry.created` | Player registered for a tournament. `metadata.paymentMethod`. |
| `entry.busted` | Bust-out recorded. `metadata.place`. |
| `entry.voided` | Entry voided (data-entry error). |
| `wallet.deposit` | Deposit recorded. `metadata.amount`, `metadata.method`. |
| `wallet.spend` | Spend recorded. `metadata.amount`, `metadata.method`. |
| `wallet.ticketUse` | Ticket used. |
| `wallet.winCredit` | Winnings credited (after cashier confirm). |
| `wallet.adjustment` | Compensating ledger entry — used for fixing data-entry mistakes. `metadata.direction`, `metadata.reason`. |
| `wallet.managerCredit` | Manager-authorized credit (comp, goodwill, extending credit). `metadata.amount`, `metadata.reason`. Distinct from `wallet.adjustment` so reconciliation can separate intentional credits from corrections. |
| `wallet.managerDebit` | Manager-authorized debit (recouping over-credit, etc.). `metadata.amount`, `metadata.reason`. HARD wallet ≥ 0 invariant still applies. |
| `withdrawal.requested` | Withdrawal request created by Cashier or Manager. |
| `withdrawal.completed` | Withdrawal marked complete by Manager. |
| `withdrawal.cancelled` | Pending withdrawal cancelled. |

**Notes**

- Audit log writes are best-effort during application flow; they should never block or fail the underlying operation. Use a write-then-continue pattern (fire-and-forget with error logging).
- `metadata` is intentionally schemaless — different action types carry different context. Documented conventionally in the wallet module / UI layer, not in this schema.

---

## 4. Subcollections under `players/{pid}`

### 4.1 `players/{pid}/walletTransactions`

Per-player append-only ledger. **Immutable** — corrections go via compensating `adjustment` entries, not edits.

```
players/{pid}/walletTransactions/{id}
  id:                          string          (UUID v4)
  playerId:                    string          (denormalized; matches {pid} in path — useful for collection group queries)

  type:                        'deposit' | 'spend' | 'ticketUse' | 'winCredit'
                              | 'withdrawalRequest' | 'withdrawalComplete' | 'withdrawalCancel'
                              | 'adjustment' | 'openingBalance'
                              | 'managerCredit' | 'managerDebit'

  amount:                      integer         (cents; always >= 0 — type determines direction, per Q3)

  method:                      'cash' | 'eftpos' | 'payid' | 'wallet' | 'ticket' | null
                              // null for: withdrawalRequest, withdrawalComplete, withdrawalCancel, winCredit,
                              //           adjustment, openingBalance, managerCredit, managerDebit

  reference:                   string | null   (EFTPOS approval, PayID txid, "cash", free text, or "opening_balance")

  relatedDocId:                string | null
                              // entries/{id} for spend & ticketUse
                              // withdrawalRequests/{id} for the three withdrawal_* types
                              // tickets/{id} for ticketUse (in addition to entry)
                              // null otherwise

  actorId:                     string          (auth uid; 'system' for openingBalance imports)
  actorRole:                   'manager' | 'td' | 'cashier' | 'system'

  timestamp:                   Timestamp
  notes:                       string | null
```

**Effect on `players/{pid}.walletBalance`** (this mapping is enforced by the wallet module, task 1.7):

| type | Effect on walletBalance |
|---|---|
| `deposit` | +amount |
| `spend` (method == 'wallet') | -amount |
| `spend` (other methods) | 0 (ledger row exists for audit; balance unaffected) |
| `ticketUse` | 0 (cash balance unaffected; consumes a ticket — see §4.2) |
| `winCredit` | +amount |
| `withdrawalRequest` | 0 (request only) |
| `withdrawalComplete` | -amount |
| `withdrawalCancel` | 0 |
| `adjustment` | per `metadata.direction` (`+` or `-`); used for **fixing data-entry mistakes** |
| `openingBalance` | +amount |
| `managerCredit` | +amount; used for **intentional manager-authorized credits** (comps, goodwill, extending credit). Manager-only operation. |
| `managerDebit` | -amount; used for **intentional manager-authorized debits** (recouping over-credit, etc.). Manager-only. HARD wallet ≥ 0 invariant still applies — debit cannot push balance negative. |

**Hard invariant**: after any write, `players/{pid}.walletBalance >= 0` must hold. Enforced at the wallet module layer AND at Firestore rules (defence in depth). No override path. Per Q6 in wallet-design.md.

---

### 4.2 `players/{pid}/tickets`

```
players/{pid}/tickets/{id}
  id:                          string          (UUID v4)
  playerId:                    string          (denormalized for collection-group filtering)

  faceValue:                   integer         (cents)
  state:                       'unused' | 'used'

  issuedAt:                    Timestamp
  issuedReason:                string | null   ('satelliteWin' | 'comp' | 'openingBalance' | free text)
  issuedFromTournamentId:      string | null   (if won from a satellite)

  usedAt:                      Timestamp | null
  usedOnEntryId:               string | null
  usedOnTournamentId:          string | null

  createdAt, updatedAt
```

**Notes**

- Tickets are tournament-entry only in v1 (per Q5 in wallet-design.md).
- Ticket use rule: a ticket may only be used on a tournament where total cost (buyIn + fee + hospitality) >= faceValue. Enforced at wallet module + rules.
- Top-up: if total cost > faceValue, the gap is paid by another method, recorded as a second `walletTransactions` row of that method's type with `relatedDocId` pointing at the same entry.

---

## 5. Subcollections under `tournaments/{tid}`

### 5.1 `tournaments/{tid}/sessions`

```
tournaments/{tid}/sessions/{id}
  id:                          string          (UUID v4)
  tournamentId:                string          (denormalized)

  // ── Routing (authoritative) ──────────────────────────────────────────────
  // Player progression follows this pointer ONLY. From a player's originSessionId,
  // walk convergesIntoSessionId repeatedly until either the entry busts or the
  // chain ends (null). Never derive routing from dayNumber, flightLabel, or
  // sessionLabel — those are display fields and can have unusual values.
  // Multiple sessions can converge into the same later session (typical multi-flight).
  // A given session has at most ONE downstream session (no fan-out on a single session).
  // Set once at tournament setup; read-only at runtime.
  convergesIntoSessionId:      string | null   (null = this is the final session)

  // ── Display / query metadata (NOT used for routing) ──────────────────────
  // dayNumber is the calendar day this session falls on within the tournament.
  // flightLabel distinguishes parallel flights within the same day.
  // sessionLabel is the human-readable name. All three exist for UI rendering,
  // sort ordering, and queries like "show all Day 1 sessions" — never for
  // deciding where a player goes next.
  dayNumber:                   number          (1, 2, 3, ...)
  flightLabel:                 string | null   ('A', 'B', 'C', ...; null when the day has only one session)
  sessionLabel:                string          ("Day 1A", "Day 2", "Final" — derived from day+flight but stored)

  // ── Slice caps (set at session creation, by the manager) ────────────────
  // The MAXIMUM slice of tournaments/{tid}.structure this session can play.
  // Names reflect that these are caps, not predictions — actual playthrough
  // can be earlier on either end.
  //
  // Inclusive indices. Multi-flight parallel sessions on the same day share the
  // same maximum slice. Sessions on different days have non-overlapping maximum
  // slices. The session may end before maximumEndIndex if playToPercentRemaining
  // trips; may start before maximumStartIndex due to rollback (see below).
  //
  // maximumEndIndex is nullable for "play to a winner" sessions — typically the
  // final session of a tournament that plays until heads-up resolves. When null,
  // the session has no level cap and ends only when playToPercentRemaining trips
  // or via a manual operation.
  maximumStartIndex:           number
  maximumEndIndex:             number | null

  // ── Termination criterion ────────────────────────────────────────────────
  // Session ends when EITHER maximumEndIndex is reached OR this threshold trips,
  // whichever comes first. Null = play through the full slice (or to a winner
  // for the final session).
  // Typical usage: set on Day 1 / Day 1A / Day 1B (e.g., 15 = end at 15% of starting
  // field); null for Day 2+ which just play to the bubble or to the win.
  playToPercentRemaining:      number | null

  // ── Runtime: actual slice played ─────────────────────────────────────────
  // Filled in as the session runs.
  //   actualStartIndex is set when the session begins. For a session converged INTO
  //   from multiple upstream sessions, the wallet/tournament module derives it as
  //   min(upstream actualEndIndex) + 1 — the "rollback" that ensures no player skips
  //   levels when flights end at different points. For non-converged successors
  //   (single-flight progression), actualStartIndex = upstream.actualEndIndex + 1
  //   (which equals maximumStartIndex when the upstream played its full slice).
  //   actualEndIndex is set when the session ends. May be < maximumEndIndex if
  //   playToPercentRemaining tripped first, or if it's the final "play to a winner"
  //   session and play ended at whatever level the win was settled on.
  // The actual slice the session played is structure[actualStartIndex..actualEndIndex].
  actualStartIndex:            number | null   (>= 0; usually <= maximumStartIndex but manager can override)
  actualEndIndex:              number | null   (>= actualStartIndex; if maximumEndIndex set, also <= maximumEndIndex)

  scheduledStartTime:          Timestamp
  actualStartTime:             Timestamp | null
  actualEndTime:               Timestamp | null

  status:                      'scheduled' | 'inProgress' | 'finished' | 'cancelled'

  // Live state — current position in the structure (between actualStart and actualEnd inclusive once running)
  currentStructureIndex:       number | null   (0-indexed pointer into tournaments/{tid}.structure;
                                                can be a level or break entry; null until session starts)
  remainingPlayerCount:        number | null

  createdAt, updatedAt, createdBy
```

**Validator constraints on slicing**

- `maximumStartIndex < structure.length`
- If `maximumEndIndex` is set: `maximumStartIndex <= maximumEndIndex < structure.length`
- Same `dayNumber` sessions have identical `maximumStartIndex` and `maximumEndIndex` (parallel flights share a slice)
- Different `dayNumber` sessions have non-overlapping maximum slices (overlap is a runtime concept, only introduced by rollback)
- If `maximumEndIndex` is null AND `playToPercentRemaining` is null, the session must be the final session (i.e., `convergesIntoSessionId == null`). Otherwise the session has no termination criterion and the chain can't progress.
- When set, `actualStartIndex >= 0`
- When set, `actualEndIndex >= actualStartIndex`; if `maximumEndIndex` is set, also `actualEndIndex <= maximumEndIndex`
- `currentStructureIndex` when set must be in `[actualStartIndex, actualEndIndex]` (or `[actualStartIndex, structure.length - 1]` if `maximumEndIndex`/`actualEndIndex` is unbounded and play is ongoing)

**Rollback in detail (the multi-flight case)**

When a Day 2 session is about to start and it has multiple converged-from sessions (Day 1A, Day 1B, Day 1C), the tournament module:

1. Queries all upstream sessions: `db.collection(...).where('convergesIntoSessionId', '==', day2.id)`
2. Reads their `actualEndIndex` values
3. Sets `day2.actualStartIndex = min(upstream actualEndIndex) + 1`

The rollback is automatic and deterministic — no manager input needed. A manager can override the computed `actualStartIndex` in the UI (e.g., to skip the rollback for some reason) and the override is audit-logged.

**Notes**

- **Routing is via `convergesIntoSessionId` only** (see field comment above). Never use `dayNumber` / `flightLabel` for routing logic — they're display-only and may carry unusual values in edge cases.
- **Structure slicing:** every session has a **maximum** slice (`maximumStartIndex` + `maximumEndIndex`) — the cap the manager set at setup, with `maximumEndIndex` nullable for "play to a winner" final sessions — and an **actual** slice (`actualStartIndex` + `actualEndIndex`) — what really got played. They can differ because (a) `playToPercentRemaining` can trigger early termination so `actualEndIndex < maximumEndIndex`, and (b) for multi-flight, downstream sessions roll back to `min(upstream actualEndIndex) + 1` when their flights ended at different levels. See the validator constraints + rollback explanation just below the schema block.
- **Single-day:** 1 session, `dayNumber=1`, `flightLabel=null`, `convergesIntoSessionId=null`. `maximumStartIndex=0`, `maximumEndIndex` is typically `null` (play to a winner) or set to the structure's last index for a strict cap.
- **Multi-day, single-flight:** N sessions, `dayNumber` ascending 1..N, `flightLabel=null` on each. Each session's `convergesIntoSessionId` points to the next; the last has `null`. Maximum slices are contiguous and non-overlapping (Day 1: max=[0..14], Day 2: max=[15..22], …). The final day typically has `maximumEndIndex=null` (play to a winner).
- **Multi-flight (typical Main Event):** Day 1 has multiple flights (`dayNumber=1`, `flightLabel='A' | 'B' | ...`), each with the **same maximum slice** ([0..14]) and `convergesIntoSessionId` pointing to the same downstream Day 2 session (whose maximum slice picks up at [15..]). The final session typically has `maximumEndIndex=null`.
- **Multi-flight across multiple days (rare but supported):** any `dayNumber` can have > 1 session with distinct `flightLabel`s; flights on the same day share a maximum slice. The convergence graph determines the flow; the day numbers are just labels.
- **Final session:** has `convergesIntoSessionId == null`. Validator enforces: exactly one session per tournament has this — there is a single eventual final session.
- **Entries** reference their originating session via `entries/{id}.originSessionId`. A player's still-alive sessions are derived by walking the `convergesIntoSessionId` chain from `originSessionId` until either the entry busts or the chain ends.
- **Tournament-doc booleans** `isMultiDay` and `isMultiFlight` (§3.1) are denormalized from this subcollection. Updated alongside any change to session structure. Definitions:
  - `isMultiDay = max(dayNumber across sessions) > 1` (uses dayNumber as a display field, which is fine — this is a summary stat, not routing)
  - `isMultiFlight = any dayNumber has > 1 session`

**How `convergesIntoSessionId` is populated — and the chicken-and-egg solution**

`convergesIntoSessionId` references another session's id, which means the downstream session must exist (or at least have a known id) before the upstream session can point at it. We resolve this by **creating all sessions for a tournament in one atomic write, with UUIDs generated client-side**:

1. Manager defines the day/flight shape in the UI (e.g., "3-day main, Day 1 has flights A and B, Day 2 single, Day 3 final").
2. App pre-generates UUID v4 ids for every session before any write.
3. App computes `convergesIntoSessionId` for each session against the in-memory id set (Day 1A and Day 1B both point at Day 2's pre-generated id; Day 2 points at Day 3's; Day 3 has null).
4. App writes all sessions in a single Firestore batched write. No dangling references possible; either the whole structure lands or none of it does.

**Mid-event structure changes** (adding a flight, splitting a day, etc.) follow the same atomic-batch pattern. The wallet/tournament module exposes structure-change operations that:
- Generate ids for any new sessions
- Rewire `convergesIntoSessionId` on affected sessions
- Write the whole change in one transaction
- Emit a `tournament.structureEdited` auditLog entry with the diff

Existing entries' `originSessionId` does not change; they pick up the new convergence via the session's updated pointer the next time the chain is walked. That means a structure change instantly reroutes all not-yet-busted players in the affected session — which is the intent.

---

### 5.2 `tournaments/{tid}/entries`

```
tournaments/{tid}/entries/{id}
  id:                          string          (UUID v4)
  legacyId:                    number | null   (Casinoware ENID)
  tournamentId:                string          (denormalized — enables collection group queries)
  playerId:                    string          (ref → players/{id})

  originSessionId:             string          (ref → sessions; the session this entry first played in)
  entryType:                   'initial' | 'reentry' | 'rebuy' | 'addOn'
  entryNumber:                 number          (1, 2, 3, ... per player per tournament — for re-entries)

  registeredAt:                Timestamp
  registeredBy:                string          (auth uid)

  // Payment (one entry = one payment; for re-entries, a new entry doc with a fresh payment)
  paymentMethod:               'cash' | 'eftpos' | 'wallet' | 'ticket'   (four methods — per Q1 in wallet-design.md)
  paymentAmount:               integer         (cents; total paid: buyIn + fee + hospitalityCost)
  paymentReference:            string | null   (EFTPOS approval, ticket id, etc.)
  walletTransactionId:         string | null   (ref to the walletTransactions doc for this payment)

  // Live state / outcome
  currentTableId:              string | null   (ref → tournaments/{tid}/tables/{id}; null when busted)
  currentSeatNumber:           number | null

  bustedAt:                    Timestamp | null
  bustedInSessionId:           string | null
  finishingPlace:              number | null   (1 = first, 2 = second, ...; null while alive or for satellite ticket winners)

  // Mystery Bounty earnings (cumulative; sourced from bountyDraws subcollection)
  bountyEarnings:              integer         (cents)
  bountiesKnockoutCount:       number          (count of bounties drawn against this entry's knockouts)

  // Cash winnings (sourced from payout calculator at end of tournament)
  cashWinnings:                integer         (cents)
  ticketWinnings:              integer         (cents; for satellite winners, the value of ticket awarded)

  // Last-longer side bet (Upper Deck / Main Deck split)
  lastLongerDeck:              'upper' | 'main' | null   (null when tournament has no split)
  isLastLongerWinner:          boolean         (false until settled)

  // Lifecycle
  voidedAt:                    Timestamp | null
  voidedBy:                    string | null
  voidReason:                  string | null

  notes:                       string | null

  createdAt, updatedAt
  // No createdBy (= registeredBy)
  // No archivedAt (voided is the soft-delete equivalent)
```

---

### 5.3 `tournaments/{tid}/tables`

One doc per table-instance-per-session. A "table 1" in Day 1 and a "table 1" in Day 2 are two separate docs (different `sessionId`s).

```
tournaments/{tid}/tables/{id}
  id:                          string          (UUID v4)
  tournamentId:                string          (denormalized)
  sessionId:                   string          (ref → sessions)

  tableNumber:                 number          (1, 2, 3, ... display number within this session)
  seatCount:                   number          (9 for NLH; can vary by format)

  openedAt:                    Timestamp | null  (first hand dealt)
  closedAt:                    Timestamp | null  (table broken or session ended)
  status:                      'open' | 'broken'

  // Seating (length matches seatCount; seatNumber is 1-indexed)
  seats:                       Array<{
    seatNumber:                number          (1..seatCount)
    entryId:                   string | null   (ref → entries; null = empty seat)
  }>

  createdAt, updatedAt
```

**Notes**

- `dealerMinutes` for the tournament is derived: `sum((closedAt - openedAt) for each table doc with closedAt != null)`. No separate field. Per Q3.
- For multi-day, tables close at end of session; new table docs created for the next session.
- Seat moves during balancing update two table docs in a single Firestore transaction.

---

### 5.4 `tournaments/{tid}/bountyDraws`

Recorded each time a Mystery Bounty is drawn on a knockout.

```
tournaments/{tid}/bountyDraws/{id}
  id:                          string          (UUID v4)
  tournamentId:                string          (denormalized)

  bountyValue:                 integer         (cents; the value drawn from bountyPoolConfig.bountyValues)
  drawnAt:                     Timestamp
  drawnBy:                     string          (auth uid — TD or Cashier who triggered the draw)

  knockedOutEntryId:           string          (ref → entries; the player who got knocked out)
  knockerEntryId:              string          (ref → entries; the player who did the knocking)

  walletTransactionId:         string | null   (ref to the winCredit walletTransaction once the cashier confirms — null until then)

  notes:                       string | null
```

**Notes**

- Drawing logic (Phase 4 task 4.2): on knockout, randomly select an undrawn value from `tournaments/{tid}.bountyPoolConfig.bountyValues`. "Undrawn" = not present in this subcollection. Write the bountyDraw doc; the eliminator's wallet is credited later when the cashier confirms (per Q4 in wallet-design.md — no auto-credit).
- "Remaining bounty pool" display = `bountyValues - sum(this subcollection's bountyValue)`.

---

## 6. Cross-cutting patterns

### 6.1 Atomicity guarantees

Operations that MUST be one Firestore transaction (either all writes succeed or none do):

1. **Pay-with-wallet at registration.** `entries` write + `walletTransactions` (type `spend`, method `wallet`) + `players/{pid}.walletBalance` decrement — all one transaction.
2. **Pay-with-ticket at registration.** `entries` write + `tickets` state change to 'used' + `walletTransactions` (type `ticketUse`) + (if top-up) a second `walletTransactions` (type `spend`, other method) — one transaction.
3. **Withdrawal complete.** `withdrawalRequests` state change to 'completed' + `walletTransactions` (type `withdrawalComplete`) + `players/{pid}.walletBalance` decrement — one transaction.
4. **Deposit.** `walletTransactions` (type `deposit`) + `players/{pid}.walletBalance` increment — one transaction (single subcollection write + parent doc update; trivial with Firestore.runTransaction).
5. **Win-credit confirm.** `walletTransactions` (type `winCredit`) + `players/{pid}.walletBalance` increment + (if Mystery Bounty) `bountyDraws/{id}.walletTransactionId` set — one transaction.
6. **Seat move (balancing).** Two `tables/{id}.seats` updates — one transaction.
7. **Player merge.** Both `players/{src}` and `players/{dst}` updates, plus reassignment of historical refs — one transaction (or a multi-step migration script if the data volume is large).

### 6.2 Default invariants (with manager override)

Per the "enforce at app, not rules" decision (see `DECISIONS.md`): most invariants are enforced at the **application / UI layer** with a manager override path for legitimate exceptions (favours to regulars, data-entry corrections, edge cases). Every override writes a `manager.override` entry to `auditLog` with `metadata.overrideType` and a manager-supplied reason. Firestore rules do NOT enforce these — rules cover role-based access only.

**Two exceptions are hard invariants with no override path** because violating them creates real venue liability or structural data corruption, not just a service-level favour: the wallet-balance non-negativity rule and the sign-convention rule.

| Invariant | Default | Override path |
|---|---|---|
| `players/{pid}.walletBalance >= 0` | Spend that would push balance < 0 is rejected at the wallet module layer. | **No override.** Wallet going negative creates real venue liability — not a "favour" managers can extend. Cashier must take a deposit or alternative payment first. |
| `walletTransactions/{id}.amount > 0` | Always positive (sign convention). | **No override** — sign convention is structural, not a business rule. |
| `withdrawalRequests/{id}.state` transitions | `pending → completed` requires Manager role. `pending → cancelled` allowed for Cashier or Manager. | Role gate is itself enforceable; managers can self-authorise. |
| `tickets/{id}.state` transitions | `unused → used` is the only transition. Face value must be ≥ tournament cost. | Manager can split a ticket or apply it below face value as a favour. Override logged. |
| `tournaments/{id}.status` transitions | Forward-only with one exception: `lateRegOpen ↔ lateRegClosed` toggles. `cancelled` and `finished` are terminal. | Manager can revert a `finished` tournament to `lateRegOpen` (e.g., data-entry correction). Override logged. |

### 6.3 Soft delete and merge

- Tournaments, players, structureTemplates, tournamentTemplates: soft-delete via `archivedAt`. Archived docs hidden from default queries but preserved for audit / history.
- Entries: soft-delete is called "voided" (`voidedAt` + `voidReason`). Voided entries don't count toward `entryCount`/`uniquePlayerCount` calculations.
- Players: in addition to `archivedAt`, can be **merged** into another player (`isMerged: true`, `mergedIntoId`). The duplicate-merge tool (task 1.8) does this. After a merge, all historical references to the source player are reassigned to the destination — but the source doc is kept (not hard-deleted) so the audit log entries pointing at the original UUID still resolve.

---

## 7. Indexes (Firestore composite indexes likely needed)

Listing here so they're not forgotten when the rules / data layer goes live:

- Collection group `entries` on `playerId` + `registeredAt desc` — for player history view.
- Collection group `walletTransactions` on `timestamp desc` — for daily reconciliation.
- Collection group `walletTransactions` on `type` + `timestamp desc` — for "all deposits today" etc.
- `withdrawalRequests` on `state` + `requestedAt asc` — for the cashier queue (oldest pending first).
- `tournaments` on `status` + `scheduledStartTime asc` — for "upcoming tournaments" list.
- `tournaments` on `status` + `scheduledStartTime desc` — for "recently finished" list.
- Subcollection `sessions` on `status` + `sessionNumber asc` — for "in-progress sessions" view.

The exact set materialises during build; this is the starting set.

---

## 8. Where this schema differs from legacy / supersedes other docs

- **Supersedes `docs/wallet-design.md` for collection placement.** The `wallets` collection is dropped; balance lives on `players`. `walletTransactions` and `tickets` move to subcollections of `players`. All other wallet design content (sign convention, transitions, withdrawal pattern, atomic guarantees) carries over and is referenced from this doc.
- **Bears no structural relation to the legacy `tournaments` collection in `playlive-25a17`.** Per Guy's decision, the legacy 1,695 docs are dropped and the collection name reclaimed. Migration (task R1.0a + R1.0b) goes Casinoware CSV → canonical schema, not legacy Firestore → canonical schema.
- **Sparse-array-as-map pattern** from legacy data (where Casinoware stored `{ "0": ..., "1": ... }` instead of arrays) is rejected by the validator. The import (R1.0b) unwraps these to real arrays before writing.
- **Money is integer cents** everywhere; legacy stored plain dollars. The import converts via × 100.

---

## 9. Resolved design questions

The five open mini-questions from the v1 draft are all answered. Folded into the doc body where they affect a field; recorded here for the audit trail.

| # | Decision |
|---|---|
| 1 | **Phone stored as entered, no E.164 normalization in v1.** Search normalizes at query time. Defer normalization to v1.5+ if a search bug surfaces. |
| 2 | **Recurring schedule is weekly-only in v1.** Monthly/biweekly are easy extensions of `recurringSchedule.cadence` later; flagging here so they're not forgotten when the venue asks. |
| 3 | **Last-longer settlement flow deferred to Phase 4 task 4.3.** Schema fields (`entries/{id}.lastLongerDeck`, `isLastLongerWinner`) are in place; the settlement UI / logic specification comes when 4.3 is built. |
| 4 | **No first-class `deals` data model.** Deal-making is a UI flow only (Phase 4 task 4.5): cashier triggers, edits payouts per player, confirms. Each affected `entries/{id}.cashWinnings` is set directly. The `tournament.dealEntered` auditLog entry records what changed and why. |
| 5 | **Multi-day "alive at start of next session" computed on read, not cached.** Compute-cost is ~one query per session boundary, ~200 doc reads for a typical multi-day field — cheap and infrequent. Avoids the maintenance cost of a `survivingEntryIds` cache that would need updating on every bust-out. |
