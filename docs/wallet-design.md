# Wallet & payments — v1 design note

> Phase 0 task 0.6. Captures the real-world flow observed during Guy's registration-desk shadowing, then designs the v1 wallet ledger shape that supports it. Feeds Phase 1 task 1.7 (wallet ledger module) and Phase 3 tasks 3.4–3.6 (registration + payment + deposit UI).
>
> Status: **drafted from Guy's walkthrough notes (27 May 2026).** Q1 below is the load-bearing decision — it shifts the registration UI from a five-method picker to a four-method picker. Once Guy confirms, this doc becomes the design contract for Phase 1 and Phase 3.

## 1. The core principle (unchanged)

The Floor App **records** that money moved. It does not move money. Money continues to flow through the venue's existing systems:

| Method | Where the actual money lives / moves through |
|---|---|
| Cash | Cash till |
| EFTPOS | EFTPOS terminal → bank settlement |
| PayID | Venue banking app, player initiates transfer to venue PayID |

The Floor App's job is to capture _that_ a transaction happened, with enough metadata (method, amount, reference, actor, timestamp) for the venue to reconcile against the underlying bank/EFTPOS/till records at end of day.

This keeps the Floor App out of the compliance critical path — see SOW §5.7 and DECISIONS.md.

## 2. The two flows the wallet supports

### 2.1 Deposit-to-wallet flow

Money in. Player gives the venue money (cash / EFTPOS / PayID) — the venue holds it as a liability owed back to the player.

| Step | What happens in the real world | What the Floor App does |
|---|---|---|
| 1 | Player at registration desk says "I want to put $500 in my account." | Cashier opens deposit screen on the player's profile. |
| 2 | Player hands over cash / taps EFTPOS / initiates PayID transfer to venue PayID. For PayID, the **PayID wizard** in the Floor App guides the cashier through giving the player the venue's PayID details and watches for confirmation. | App captures method + amount + reference (e.g. EFTPOS approval code, PayID transaction ID, "cash" for cash). |
| 3 | Cashier confirms the money is in hand / settled. | App writes a `walletTransactions` row of type `deposit` and updates the cached `wallets/{playerId}.balance`. |

**Deposit methods:** cash, EFTPOS, PayID. Three.

### 2.2 Tournament-pay flow

Money out (or moved internally). Player pays for a tournament entry.

| Step | What happens in the real world | What the Floor App does |
|---|---|---|
| 1 | Player wants to enter tournament X. Total cost = buy-in + fee + hospitality. | Cashier opens registration on the tournament. Searches / picks player. |
| 2 | Cashier asks payment method. Player picks one of: ticket, cash, EFTPOS, from wallet. | App shows method picker. |
| 3 | Money moves per the chosen method (cash to till, tap EFTPOS, debit wallet balance, debit ticket balance). | App writes an `entries` row and a `walletTransactions` row of type `spend` (with `method` recording how it was paid). |

**Tournament-pay methods:** ticket, cash, EFTPOS, from wallet. **Four.** Not five.

The four-method model comes from Guy's walkthrough note: _"all PayID gets deposited into account beforehand via a wizard available through the registration screen."_ PayID is never a direct tournament-pay method — it's always a wallet deposit first, then the player pays from wallet. The PayID wizard lives on the registration screen for convenience (so a player can deposit-and-then-pay in one sitting) but the two steps are recorded as two transactions: deposit, then spend-from-wallet.

This contradicts SOW v0.4 §3.4 (which lists PayID as a tournament-pay method). **Q1 in §7 below** asks Guy to confirm the four-method model so the SOW gets updated in v0.5.

### 2.3 Other ledger events

| Event | What it is |
|---|---|
| `ticket_use` | Player pays with a ticket. Ticket has face value F, tournament cost C. Allowed only when F ≥ C. If F > C, the difference goes to the venue. If C > F, the gap is topped up with another method, recorded as a second `walletTransactions` row of that method. |
| `win_credit` | Tournament ends, player finishes ITM. **The cashier confirms each payout before the credit lands** — no auto-credit (Q4 resolution). The UI shows the calculated payout amount and a confirm action; on confirm, the ledger row is written and the wallet balance updates. |
| `withdrawal_request` | Player asks for money back. Records desired payout method (cash, EFTPOS refund, bank transfer to stored BSB/account), amount, requested-by, requested-at. State: `pending`. No wallet balance change yet. |
| `withdrawal_complete` | Manager marks a pending request completed (after venue staff have moved the money externally). State: `completed`. Wallet balance debits at this point — not at request time. |
| `withdrawal_cancel` | Pending request cancelled. No balance change. |

The **two-step withdrawal pattern** (Cashier creates, Manager completes) is the only spend that splits across two distinct ledger writes from two different actors. It protects against "marked completed without money actually being paid" — see SOW §9.

## 3. Ledger shape (skeleton)

The authoritative source of truth for a player's balance is the `walletTransactions` ledger. `wallets/{playerId}` is a cached summary for fast reads. The ledger is **append-only**: no edits, no deletes, no soft-deletes. Corrections happen by appending a compensating entry, not by mutating history.

```
walletTransactions/{id}
  playerId:        string (ref → players/{id})
  type:            "deposit" | "spend" | "ticket_use" | "win_credit"
                 | "withdrawal_request" | "withdrawal_complete" | "withdrawal_cancel"
                 | "adjustment"               // compensating entry, see §5
  amount:          integer (cents, AUD)        // sign convention: see §4
  method:          "cash" | "eftpos" | "payid" | "wallet" | "ticket" | null
                                                // null for win_credit and withdrawal_* types
  reference:       string | null                // EFTPOS approval, PayID txid, "cash", free text
  relatedDocId:    string | null                // entries/{id} for spend, withdrawalRequests/{id} for withdrawal_*
  actorId:         string (ref → staff auth uid)
  actorRole:       "manager" | "td" | "cashier"
  timestamp:       Timestamp (UTC)
  notes:           string | null                // free text, surfaced in the ledger view
```

```
wallets/{playerId}
  balance:                 integer (cents, AUD)
  ticketBalance:           integer (cents, AUD)   // sum of unused ticket face values
  lastActivityAt:          Timestamp
  lastReconciledAt:        Timestamp | null       // last time the cache was rebuilt from the ledger
```

```
withdrawalRequests/{id}
  playerId:        string
  amount:          integer (cents)
  payoutMethod:    "cash" | "eftpos_refund" | "bank_transfer"
  state:           "pending" | "completed" | "cancelled"
  requestedBy:     string (auth uid)
  requestedAt:     Timestamp
  completedBy:     string | null (auth uid — must be a Manager)
  completedAt:     Timestamp | null
  externalReference: string | null                // bank transfer ref, EFTPOS approval, etc.
  cancelReason:    string | null
```

```
tickets/{id}
  playerId:        string
  faceValue:       integer (cents, AUD)
  state:           "unused" | "used"
  issuedAt:        Timestamp
  issuedReason:    string | null                  // e.g. "satellite win", "comp"
  usedAt:          Timestamp | null
  usedOnEntryId:   string | null
```

These are the **v1 wallet collections.** Tournaments, entries, players, etc. are defined elsewhere (Phase 1 task 1.3 — canonical schema).

## 4. Sign convention for `amount`

Two valid options. Picking one and sticking with it is more important than which one.

**Option A:** `amount` is always positive; `type` determines whether it's a credit or debit. Balance is derived as `sum(credits) - sum(debits)`.

**Option B:** `amount` is signed — positive for credits to the player's balance, negative for debits. Balance is derived as `sum(amount)`.

**Recommendation: Option A.** Reasons:

- Easier for humans reading the ledger view to scan ("$500 deposit", "$200 spend") — no mental sign-flipping.
- Type-based grouping (e.g. "show me all deposits this month") doesn't need a sign filter.
- Money-validation logic gets to assert `amount > 0` everywhere with no special cases.

Adopting Option A unless Guy says otherwise (Q3 in §7).

The mapping from `type` to credit/debit on the player balance:

| Type | Effect on `wallets/{playerId}.balance` |
|---|---|
| `deposit` | credit (+) |
| `spend` | debit (−), only when `method == "wallet"`; for cash/eftpos/ticket the wallet balance is unaffected, the ledger row exists for audit/reconciliation only |
| `ticket_use` | no effect on cash balance; consumes a ticket |
| `win_credit` | credit (+) |
| `withdrawal_request` | no effect (request only) |
| `withdrawal_complete` | debit (−) |
| `withdrawal_cancel` | no effect |
| `adjustment` | signed; see §5 |

## 5. Corrections via compensating entries (not edits)

Append-only is hard to argue with from a compliance / audit perspective. To "undo" a transaction (e.g. cashier picked the wrong player, EFTPOS payment was actually declined):

- Write a new ledger row of type `adjustment`, signed, referencing the original transaction in `relatedDocId`, with `notes` explaining why.
- Both rows are visible in the ledger view; both rows attribute to specific staff actors and times.
- Wallets cache is rebuilt from the sum.

This avoids the entire class of "someone edited a ledger row and we can't tell" problems.

## 6. Atomic guarantees

The two operations that **must** be atomic — meaning either both writes succeed or neither does:

1. **Pay-with-wallet at registration.** Writing the `entries` row and the `walletTransactions` row of type `spend` / `method = wallet` must be one Firestore transaction. Otherwise we can take the entry but not debit the wallet, or vice versa.

2. **Pay-with-ticket at registration.** Writing the `entries` row, marking the `tickets` row used, and writing the `walletTransactions` row of type `ticket_use` must be one Firestore transaction. If a top-up is involved (face value < cost), the top-up's spend row joins the same transaction.

Both implemented via Firestore client-side transactions in the wallet module (Phase 1 task 1.7).

Deposits and withdrawal-complete writes do not need cross-collection atomicity (a single ledger row plus a cache update; cache can be rebuilt if it drifts).

**Hard invariant on wallet balance:** `players/{pid}.walletBalance` must always be ≥ 0. Any `spend` of `method = "wallet"` that would push balance negative is rejected at the wallet module layer. **No manager override path** — wallet going negative is venue liability, not a service-level favour, so it sits outside the otherwise-permissive "enforce at app, not rules" philosophy. Cashier must take a deposit or alternative payment first. Firestore rules don't enforce this (per the broader rules-scope decision) but the app/UI never permits the operation.

## 7. Resolved questions

All seven design questions resolved 27 May 2026 by Guy. Decisions baked into §2–§6 above.

| # | Decision | Notes |
|---|---|---|
| Q1 | **Four tournament-pay methods.** Ticket, cash, EFTPOS, from wallet. PayID is deposit-only. | A player can PayID an amount greater than the tournament cost; the venue must credit the **full** PayID'd amount, not just the entry fee. Two-step (PayID-deposit → pay-from-wallet) is the only flow that records this correctly. SOW v0.5 corrects §3.4 to match. |
| Q2 | **All three withdrawal payout methods kept.** Cash, EFTPOS refund, bank-transfer-to-stored-BSB — all three used daily. | No simplification of the withdrawal queue. |
| Q3 | **Option A.** Always-positive `amount`; `type` determines credit-vs-debit. | Reasoning in §4. |
| Q4 | **Cashier confirms each payout.** No auto-credit of winnings to wallet. | Phase 4 task 4.7 needs a confirmation step in the UI before the `win_credit` ledger row is written. Phase 5 display can still show the calculated payout amount; the writing happens behind a cashier confirmation. |
| Q5 | **Tickets are tournament-entry only in v1.** | No food/drink/package use. v1.5+ may revisit. |
| Q6 | **Wallets never go negative. Hard invariant, no manager override** (re-revised 27 May 2026, second pass). | Spend that would push balance < 0 is rejected at the wallet module layer (Phase 1 task 1.7). No UI override path. Cashier must take a deposit or alternative payment first. Sits outside the otherwise-permissive "enforce at app, not rules" philosophy: wallet going negative creates real venue liability, not a service-level favour. Firestore rules don't enforce it (per the broader rules-scope decision) but the app/UI never permits the operation. _History: original v0.4 = hard rule. v0.7 first pass relaxed it to "default with manager override" under the broader app-not-rules philosophy. Same-day second pass reverted to hard rule once Guy specified that wallet-negative specifically isn't override-able._ |
| Q7 | **Import existing player records, including balances.** | Migration is broader than just balances — full player profiles (name, phone, BSB if available, etc.) plus any existing wallet/credit balance get imported. Each imported balance becomes one `walletTransactions` row of type `deposit` with `reference = "opening_balance"` and a synthetic actor (e.g. a `migration` system uid) and timestamp. **Source of truth: Casinoware export.** Guy will export the relevant data from the Casinoware ecosystem; exact field-to-field mapping (Casinoware → canonical schema) gets nailed down when Phase 1 task 1.8a is built, not before. |
