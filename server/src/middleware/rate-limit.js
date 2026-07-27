/**
 * Rate limiter with a pluggable store.
 *
 * Two backends, selected by `config.rateLimit.store`:
 *
 *   • 'memory' (default) — a single-process Map<string, number[]> of recent
 *     hit timestamps. Correct for one container; limits are per-instance.
 *
 *   • 'redis' — a shared sliding-window (Redis sorted set per key) so limits
 *     hold across a multi-instance deployment. Opt in with RATE_LIMIT_STORE=
 *     redis. If Redis is unreachable the limiter transparently falls back to
 *     the in-memory store, so a Redis outage degrades (per-instance limits)
 *     rather than failing the request.
 *
 * Usage:
 *   fastify.post('/login', {
 *     preHandler: rateLimit({
 *       keys: [(req) => `ip:${req.ip}`, (req) => `email:${req.body?.email}`],
 *       limit: 10,
 *       windowMs: 5 * 60_000,
 *     }),
 *   })
 *
 * Multiple keys produce an AND: every identifiable bucket must be under the
 * limit for the request to proceed, so `[ip, email]` blocks BOTH a single IP
 * hammering AND a distributed credential-stuffing wave per email. A hit is
 * only recorded when every bucket passes (a blocked request doesn't count).
 */

import { config } from '../config.js'

// ─── in-memory store ───────────────────────────────────────────────────

const buckets = new Map()

const memoryStore = {
  // Prune expired hits, return the current count + oldest surviving ts.
  async peek(key, windowMs, now) {
    const cutoff = now - windowMs
    const pruned = (buckets.get(key) ?? []).filter((t) => t > cutoff)
    buckets.set(key, pruned)
    return { count: pruned.length, oldest: pruned[0] ?? null }
  },
  async record(key, now) {
    const arr = buckets.get(key) ?? []
    arr.push(now)
    buckets.set(key, arr)
  },
}

// ─── redis store (opt-in, lazy) ────────────────────────────────────────

let redisClient = null
let redisInit = false
let redisWarned = false

// Lazily import + connect ioredis so the dependency is never loaded when
// running with the default in-memory store.
async function redisConn() {
  if (redisInit) return redisClient
  redisInit = true
  try {
    const { default: Redis } = await import('ioredis')
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    })
    redisClient.on('error', (err) => {
      if (!redisWarned) {
        // eslint-disable-next-line no-console
        console.error('[rate-limit] redis error → in-memory fallback:', err?.message ?? err)
        redisWarned = true
      }
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[rate-limit] ioredis load failed → in-memory fallback:', err?.message ?? err)
    redisClient = null
  }
  return redisClient
}

const redisStore = {
  async peek(key, windowMs, now) {
    const r = await redisConn()
    if (!r) return memoryStore.peek(key, windowMs, now)
    const rk = `rl:${key}`
    try {
      const res = await r
        .multi()
        .zremrangebyscore(rk, 0, now - windowMs) // drop expired
        .zrange(rk, 0, 0, 'WITHSCORES') // oldest surviving [member, score]
        .zcard(rk) // count in window
        .exec()
      const oldestArr = res?.[1]?.[1]
      const card = res?.[2]?.[1] ?? 0
      const oldest = Array.isArray(oldestArr) && oldestArr.length ? Number(oldestArr[1]) : null
      return { count: Number(card), oldest }
    } catch (err) {
      if (!redisWarned) {
        // eslint-disable-next-line no-console
        console.error('[rate-limit] redis peek failed → in-memory fallback:', err?.message ?? err)
        redisWarned = true
      }
      return memoryStore.peek(key, windowMs, now)
    }
  },
  async record(key, now, windowMs) {
    const r = await redisConn()
    if (!r) return memoryStore.record(key, now)
    const rk = `rl:${key}`
    try {
      await r
        .multi()
        .zadd(rk, now, `${now}-${Math.random().toString(36).slice(2)}`)
        .pexpire(rk, windowMs)
        .exec()
    } catch {
      return memoryStore.record(key, now)
    }
  },
}

function activeStore() {
  return config.rateLimit.store === 'redis' ? redisStore : memoryStore
}

// ─── middleware ────────────────────────────────────────────────────────

/**
 * @param {{
 *   keys: Array<(req: import('fastify').FastifyRequest) => string | null | undefined>,
 *   limit: number,
 *   windowMs: number,
 *   message?: string,
 * }} opts
 */
export function rateLimit({ keys, limit, windowMs, message }) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('rateLimit: `keys` must be a non-empty array')
  }
  return async function rateLimitHook(request, reply) {
    const now = Date.now()
    const store = activeStore()

    // Phase 1 — check every identifiable bucket; block if any is at the limit.
    for (const keyFn of keys) {
      const k = keyFn(request)
      // No key (e.g. body field missing) → we can't identify this bucket, skip.
      if (!k) continue
      const { count, oldest } = await store.peek(k, windowMs, now)
      if (count >= limit) {
        reply.code(429)
        const retryAfter = Math.ceil(((oldest ?? now) + windowMs - now) / 1000)
        reply.header('Retry-After', String(Math.max(retryAfter, 1)))
        // Fastify 5 quirk: returning a value from a preHandler is silently
        // discarded — we must call reply.send() and return reply to
        // short-circuit the route handler.
        reply.send({
          error: message ?? 'Çok fazla istek. Lütfen biraz bekleyin.',
          code: 'rate_limited',
        })
        return reply
      }
    }

    // Phase 2 — all buckets under limit → record the hit in each one.
    for (const keyFn of keys) {
      const k = keyFn(request)
      if (!k) continue
      await store.record(k, now, windowMs)
    }
  }
}

/**
 * Drop all in-memory buckets — exposed for tests so each case starts clean.
 * Production code never needs this. (Redis keys expire on their own TTL.)
 */
export function _resetRateLimit() {
  buckets.clear()
}

// Periodic cleanup so the in-memory Map doesn't grow forever. Not strictly
// necessary — pruned entries are dropped on next hit — but cheap.
setInterval(() => {
  const now = Date.now()
  for (const [k, arr] of buckets.entries()) {
    const pruned = arr.filter((t) => t > now - 24 * 60 * 60 * 1000)
    if (pruned.length === 0) buckets.delete(k)
    else buckets.set(k, pruned)
  }
}, 60 * 60 * 1000).unref?.()
