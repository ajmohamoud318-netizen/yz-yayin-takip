import { describe, it, expect } from 'vitest'
import { readTarget, MAX_AGE_MS } from './push-target.js'

/**
 * Rules for a parked push target.
 *
 * The IndexedDB plumbing around this is boilerplate (and jsdom has no
 * IndexedDB), but these rules are load-bearing: the entry is written by
 * sw.js — a separately-deployed static file — so anything reaching `readTarget`
 * has crossed a version boundary and cannot be assumed well-formed.
 */
describe('readTarget', () => {
  const now = 1_700_000_000_000

  it('accepts a fresh same-origin target', () => {
    expect(readTarget({ url: '/projects/p-1', notificationId: 'n-1', at: now - 500 }, now))
      .toEqual({ url: '/projects/p-1', notificationId: 'n-1' })
  })

  it('defaults a missing notification id to null rather than undefined', () => {
    // PushBridge branches on truthiness before calling markRead; `undefined`
    // would work today but makes the parked shape ambiguous across versions.
    expect(readTarget({ url: '/urunler', at: now }, now))
      .toEqual({ url: '/urunler', notificationId: null })
  })

  it('drops a target older than the handoff window', () => {
    // A tap that never reached the app (launch killed, user swiped away) must
    // not hijack an unrelated app open days later.
    expect(readTarget({ url: '/projects/p-1', at: now - MAX_AGE_MS - 1 }, now)).toBeNull()
    expect(readTarget({ url: '/projects/p-1', at: now - MAX_AGE_MS + 1 }, now)).not.toBeNull()
  })

  it('drops a target timestamped far in the future', () => {
    // A backwards clock jump would otherwise leave an entry permanently fresh.
    expect(readTarget({ url: '/projects/p-1', at: now + MAX_AGE_MS + 1 }, now)).toBeNull()
  })

  it('drops entries with no usable timestamp', () => {
    expect(readTarget({ url: '/projects/p-1' }, now)).toBeNull()
    expect(readTarget({ url: '/projects/p-1', at: 'soon' }, now)).toBeNull()
  })

  it('refuses anything that is not a same-origin path', () => {
    expect(readTarget({ url: 'https://evil.example/x', at: now }, now)).toBeNull()
    // Protocol-relative: passes a naive startsWith('/') and navigates off-site.
    expect(readTarget({ url: '//evil.example/x', at: now }, now)).toBeNull()
    expect(readTarget({ url: 'javascript:alert(1)', at: now }, now)).toBeNull()
    expect(readTarget({ url: 42, at: now }, now)).toBeNull()
  })

  it('tolerates junk instead of an entry', () => {
    expect(readTarget(null, now)).toBeNull()
    expect(readTarget(undefined, now)).toBeNull()
    expect(readTarget('nope', now)).toBeNull()
  })
})
