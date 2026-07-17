/**
 * Tiny in-memory rate limiter.
 *
 * Single-process Map<key, number[]> where each entry is the timestamps
 * of recent hits. On every hit we drop entries older than `windowMs`
 * and reject if the remainder is >= `limit`.
 *
 * Good enough for one Dokploy container. Multi-instance deployments
 * would want Redis-backed counting — out of scope for now.
 */

const buckets = new Map()

/**
 * Build a Fastify preHandler that rate-limits by `key(req)`.
 *
 *   fastify.post('/forgot-password', {
 *     preHandler: rateLimit({ key: (req) => req.ip, limit: 5, windowMs: 60_000 }),
 *     handler: ...
 *   })
 */
export function rateLimit({ key, limit, windowMs }) {
  return async function rateLimitHook(request, reply) {
    const k = key(request)
    if (!k) return // no key → skip (e.g. behind a proxy that didn't set IP)
    const now = Date.now()
    const cutoff = now - windowMs
    const arr = buckets.get(k) ?? []
    const pruned = arr.filter((t) => t > cutoff)
    if (pruned.length >= limit) {
      reply.code(429)
      const retryAfter = Math.ceil((pruned[0] + windowMs - now) / 1000)
      reply.header('Retry-After', String(Math.max(retryAfter, 1)))
      return { error: 'Çok fazla istek. Lütfen biraz bekleyin.', code: 'rate_limited' }
    }
    pruned.push(now)
    buckets.set(k, pruned)
  }
}

// Periodic cleanup so the Map doesn't grow forever. Not strictly
// necessary — pruned entries are dropped on next hit — but cheap.
setInterval(() => {
  const now = Date.now()
  for (const [k, arr] of buckets.entries()) {
    const pruned = arr.filter((t) => t > now - 24 * 60 * 60 * 1000)
    if (pruned.length === 0) buckets.delete(k)
    else buckets.set(k, pruned)
  }
}, 60 * 60 * 1000).unref?.()