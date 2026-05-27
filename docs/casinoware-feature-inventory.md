# Casinoware feature inventory

> Phase 0 task 0.1. The source-of-truth list of what Casinoware does today at PlayLive, captured from the walkthrough with Guy + the floor team. Feeds the SOW (already done — see `01_Scope_of_Work.md` v0.4) and the canonical schema (Phase 1 task 1.3).
>
> Status: **complete** based on Guy's walkthrough notes (27 May 2026), cross-referenced against SOW v0.4. Open questions flagged in §6 below — answers will be folded into the SOW v0.5 if any decisions change.

## 1. Tournament creation

**In Casinoware today:**

- Create from blank or **from template**.
- **"Structure from template"** — Guy noted this as a sub-flow. Reads as: clone just the blind structure (not the rest of the tournament config) from an existing template. _Q1 in §6: confirm this is a separate flow from full-template instantiation._
- Multi-day tournaments. _Q2 in §6: distinguish multi-day (one tournament spans Day 1 → Day 2) from multi-flight (multiple Day 1s feed into a shared Day 2)._
- Weekly recurring tournaments.

**Fields captured at create time:**

- Name
- Short description
- Tournament type: Standard, Satellite, Main Event, Bounty (Mystery Bounty assumed under Bounty), Multi-Day
- Format / variant: Mixed Games (HORSE, Stud, etc. as separate)
- Add-on toggle
- Bounty toggle
- Multi-day flag → prize pool accumulation across days
- Blind structure
- Buy-in (and hospitality cost is a sub-field of buy-in)
- Pay-out structure — auto-generated, manually overridable
- Upper Deck vs Main Deck tag → with last-longer side bet attached. _Q3 in §6: is last-longer always paired with Upper/Main Deck, or independent?_
- Freezeout flag → with number of re-entries and number of re-buys when off
- House consumption budget
- Trophy price (optional) — _Q4 in §6: separate field or sub-line of house consumption?_

**Satellite-specific:**

- Pay-out specifics (seats awarded)
- "Milestone" payouts. _Q5 in §6: clarify what a milestone is in Casinoware terms._

**Status in SOW v0.4:** all of the above are in SOW §3.1 with the noted gaps marked as questions.

## 2. Tournament display screen (venue TV)

- Full-screen cycling display.
- Cycle screens:
  1. **Normal blind countdown** — current level, time remaining, next level preview
  2. **Prize pool screen**
  3. **Stats screen** — Guy flagged with a "?". _Q6 in §6: confirm stats screen is in v1, and what stats to surface._

**Status in SOW v0.4:** captured (SOW §3.1). Stats screen content listed as player counts, average stack, ITM line, top finishers, remaining bounty pool.

## 3. Player registration & payment

**Payment methods at tournament registration time:**

- Ticket
- Cash
- EFTPOS
- **From my account** (= from wallet balance)

**Notably absent from Guy's notes for tournament-pay:** PayID. Guy's notes say _"all PayID gets deposited into account beforehand via a wizard available through the registration screen"_ — meaning PayID is **never a direct tournament-pay method**; it's always a deposit-to-wallet step first, then the player pays from wallet.

This **contradicts SOW v0.4 §3.4**, which currently lists PayID as one of five tournament-pay methods. _Q7 in §6: confirm the four-method tournament-pay model and update SOW v0.5 accordingly._

**Adding money to player account (deposit methods):**

- Cash
- EFTPOS
- PayID (via the wizard from the registration screen)

These three are deposit-only methods.

**Status in SOW v0.4:** mostly captured; PayID-only-as-deposit needs the SOW correction noted above.

## 4. Player profile

- Scan IDs — _deferred to v1.5+ per SOW §4. Q8 in §6: confirm Guy still happy to defer ID scanning._
- Full name (mandatory)
- Phone number (mandatory)
- Email (optional)
- Street address (optional)
- BSB + Account Number (sensitive tier, Cashier+ only)
- Total deposited in account (derived)

**Status in SOW v0.4:** captured (SOW §3.2). ID scanning explicitly deferred.

## 5. Other features captured

- **Alternates / waiting list:** queue late players when tables full; print ticket with alternate number; auto-seat on next bust. (SOW §3.2 — captured.)
- **Packages — package builder + package purchase:** in Guy's notes. _Deferred to v1.5+ per SOW §4 and DECISIONS.md. Q9 in §6: confirm Guy still happy to defer packages._

## 6. Resolved questions

All nine resolved 27 May 2026 by Guy. SOW v0.5 picks up the scope changes; one new follow-up flagged below.

| # | Topic | Decision |
|---|---|---|
| Q1 | Template granularity | **Two-level template system.** Structure templates are a separate entity (cloneable blind structure only). Tournament templates can reference / embed a structure template. Phase 2 task 2.5 (templates) needs to be sized for both levels. |
| Q2 | Multi-day vs multi-flight | **Two distinct concepts. SOW must distinguish them.** **Multi-day:** a single tournament that plays down to ~15% of the field on Day 1, then resumes the same player pool on Day 2 (or Day 3+). **Multi-flight:** multi-day with more than one Day 1; all surviving players from every Day 1 converge on a single Day 2. The current SOW v0.4 §3.1 collapses these — v0.5 needs to handle multi-day as its own structural concept and multi-flight as a sub-variant. |
| Q3 | Last-longer scoping | **Upper Deck / Main Deck IS the last-longer side bet.** They are synonymous in venue terminology. v1 treats them as one concept — the "Upper Deck / Main Deck split" toggle on a tournament is what enables the last-longer side bet. No separate last-longer toggle. |
| Q4 | Trophy price field | **No separate field.** House consumption is one generic field on the tournament; trophy cost is included in that figure. Drops `trophyPrice` from the schema. |
| Q5 | Satellite milestones | **Auto-removal at a chip multiple.** When a satellite player's chip stack reaches a multiple of the starting stack equal to the ratio between the ticket reward and the buy-in, the player is automatically removed from the tournament with their stack and issued a ticket. Worked example: $100 buy-in, $1000 ticket reward → ratio 10× → starting stack 10,000 → trigger at 100,000 chips. **Chip handling on removal: the chips are removed from play entirely.** Total chips on the tables decreases as players win seats. (Implication for Phase 4: the satellite naturally winds down as chips leave the table; the engine watches each player's stack continuously and triggers the auto-removal event when the threshold is crossed.) |
| Q6 | Stats screen in v1 | **Moved to v1.5+.** Nice-to-have, not v1. Phase 5 task 5.2 stops at blind countdown + prize-pool screen. SOW v0.5 reflects the demotion; the stats screen joins the v1.5+ backlog. |
| Q7 | PayID at registration | **Confirmed deposit-only.** See wallet design note Q1 for the rationale. SOW v0.5 corrects §3.4. |
| Q8 | ID scanning still deferred | **Yes, v1.5+ confirmed.** |
| Q9 | Packages still deferred | **Yes, v1.5+ confirmed.** |
