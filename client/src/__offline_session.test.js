/**
 * Regression tests for the "installed PWA logs me out on launch" bug.
 *
 * Reproduction:
 *   - The app is installed to the Home Screen and the user is signed in.
 *   - They tap the icon. iOS cold-launches the SPA and `GET /auth/me` fires
 *     while the radio is still coming up, so it fails with no HTTP response.
 *   - AuthProvider treated ANY rejection as "session is gone": it cleared the
 *     cached user and localStorage, and the app landed on /login.
 *   - Force-quitting and reopening worked, because by then the network was up.
 *
 * The two halves of the fix, pinned here:
 *   1. The HTTP client has a finite timeout, so a hung request eventually
 *      rejects instead of leaving the app on a blank screen forever.
 *   2. A failure with no `response` is reported as `offline`, which is what
 *      lets AuthProvider tell "the API says you're signed out" (401 — clear
 *      the session) apart from "the API never answered" (keep it).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { httpClient } from '@/infrastructure/http/client.js'

const AUTH_KEY = 'yz_auth_v1'

beforeEach(() => {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'user-1', user: { id: 'user-1' } }))
})
afterEach(() => {
  localStorage.removeItem(AUTH_KEY)
  delete httpClient.defaults.adapter
})

describe('offline vs. rejected session', () => {
  it('gives every request a finite timeout', () => {
    // Without this, axios waits forever and `bootstrapping` never resolves.
    expect(httpClient.defaults.timeout).toBeGreaterThan(0)
  })

  it('flags a request that never reached the API as offline, with no status', async () => {
    httpClient.defaults.adapter = () => Promise.reject(Object.assign(
      new Error('Network Error'),
      { code: 'ERR_NETWORK' },
    ))

    const err = await httpClient.get('/auth/me').catch((e) => e)

    expect(err.offline).toBe(true)
    expect(err.status).toBeUndefined()
    // Turkish, and phrased as something the user can act on.
    expect(err.message).toMatch(/Sunucuya ulaşılamadı/)
    // The session must survive — this failure says nothing about it.
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull()
  })

  it('flags a timeout as offline too', async () => {
    httpClient.defaults.adapter = () => Promise.reject(Object.assign(
      new Error('timeout of 20000ms exceeded'),
      { code: 'ECONNABORTED' },
    ))

    const err = await httpClient.get('/auth/me').catch((e) => e)

    expect(err.offline).toBe(true)
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull()
  })

  it('does NOT flag a real 401 as offline, and clears the stored session', async () => {
    httpClient.defaults.adapter = (config) => Promise.reject(Object.assign(
      new Error('Request failed'),
      {
        config,
        response: { status: 401, data: { error: 'unauthorized' }, headers: {}, config },
      },
    ))

    const err = await httpClient.get('/auth/me').catch((e) => e)

    expect(err.offline).toBe(false)
    expect(err.status).toBe(401)
    // The API spoke: the interceptor tears the session down on this path.
    expect(localStorage.getItem(AUTH_KEY)).toBeNull()
  })
})
