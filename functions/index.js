// Cloud Functions for the PlayLive Floor App (Phase 6.2 — Player App tier).
//
// Three callables, all in australia-southeast1:
//   linkPlayerAccount  — player-called after phone-OTP sign-in: auto-match the
//                        verified phone to a player doc, or queue a linkRequest
//                        for the desk.
//   resolveLinkRequest — staff-called (cashier/manager): resolve a pending
//                        linkRequest by picking the player (or rejecting).
//   registerSelf       — player-called: instant wallet-paid tournament entry
//                        when the balance covers it, else a registrationRequest
//                        for the desk.
//
// Design rules honored from the client codebase (src/lib):
//   - deterministic entry ids `{playerId}_{entryNumber}` (replay/race safe)
//   - HARD wallet >= 0 invariant — no override path
//   - counters recomputed from the entries subcollection, not incremented
//   - append-only walletTransactions; amount always positive
//   - auditLog writes are best-effort, never block the operation
//
// The pure planning logic in ./core/registration.js is a copy of
// src/lib/tournaments/registration.js, gated by a parity test in the main
// vitest suite. Edit both together.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { randomUUID } from 'node:crypto'

import {
  totalEntryCost,
  registrationOpen,
  registrableSessions,
  planEntry,
  computeEntryCounters,
} from './core/registration.js'
import { findLinkCandidates } from './core/phone.js'

setGlobalOptions({ region: 'australia-southeast1', maxInstances: 10 })

initializeApp()
const db = getFirestore()

// ── helpers ────────────────────────────────────────────────────────────────

const now = () => Timestamp.now()

/** Best-effort audit row — never throws into the caller. */
async function audit({ actorId, actorRole, actionType, targetType, targetId, metadata }) {
  try {
    const id = randomUUID()
    await db.collection('auditLog').doc(id).set({
      id,
      timestamp: now(),
      actorId,
      actorRole,
      actionType,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      metadata: metadata ?? {},
    })
  } catch (e) {
    console.error('auditLog write failed', actionType, e)
  }
}

function requirePlayerAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
  return request.auth
}

function requireStaff(request, roles = ['cashier', 'manager']) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.')
  const role = request.auth.token?.role
  if (!roles.includes(role)) throw new HttpsError('permission-denied', 'Staff role required.')
  return request.auth
}

// ── linkPlayerAccount ──────────────────────────────────────────────────────

export const linkPlayerAccount = onCall(async (request) => {
  const auth = requirePlayerAuth(request)
  const uid = auth.uid

  // Already linked → idempotent success.
  if (auth.token.playerId) {
    return { linked: true, playerId: auth.token.playerId, already: true }
  }

  const phone = auth.token.phone_number
  if (!phone) {
    throw new HttpsError('failed-precondition', 'Account has no verified phone number — sign in with phone.')
  }

  // v1: venue-scale full scan (a few thousand docs). Player phones are stored
  // as-entered, so no indexable normalized field exists to query on yet.
  const playersSnap = await db.collection('players').get()
  const players = playersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const { linkable, reason, candidates } = findLinkCandidates(phone, players, uid)

  if (linkable) {
    const player = candidates[0]
    const linkedAt = now()
    // Re-check inside a transaction so two concurrent link attempts (or a
    // desk link racing this) can't double-assign the doc.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.doc(`players/${player.id}`))
      if (!snap.exists) throw new HttpsError('not-found', 'Player record vanished.')
      const cur = snap.data()
      if (cur.authUid != null && cur.authUid !== uid) {
        throw new HttpsError('already-exists', 'Player record was just linked to another account.')
      }
      tx.update(snap.ref, { authUid: uid, authLinkedAt: linkedAt, updatedAt: linkedAt })
    })
    await getAuth().setCustomUserClaims(uid, { playerId: player.id })
    await audit({
      actorId: uid,
      actorRole: 'player',
      actionType: 'player.accountLinked',
      targetType: 'player',
      targetId: player.id,
      metadata: { via: 'autoMatch', phone },
    })
    // Client must refresh its ID token to pick up the claim.
    return { linked: true, playerId: player.id, refreshToken: true }
  }

  // No clean match → queue for the desk. Doc id = uid keeps it one-per-account.
  const reqRef = db.doc(`linkRequests/${uid}`)
  const existing = await reqRef.get()
  if (!existing.exists || existing.data().state !== 'pending') {
    const t = now()
    await reqRef.set({
      id: uid,
      authUid: uid,
      phone,
      state: 'pending',
      reason,
      candidatePlayerIds: candidates.map((c) => c.id),
      requestedAt: t,
      playerId: null,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: t,
      updatedAt: t,
    })
  }
  return { linked: false, reason }
})

// ── resolveLinkRequest ─────────────────────────────────────────────────────

export const resolveLinkRequest = onCall(async (request) => {
  const auth = requireStaff(request)
  const { linkRequestId, playerId, reject, note } = request.data ?? {}
  if (typeof linkRequestId !== 'string' || linkRequestId === '') {
    throw new HttpsError('invalid-argument', 'linkRequestId is required.')
  }
  if (!reject && (typeof playerId !== 'string' || playerId === '')) {
    throw new HttpsError('invalid-argument', 'playerId is required unless rejecting.')
  }

  const reqRef = db.doc(`linkRequests/${linkRequestId}`)
  const resolvedAt = now()

  const outcome = await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(reqRef)
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Link request not found.')
    const req = reqSnap.data()
    // Retry self-heal: if a prior attempt linked the doc but the claim write
    // failed, resolving again with the same player just re-stamps the claim.
    if (req.state === 'linked' && !reject && req.playerId === playerId) {
      return { rejected: false, authUid: req.authUid, already: true }
    }
    if (req.state !== 'pending') throw new HttpsError('failed-precondition', `Request is already ${req.state}.`)

    if (reject) {
      tx.update(reqRef, {
        state: 'rejected',
        resolvedBy: auth.uid,
        resolvedAt,
        resolutionNote: note ?? null,
        updatedAt: resolvedAt,
      })
      return { rejected: true, authUid: req.authUid }
    }

    const pSnap = await tx.get(db.doc(`players/${playerId}`))
    if (!pSnap.exists) throw new HttpsError('not-found', 'Player not found.')
    const p = pSnap.data()
    if (p.isMerged) throw new HttpsError('failed-precondition', 'Player was merged — link the destination player.')
    if (p.authUid != null) throw new HttpsError('failed-precondition', 'Player is already linked to an account.')

    tx.update(pSnap.ref, { authUid: req.authUid, authLinkedAt: resolvedAt, updatedAt: resolvedAt })
    tx.update(reqRef, {
      state: 'linked',
      playerId,
      resolvedBy: auth.uid,
      resolvedAt,
      resolutionNote: note ?? null,
      updatedAt: resolvedAt,
    })
    return { rejected: false, authUid: req.authUid }
  })

  if (!outcome.rejected) {
    await getAuth().setCustomUserClaims(outcome.authUid, { playerId })
  }
  await audit({
    actorId: auth.uid,
    actorRole: auth.token.role,
    actionType: outcome.rejected ? 'player.accountLinkRejected' : 'player.accountLinked',
    targetType: 'player',
    targetId: outcome.rejected ? null : playerId,
    metadata: { via: 'desk', linkRequestId, note: note ?? null },
  })
  return outcome.rejected ? { rejected: true } : { linked: true, playerId }
})

// ── registerSelf ───────────────────────────────────────────────────────────

export const registerSelf = onCall(async (request) => {
  const auth = requirePlayerAuth(request)
  const uid = auth.uid
  const playerId = auth.token.playerId
  if (!playerId) {
    throw new HttpsError('failed-precondition', 'account-not-linked')
  }
  const { tournamentId } = request.data ?? {}
  if (typeof tournamentId !== 'string' || tournamentId === '') {
    throw new HttpsError('invalid-argument', 'tournamentId is required.')
  }

  const tRef = db.doc(`tournaments/${tournamentId}`)
  const pRef = db.doc(`players/${playerId}`)
  const regReqRef = db.doc(`registrationRequests/${tournamentId}_${playerId}`)

  const result = await db.runTransaction(async (tx) => {
    // All reads first (admin transactions require reads before writes).
    const [tSnap, pSnap, regReqSnap, allEntriesSnap, sessionsSnap] = await Promise.all([
      tx.get(tRef),
      tx.get(pRef),
      tx.get(regReqRef),
      tx.get(tRef.collection('entries')),
      tx.get(tRef.collection('sessions')),
    ])

    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found.')
    const t = tSnap.data()
    if (t.archivedAt != null) throw new HttpsError('not-found', 'Tournament not found.')
    if (!registrationOpen(t)) throw new HttpsError('failed-precondition', 'registration-closed')

    if (!pSnap.exists) throw new HttpsError('not-found', 'Player record not found.')
    const p = pSnap.data()
    if (p.isMerged) throw new HttpsError('failed-precondition', 'Player record was merged — see the desk.')
    if (p.authUid !== uid) throw new HttpsError('permission-denied', 'Account link is stale — sign in again.')

    const allEntries = allEntriesSnap.docs.map((d) => d.data())
    const playerEntries = allEntries.filter((e) => e.playerId === playerId)
    const plan = planEntry({ playerEntries, reentryConfig: t.reentryConfig })
    if (plan.blockedReason) throw new HttpsError('failed-precondition', plan.blockedReason)

    const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const entryPoints = registrableSessions(sessions)
    const cost = totalEntryCost(t)
    const ts = now()

    // Fallback-to-desk paths: multi-flight events need a human (flight pick);
    // insufficient balance needs payment in person.
    const fallbackReason =
      entryPoints.length !== 1 ? 'multiSession'
      : (p.walletBalance ?? 0) < cost ? 'insufficientBalance'
      : null

    if (fallbackReason) {
      if (regReqSnap.exists && regReqSnap.data().state === 'pending') {
        return { mode: 'requested', reason: regReqSnap.data().reason, already: true }
      }
      tx.set(regReqRef, {
        id: regReqRef.id,
        playerId,
        tournamentId,
        state: 'pending',
        requestedAt: ts,
        requestedByUid: uid,
        requestedVia: 'playerApp',
        reason: fallbackReason,
        entryId: null,
        resolvedBy: null,
        resolvedAt: null,
        cancelReason: null,
        createdAt: ts,
        updatedAt: ts,
      })
      return { mode: 'requested', reason: fallbackReason }
    }

    // Instant wallet-paid entry.
    const entryId = `${playerId}_${plan.entryNumber}`
    const wtxId = randomUUID()
    const newEntry = {
      id: entryId,
      legacyId: null,
      tournamentId,
      playerId,
      originSessionId: entryPoints[0].id,
      entryType: plan.entryType,
      entryNumber: plan.entryNumber,
      registeredAt: ts,
      registeredBy: uid,
      paymentMethod: 'wallet',
      paymentAmount: cost,
      paymentReference: null,
      walletTransactionId: wtxId,
      currentTableId: null,
      currentSeatNumber: null,
      bustedAt: null,
      bustedInSessionId: null,
      finishingPlace: null,
      bountyEarnings: 0,
      bountiesKnockoutCount: 0,
      cashWinnings: 0,
      ticketWinnings: 0,
      winningsPaidAt: null,
      winningsWalletTransactionId: null,
      ticketIssuedAt: null,
      issuedTicketId: null,
      lastLongerDeck: null,
      isLastLongerWinner: false,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      notes: null,
      createdAt: ts,
      updatedAt: ts,
    }

    tx.set(tRef.collection('entries').doc(entryId), newEntry)
    tx.set(pRef.collection('walletTransactions').doc(wtxId), {
      id: wtxId,
      playerId,
      type: 'spend',
      amount: cost,
      method: 'wallet',
      reference: null,
      relatedDocId: entryId,
      actorId: uid,
      actorRole: 'player',
      timestamp: ts,
      notes: 'Self-service registration (Player App)',
    })
    // Transaction isolation makes the read authoritative; the explicit value
    // (not an increment) keeps the >= 0 invariant visible at the write site.
    tx.update(pRef, {
      walletBalance: (p.walletBalance ?? 0) - cost,
      updatedAt: ts,
    })
    const counters = computeEntryCounters([...allEntries, newEntry], t.buyIn)
    tx.update(tRef, { ...counters, updatedAt: ts })

    return { mode: 'registered', entryId, cost, entryType: plan.entryType }
  })

  if (result.mode === 'registered') {
    await audit({
      actorId: uid,
      actorRole: 'player',
      actionType: 'entry.created',
      targetType: 'entry',
      targetId: result.entryId,
      metadata: { paymentMethod: 'wallet', via: 'playerApp', tournamentId, amount: result.cost },
    })
  } else if (!result.already) {
    await audit({
      actorId: uid,
      actorRole: 'player',
      actionType: 'registration.requested',
      targetType: 'tournament',
      targetId: tournamentId,
      metadata: { reason: result.reason, via: 'playerApp' },
    })
  }
  return result
})
