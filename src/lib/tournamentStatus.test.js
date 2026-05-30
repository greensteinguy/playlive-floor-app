import { describe, it, expect } from 'vitest'
import {
  ALL_STATUSES,
  DEFAULT_TRANSITIONS,
  statusLabel,
  isTerminalStatus,
  defaultNextStatuses,
  isDefaultTransition,
} from './tournamentStatus'

describe('statusLabel', () => {
  it('maps known statuses and falls back to the raw value', () => {
    expect(statusLabel('lateRegOpen')).toBe('Late reg open')
    expect(statusLabel('mystery')).toBe('mystery')
  })
})

describe('the transition map', () => {
  it('covers every status', () => {
    for (const s of ALL_STATUSES) expect(DEFAULT_TRANSITIONS).toHaveProperty(s)
  })

  it('only ever transitions to real statuses', () => {
    for (const targets of Object.values(DEFAULT_TRANSITIONS)) {
      for (const t of targets) expect(ALL_STATUSES).toContain(t)
    }
  })

  it('lets every non-terminal status be cancelled', () => {
    for (const s of ALL_STATUSES) {
      if (!isTerminalStatus(s)) expect(defaultNextStatuses(s)).toContain('cancelled')
    }
  })
})

describe('isTerminalStatus', () => {
  it('treats finished and cancelled as terminal', () => {
    expect(isTerminalStatus('finished')).toBe(true)
    expect(isTerminalStatus('cancelled')).toBe(true)
  })
  it('treats live statuses as non-terminal', () => {
    expect(isTerminalStatus('draft')).toBe(false)
    expect(isTerminalStatus('lateRegOpen')).toBe(false)
  })
})

describe('isDefaultTransition', () => {
  it('accepts the standard forward sequence', () => {
    expect(isDefaultTransition('draft', 'scheduled')).toBe(true)
    expect(isDefaultTransition('scheduled', 'lateRegOpen')).toBe(true)
    expect(isDefaultTransition('lateRegOpen', 'lateRegClosed')).toBe(true)
    expect(isDefaultTransition('lateRegClosed', 'finished')).toBe(true)
  })

  it('rejects non-standard jumps (these need a manager override)', () => {
    expect(isDefaultTransition('lateRegClosed', 'lateRegOpen')).toBe(false) // reopen late reg
    expect(isDefaultTransition('scheduled', 'finished')).toBe(false) // skip the field
    expect(isDefaultTransition('scheduled', 'draft')).toBe(false) // un-publish
    expect(isDefaultTransition('finished', 'lateRegOpen')).toBe(false) // un-finish
  })

  it('treats terminal statuses as dead ends by default', () => {
    expect(defaultNextStatuses('finished')).toEqual([])
    expect(defaultNextStatuses('cancelled')).toEqual([])
  })
})
