/**
 * Regression test for the `X-User-Id header is required` bug.
 *
 * Setup reproduction:
 *   - User logs in → token saved to localStorage via useAuth.
 *   - User reloads the page (or opens a second tab, or the auth module
 *     mirror gets reset somehow).
 *   - User clicks "Yeni Proje" → createProject fires.
 *
 * Before this fix, the request interceptor only read the module-level
 * `authToken` mirror, which could be `null` in the above scenarios, and
 * silently dropped the `X-User-Id` header. The backend then 401'd with
 * `{"error":"X-User-Id header is required","code":"unauthorized"}`.
 *
 * After this fix, the interceptor falls back to localStorage (`yz_auth_v1`)
 * when the module mirror is null/empty — so the header is always present
 * as long as the user logged in at any point in this browser.
 *
 * Tests use an Axios adapter stub so no real network is required and the
 * captured `headers` come straight from the intercepted request config.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAuthToken, getAuthToken, httpClient } from '@/infrastructure/http/client.js'

const AUTH_KEY = 'yz_auth_v1'

// Reusable adapter that resolves with a 200 + echoes the captured headers
// back as JSON. Lets each test inspect exactly what was attached.
function stubAdapter() {
  return (config) =>
    Promise.resolve({
      data: { headers: { ...config.headers } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
}

let captured = null
beforeEach(() => {
  httpClient.defaults.adapter = stubAdapter()
})
afterEach(() => {
  setAuthToken(null)
  if (typeof localStorage !== 'undefined') localStorage.clear()
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
  captured = null
})

describe('http client — X-User-Id header resilience', () => {
  it('falls back to localStorage when the module mirror is null', async () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'u-ayse', user: { id: 'u-ayse' } }))
    expect(getAuthToken()).toBe('u-ayse')

    const res = await httpClient.get('/projects')
    captured = res.data.headers['X-User-Id'] ?? res.data.headers['x-user-id']
    expect(captured).toBe('u-ayse')
  })

  it('prefers the module mirror over localStorage when both are set', async () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'u-stale', user: {} }))
    setAuthToken('u-fresh')

    const res = await httpClient.get('/projects')
    captured = res.data.headers['X-User-Id'] ?? res.data.headers['x-user-id']
    expect(captured).toBe('u-fresh')
  })

  it('does not set the header when no token is anywhere', async () => {
    const res = await httpClient.get('/projects')
    const sent = res.data.headers['X-User-Id'] ?? res.data.headers['x-user-id']
    // No truthy token exists anywhere — we must NOT send a header. axios
    // leaves the field undefined in that case.
    expect(sent == null || sent === '').toBe(true)
  })
})
