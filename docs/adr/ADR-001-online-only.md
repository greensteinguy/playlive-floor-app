# ADR-001: Online-only operation in v1 (no offline persistence)

- **Status:** Accepted
- **Date:** 27 May 2026
- **Decider:** Guy Greenstein
- **Author:** Claude

## Context

Earlier versions of the SOW (v0.1 through v0.3) included offline tolerance as a v1 requirement: the Floor App had to keep operating during a venue internet outage, with Firestore offline persistence handling reads/writes locally and syncing on reconnection. With three or more concurrent operator stations expected during peak events, this also required an explicit multi-device conflict-resolution policy (initially captured as ADR-002 in v0.3, since superseded).

During discovery round 2, this requirement was reconsidered. The implementation cost (Firestore offline persistence + IndexedDB cache + conflict-resolution logic + wallet-ledger reasoning under partition + explicit testing scenarios) was roughly two weeks of build time. The wallet was being added at the same time, which made an online-only design materially simpler to reason about for the most financially-sensitive code path.

## Decision

The Floor App in v1 is **online-only**. Specifically:

- Firestore is used in its standard online mode. No `enableIndexedDbPersistence` call. No offline cache.
- Real-time listeners (`onSnapshot`) are used where appropriate for live data (tournament clock state, wallet balance, queue views).
- During an internet outage, the app stops accepting writes. The live tournament clock continues to tick locally (it's pure client-side state and doesn't need the network per-tick), but registrations, bust-outs, and wallet transactions wait for connectivity to return.
- No multi-device conflict-resolution logic is needed: with online-only writes against Firestore's strong consistency, two stations can't get into a divergent state.

## Consequences

**Positive:**
- ~2 weeks of build time saved (Phase 1 simpler, Phase 5 offline-hardening removed).
- Wallet ledger is dramatically easier to reason about: a single authoritative store, no replay/merge logic, no partition windows.
- Smaller surface area for bugs in the highest-stakes code (money handling).
- No "what does this device think the truth is right now" question — the answer is always "whatever Firestore says."

**Negative:**
- Venue internet becomes a hard dependency. An outage during a live tournament stops new writes (and that means stops bust-outs, registrations, wallet activity).
- Mitigation is operational, not architectural: the venue is expected to set up a redundant connection (second ISP, 4G/5G failover, or both) before cutover.

**Trade-off context the venue accepts:** Casinoware is a desktop app and continues to operate during internet outages today. Moving to an online-only web app removes that property. The venue is comfortable with this because (a) Casinoware-style desktop deployment was rejected in favour of cross-device web access (operator PC + iPad), and (b) the venue's existing internet is reliable enough that brief outages are infrequent and tolerable.

## Reversibility

This is reversible. Firestore offline persistence is opt-in per client and can be enabled in a future version without touching the wallet or tournament data model. If venue operations ever surface a hard requirement for offline support, that future decision would supersede this ADR and would warrant a new ADR explaining the trade-off going the other direction.

## Related

- Supersedes: an earlier draft ADR-002 (multi-device conflict resolution), which is no longer needed.
- See SOW v0.4 §5.2 for the user-facing rationale.
- See DECISIONS.md for the summary entry.
