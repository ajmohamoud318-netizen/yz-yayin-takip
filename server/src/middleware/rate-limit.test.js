import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { rateLimit, _resetRateLimit } from './rate-limit.js'

/**
 * Build a minimal Fastify app with one route guarded by the rate-limit
 * helper, then assert the limit behaviour. Uses fastify.inject so no
 * listening socket / port collision possible.
 */
function buildApp({ keys, limit, windowMs, message } = {}) {
  _resetRateLimit()
  const app = Fastify()
  app.post(
    '/test',
    {
      preHandler: rateLimit({ keys, limit, windowMs, message }),
    },
    async () => ({ ok: true }),
  )
  app.post(
    '/_reset',
    { preHandler: async () => { _resetRateLimit(); return { ok: true } } },
    async () => ({ ok: true }),
  )
  return app
}

const fakeReq = (overrides = {}) => ({
  ip: '10.0.0.1',
  body: {},
  headers: {},
  ...overrides,
})

test('allows requests under the limit', async () => {
  const app = buildApp({
    keys: [() => 'ip:10.0.0.1'],
    limit: 3,
    windowMs: 60_000,
  })
  for (let i = 0; i < 3; i++) {
    const r = await app.inject({
      method: 'POST',
      url: '/test',
      payload: {},
    })
    assert.equal(r.statusCode, 200, `attempt ${i + 1} should pass`)
  }
  await app.close()
})

test('returns 429 once the limit is hit, with Retry-After', async () => {
  const app = buildApp({
    keys: [() => 'ip:10.0.0.1'],
    limit: 2,
    windowMs: 60_000,
    message: 'Yavaş ol!',
  })
  await app.inject({ method: 'POST', url: '/test', payload: {} })
  await app.inject({ method: 'POST', url: '/test', payload: {} })
  const blocked = await app.inject({ method: 'POST', url: '/test', payload: {} })
  assert.equal(blocked.statusCode, 429)
  assert.match(blocked.body, /Yavaş ol!/)
  assert.equal(blocked.headers['retry-after'], '60')
  const parsed = JSON.parse(blocked.body)
  assert.equal(parsed.code, 'rate_limited')
  await app.close()
})

test('AND-keys: blocks when either bucket is full', async () => {
  const app = buildApp({
    keys: [
      (req) => `ip:${req.ip}`,
      (req) => `email:${req.body?.email}`,
    ],
    limit: 3,
    windowMs: 60_000,
  })
  // 3 attempts from the same IP+email pass.
  for (let i = 0; i < 3; i++) {
    const r = await app.inject({
      method: 'POST',
      url: '/test',
      payload: { email: 'a@y.com' },
    })
    assert.equal(r.statusCode, 200)
  }
  // 4th hit, same email → blocked (email bucket full).
  const blocked = await app.inject({
    method: 'POST',
    url: '/test',
    payload: { email: 'a@y.com' },
  })
  assert.equal(blocked.statusCode, 429)

  // Different email from the same IP — IP bucket already at 3 too,
  // so this is blocked on the IP bucket.
  const sameIpNewEmail = await app.inject({
    method: 'POST',
    url: '/test',
    payload: { email: 'b@y.com' },
  })
  assert.equal(sameIpNewEmail.statusCode, 429)

  // Reset and try a different IP + new email — fresh buckets, passes.
  // We rebuild the app rather than tweaking req.ip, since fastify.inject
  // doesn't propagate remoteAddress into the helper.
  await app.close()
  const app2 = buildApp({
    keys: [() => 'ip:10.0.0.2', (req) => `email:${req.body?.email}`],
    limit: 3,
    windowMs: 60_000,
  })
  const freshIp = await app2.inject({
    method: 'POST',
    url: '/test',
    payload: { email: 'c@y.com' },
  })
  assert.equal(freshIp.statusCode, 200)
  await app2.close()
})

test('skip buckets where the key function returns null', async () => {
  const app = buildApp({
    keys: [
      () => 'ip:10.0.0.1',
      // Only contributes when email is present.
      (req) => req.body?.email ? `email:${req.body.email}` : null,
    ],
    limit: 2,
    windowMs: 60_000,
  })
  // First two hits have no email — IP bucket is the only one enforced.
  for (let i = 0; i < 2; i++) {
    const r = await app.inject({ method: 'POST', url: '/test', payload: {} })
    assert.equal(r.statusCode, 200)
  }
  // Third hit without email → IP bucket full → blocked.
  const noEmailBlocked = await app.inject({ method: 'POST', url: '/test', payload: {} })
  assert.equal(noEmailBlocked.statusCode, 429)
  await app.close()
})

test('window expiry releases the bucket', async () => {
  const app = buildApp({
    keys: [() => 'ip:10.0.0.1'],
    limit: 2,
    windowMs: 50,
  })
  await app.inject({ method: 'POST', url: '/test', payload: {} })
  await app.inject({ method: 'POST', url: '/test', payload: {} })
  const blocked = await app.inject({ method: 'POST', url: '/test', payload: {} })
  assert.equal(blocked.statusCode, 429)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const afterWindow = await app.inject({ method: 'POST', url: '/test', payload: {} })
  assert.equal(afterWindow.statusCode, 200)
  await app.close()
})

test('throws when constructed without keys', () => {
  assert.throws(() => rateLimit({ limit: 1, windowMs: 1000 }), /keys/)
  assert.throws(() => rateLimit({ keys: [], limit: 1, windowMs: 1000 }), /keys/)
})
