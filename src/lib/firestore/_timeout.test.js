import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withWriteTimeout, WRITE_TIMEOUT_MS } from './_timeout'
import { WriteTimeoutError } from './_errors'

describe('withWriteTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves with the write result when it settles before the deadline', async () => {
    await expect(withWriteTimeout(Promise.resolve('ok'), ['players', 'p1'])).resolves.toBe('ok')
  })

  it('rejects with WriteTimeoutError when the write hangs past the deadline', async () => {
    const hang = new Promise(() => {}) // never settles — models an unreachable backend
    const raced = withWriteTimeout(hang, ['players', 'p1'])
    const settled = raced.then(
      () => ({ ok: true }),
      (e) => ({ err: e })
    )
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    const result = await settled
    expect(result.err).toBeInstanceOf(WriteTimeoutError)
  })

  it('does not fire before the deadline', async () => {
    const hang = new Promise(() => {})
    let rejected = false
    withWriteTimeout(hang, 'transaction').catch(() => {
      rejected = true
    })
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 1)
    expect(rejected).toBe(false)
  })

  it('propagates a real write rejection instead of masking it as a timeout', async () => {
    const boom = new Error('permission denied')
    await expect(withWriteTimeout(Promise.reject(boom), ['players', 'p1'])).rejects.toBe(boom)
  })

  it('carries the op label for debugging and a user-facing message', async () => {
    const raced = withWriteTimeout(new Promise(() => {}), ['players', 'p1'])
    const caught = raced.catch((e) => e)
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    const e = await caught
    expect(e.opLabel).toBe('players/p1')
    expect(e.message).toMatch(/contact your system administrator/i)
  })

  it('clears its timer once the write settles (no dangling timeout)', async () => {
    await withWriteTimeout(Promise.resolve('done'))
    expect(vi.getTimerCount()).toBe(0)
  })
})
