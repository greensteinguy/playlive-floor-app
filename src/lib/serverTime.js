// Server-clock offset estimation for read-only viewers (the venue TVs).
//
// The clock anchor (session.clockStartedAt) is stamped with the TD DEVICE's
// wall clock (Timestamp.now() — see lib/tournaments/clock.js "time
// discipline"). A TV derives the countdown against its OWN wall clock, so any
// drift between the two devices shows up as a constant offset on the TV — the
// deferred cross-device case called out in lib/clock-sync.js.
//
// Fix: estimate this device's offset to a COMMON reference — the hosting
// server's wall clock, read from the HTTP `Date` response header of a HEAD
// request to our own origin. Accuracy is ~±(0.5s + rtt/2); the Date header
// truncates to whole seconds, so we add 500ms and take the median of several
// samples. Assuming venue devices are roughly NTP-synced to real time, and
// the hosting server certainly is, correcting the TV to server time removes
// the visible drift.
//
// Gospel note (clock-time-is-gospel): the offset is applied by READ-ONLY
// derivation on the display; it never touches anchors or writes. A refreshed
// estimate is adopted only when it moves meaningfully, so the TV countdown
// never visibly jitters between samples.

/** Pure offset math for one sample: server wall clock minus local wall clock. */
export function offsetFromSample(t0Ms, t1Ms, serverDateMs) {
  if (!Number.isFinite(serverDateMs)) return null
  // Date header is truncated to the second; +500ms centers the error. The
  // response was stamped mid-flight, so compare against the request midpoint.
  return serverDateMs + 500 + (t1Ms - t0Ms) / 2 - t1Ms
}

/** Median of the non-null samples (null when none survive). */
export function medianOffset(samples) {
  const good = samples.filter((s) => Number.isFinite(s)).sort((a, b) => a - b)
  if (good.length === 0) return null
  const mid = Math.floor(good.length / 2)
  return good.length % 2 === 1 ? good[mid] : (good[mid - 1] + good[mid]) / 2
}

/**
 * Should a fresh estimate replace the current one? Sub-half-second wobble is
 * measurement noise — adopting it would make the countdown shimmy for no
 * visible gain.
 */
export function shouldAdoptOffset(currentMs, nextMs, thresholdMs = 500) {
  if (nextMs == null) return false
  if (currentMs == null) return true
  return Math.abs(nextMs - currentMs) > thresholdMs
}

async function sampleOnce(url) {
  const t0 = Date.now()
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
  const t1 = Date.now()
  const dateHeader = res.headers.get('date')
  if (!dateHeader) return null
  return offsetFromSample(t0, t1, new Date(dateHeader).getTime())
}

/**
 * Median-of-3 offset estimate against this app's own origin. Resolves to null
 * (caller keeps its current value) when the network or headers don't
 * cooperate — never throws.
 */
export async function estimateServerOffsetMs(url = `${window.location.origin}/`) {
  const samples = []
  for (let i = 0; i < 3; i++) {
    try {
      samples.push(await sampleOnce(url))
    } catch {
      samples.push(null)
    }
  }
  return medianOffset(samples)
}
