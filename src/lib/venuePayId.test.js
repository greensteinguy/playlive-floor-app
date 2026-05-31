import { describe, it, expect } from 'vitest'
import { resolveVenuePayId } from './venuePayId'

describe('resolveVenuePayId', () => {
  it('returns configured details when the PayID env is set', () => {
    const r = resolveVenuePayId({
      VITE_VENUE_PAYID: 'pay@playlive.com.au',
      VITE_VENUE_PAYID_NAME: 'PlayLive Melbourne',
    })
    expect(r).toEqual({
      payId: 'pay@playlive.com.au',
      accountName: 'PlayLive Melbourne',
      configured: true,
    })
  })

  it('is not configured when the PayID is missing, blank, or whitespace', () => {
    expect(resolveVenuePayId({}).configured).toBe(false)
    expect(resolveVenuePayId().configured).toBe(false)
    expect(resolveVenuePayId({ VITE_VENUE_PAYID: '   ' }).configured).toBe(false)
  })

  it('trims whitespace and collapses blank fields to null', () => {
    const r = resolveVenuePayId({ VITE_VENUE_PAYID: '  pay@x  ', VITE_VENUE_PAYID_NAME: '   ' })
    expect(r.payId).toBe('pay@x')
    expect(r.accountName).toBeNull()
  })

  it('stays configured when the account name is absent (it is optional)', () => {
    const r = resolveVenuePayId({ VITE_VENUE_PAYID: 'pay@x' })
    expect(r.configured).toBe(true)
    expect(r.payId).toBe('pay@x')
    expect(r.accountName).toBeNull()
  })
})
