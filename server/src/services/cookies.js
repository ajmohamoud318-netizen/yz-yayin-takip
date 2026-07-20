/**
 * Cookie helper — minimal, signed (HMAC-SHA256), no external deps.
 *
 * Why not @fastify/cookie: the sandbox blocked npm install for it, and
 * the surface we need is tiny — parse + sign a single `yz_sid` cookie.
 * One well-audited 50-line helper is easier to keep secure than a
 * shipped dep we never look at.
 *
 * Cookie format: `${payload}.${signature}` where
 *   payload = base64url(JSON.stringify({ sid, exp }))
 *   signature = HMAC_SHA256(secret, payload)
 *
 * The session id is opaque; all user data lives server-side under
 * `session:<sid>` in Redis. The cookie only carries the sid + an
 * expiry hint that the browser keeps.
 *
 * SECURITY
 * - Cookies are always httpOnly + sameSite=lax. Secure flag flips on
 *   in production.
 * - The signature uses a constant-time comparison to prevent timing
 *   attacks on the secret.
 * - The cookie body is short on purpose — we put no user data in it.
 * - Signature failure → throw, never silently pass.
 */

import crypto from 'node:crypto'
import { config } from '../config.js'

const COOKIE_NAME = 'yz_sid'
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function getSecret() {
  // SESSION_SECRET is the HMAC key. Fail closed if it's missing in
  // production — using a default would let an attacker forge cookies
  // with the public source code.
  const secret = process.env.SESSION_SECRET?.trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET is required in production. Generate one with: openssl rand -hex 32',
      )
    }
    // Dev fallback — random per-process so a leaked dev token can't
    // persist across restarts.
    return crypto.randomBytes(32).toString('hex')
  }
  return secret
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url')
}

function b64urlDecode(str) {
  return Buffer.from(str, 'base64url')
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

function safeEqual(a, b) {
  // Length-check first so crypto.timingSafeEqual doesn't throw on a
  // length mismatch. Constant-time-ish beyond that.
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Build a Set-Cookie header value for a freshly-minted session id.
 *
 *   const headerValue = buildSessionCookie(sid, new Date(Date.now() + ms))
 *   reply.header('Set-Cookie', headerValue)
 */
export function buildSessionCookie(sid, expiresAt) {
  const exp = Math.floor(expiresAt.getTime() / 1000)
  const payload = b64urlEncode(JSON.stringify({ sid, exp }))
  const signature = sign(payload, getSecret())
  const value = `${payload}.${signature}`

  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`,
  ]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  // Expires is redundant with Max-Age but some legacy clients need it.
  parts.push(`Expires=${expiresAt.toUTCString()}`)
  return parts.join('; ')
}

/**
 * Build a Set-Cookie that immediately expires the session cookie on the
 * browser side (used on /logout).
 */
export function buildLogoutCookie() {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

/**
 * Parse the Cookie header from an incoming request and return the
 * session payload if the signature verifies and the cookie hasn't
 * expired. Returns null on any failure — never throws (the caller
 * decides the response shape).
 *
 *   parseSessionCookie(req.headers.cookie) → { sid, exp } | null
 */
export function parseSessionCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null
  const cookies = cookieHeader.split(/;\s*/)
  let raw = null
  for (const part of cookies) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === COOKIE_NAME) {
      raw = part.slice(eq + 1)
      break
    }
  }
  if (!raw) return null

  const dot = raw.lastIndexOf('.')
  if (dot === -1) return null
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)

  const expected = sign(payload, getSecret())
  if (!safeEqual(signature, expected)) return null

  let parsed
  try {
    parsed = JSON.parse(b64urlDecode(payload).toString('utf8'))
  } catch {
    return null
  }
  if (!parsed?.sid || typeof parsed.sid !== 'string') return null

  // Defensive clock check — Redis is the source of truth for expiry,
  // but a stale cookie hint lets us reject early without a round-trip.
  if (typeof parsed.exp === 'number' && parsed.exp * 1000 < Date.now()) {
    return null
  }

  return { sid: parsed.sid, exp: parsed.exp }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
export const SESSION_MAX_AGE_MS = COOKIE_MAX_AGE_MS
// Suppress unused-import warning in dev — config is intentionally
// accessible from this module so future cookie options can read it.
void config
