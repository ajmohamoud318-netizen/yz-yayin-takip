import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.SESSION_SECRET = 'test-secret-do-not-use-in-prod-1234567890abcdef'

const {
  buildSessionCookie,
  buildLogoutCookie,
  parseSessionCookie,
  SESSION_COOKIE_NAME,
} = await import('./cookies.js')

test('round-trips a session id through build → parse', () => {
  const sid = 'test-session-12345'
  const expiresAt = new Date(Date.now() + 60_000)
  const headerValue = buildSessionCookie(sid, expiresAt)
  assert.match(headerValue, /^yz_sid=/)
  assert.match(headerValue, /HttpOnly/)
  assert.match(headerValue, /SameSite=Lax/)
  assert.match(headerValue, /Path=\//)
  // Secure only set in production
  assert.doesNotMatch(headerValue, /Secure/)
  const parsed = parseSessionCookie(headerValue)
  assert.ok(parsed)
  assert.equal(parsed.sid, sid)
})

test('parseSessionCookie accepts the real Cookie header shape', () => {
  const sid = 'sid-from-cookie-header'
  const expiresAt = new Date(Date.now() + 60_000)
  const setCookie = buildSessionCookie(sid, expiresAt)
  const cookieValue = setCookie.split(';')[0] // "yz_sid=payload.sig"
  // browsers send back the name=value only
  const parsed = parseSessionCookie(cookieValue)
  assert.ok(parsed)
  assert.equal(parsed.sid, sid)
})

test('rejects tampered signature', () => {
  const expiresAt = new Date(Date.now() + 60_000)
  const setCookie = buildSessionCookie('real-sid', expiresAt)
  const cookieValue = setCookie.split(';')[0]
  // flip the last char of the signature
  const flipped = cookieValue.slice(0, -1) + (cookieValue.endsWith('A') ? 'B' : 'A')
  assert.equal(parseSessionCookie(flipped), null)
})

test('rejects completely forged payload', () => {
  const forged = `${SESSION_COOKIE_NAME}=forged.signature`
  assert.equal(parseSessionCookie(forged), null)
})

test('rejects expired cookie', () => {
  const sid = 'expired-sid'
  const expiresAt = new Date(Date.now() - 1000) // already past
  const setCookie = buildSessionCookie(sid, expiresAt)
  const cookieValue = setCookie.split(';')[0]
  assert.equal(parseSessionCookie(cookieValue), null)
})

test('rejects empty / missing cookie', () => {
  assert.equal(parseSessionCookie(undefined), null)
  assert.equal(parseSessionCookie(''), null)
  assert.equal(parseSessionCookie('other=value'), null)
})

test('logout cookie clears the cookie', () => {
  const logout = buildLogoutCookie()
  assert.match(logout, /^yz_sid=/)
  assert.match(logout, /Max-Age=0/)
  // A browser would replace the existing cookie with this, leaving it
  // empty — server treats empty as "no session".
  assert.equal(parseSessionCookie('yz_sid='), null)
})

test('different secrets invalidate cookies', async () => {
  // Build a cookie with one secret, then swap secrets and verify
  // it no longer parses.
  const sid = 'sid-A'
  const expiresAt = new Date(Date.now() + 60_000)
  const cookieValue = buildSessionCookie(sid, expiresAt).split(';')[0]

  process.env.SESSION_SECRET = 'a-different-secret-of-equal-length!'
  // Re-import to pick up the new secret (modules cache the value).
  const reloaded = await import(`./cookies.js?v=${Date.now()}`)
  assert.equal(reloaded.parseSessionCookie(cookieValue), null)
})
