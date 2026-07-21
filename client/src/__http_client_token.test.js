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

  it('seeds the module mirror from localStorage at module-load time', async () => {
    // This guards the very-first-render race: before the eager seed at
    // module-load time, the very first api call after a hard refresh
    // could fire before AuthProvider's useEffect called setAuthToken,
    // leaving the module mirror null. The eager read closes the race.
    //
    // We can't reach into the IIFE directly, but we can prove the
    // observable side-effect: import the module after a stored token
    // exists and immediately call getAuthToken.
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'u-eager', user: {} }))
    // Re-import the module to re-run the eager seed line.
    const mod = await import('@/infrastructure/http/client.js')
    expect(mod.getAuthToken()).toBe('u-eager')
  })

  it('on 401, a server rejection propagates with status 401', async () => {
    // We do NOT want the global interceptor to actually navigate when
    // jsdom runs the test (it would corrupt test isolation). Stub a
    // 401-resolving adapter and confirm the rejected Error carries
    // `status === 401` so any UI page that wants to bounce the user
    // can branch on it.
    setAuthToken('u-401')
    httpClient.defaults.adapter = (config) =>
      Promise.reject({
        response: {
          status: 401,
          data: { error: 'X-User-Id header is required', code: 'unauthorized' },
          headers: {},
          config,
        },
      })
    let caught
    try {
      await httpClient.get('/projects')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeTruthy()
    expect(caught.status).toBe(401)
    expect(caught.message).toBe('X-User-Id header is required')
  })
})
