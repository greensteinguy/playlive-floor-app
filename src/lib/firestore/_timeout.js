// Write-timeout guard for the data layer.
//
// The Floor App is online-only (ADR-001): if Firestore is unreachable the SDK
// retries indefinitely and a write promise never settles, so a button can sit on
// "Saving…" / "Creating…" forever (observed when the local emulator was down).
// `withWriteTimeout` races a write against a deadline and rejects with a typed,
// user-facing WriteTimeoutError instead, so the UI can show a toast and re-enable
// the button rather than spin.
//
// Kept in its own module (no firebase/config imports) so it's unit-testable
// without booting a Firebase client.

import { WriteTimeoutError } from './_errors'

// Normal writes settle in well under a second (emulator or production), so a 10s
// ceiling only trips on a genuinely unreachable / stalled backend.
//
// Caveat: a write that lands AFTER the timeout (rare — a slow-but-alive backend)
// can't be recalled, so a retry could duplicate it. Acceptable for v1 versus an
// infinite hang; the realistic trigger is "backend down", where nothing landed.
export const WRITE_TIMEOUT_MS = 10_000

/**
 * Race a write promise against the write-timeout deadline. Resolves with the
 * write's result if it settles first; rejects with WriteTimeoutError if the
 * deadline wins. A real rejection from the write (e.g. permission denied) wins
 * the race and propagates unchanged — it is never masked as a timeout.
 *
 * @template T
 * @param {Promise<T>} promise          the in-flight Firestore write
 * @param {string|string[]} [opLabel]   doc path / op kind, for the error's debug context
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
export function withWriteTimeout(promise, opLabel, timeoutMs = WRITE_TIMEOUT_MS) {
  let timer
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new WriteTimeoutError(opLabel)), timeoutMs)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}
