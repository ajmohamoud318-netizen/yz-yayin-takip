/**
 * Tiny in-memory rate limiter.
 *
 * Single-process Map<string, number[]> where each entry is the timestamps
 * of recent hits. On every hit we drop entries older than `windowMs`
 * and reject if the remainder is >= `limit`.
 *
 * Good enough for one Dokploy container. Multi-instance deployments
 * would want Redis-backed counting — out of scope for now.
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
 * Multiple keys produce an AND: every bucket must be under the limit
 * for the request to proceed. So `[ip, email]` blocks BOTH a single IP
 * hammering AND a distributed credential-stuffing wave per email.
 */

const buckets = new Map()

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
    const cutoff = now - windowMs

    for (const keyFn of keys) {
      const k = keyFn(request)
      // No key (e.g. body field missing) → don't count this bucket.
      // We only enforce limits on buckets we can identify.
      if (!k) continue

      const arr = buckets.get(k) ?? []
      const pruned = arr.filter((t) => t > cutoff)
      if (pruned.length >= limit) {
        reply.code(429)
        const retryAfter = Math.ceil((pruned[0] + windowMs - now) / 1000)
        reply.header('Retry-After', String(Math.max(retryAfter, 1)))
        // Fastify 5 quirk: returning a value from a preHandler is
        // *silently discarded* — the route handler still runs and
        // returns its own body. We must explicitly call reply.send()
        // and return reply to short-circuit.
        const errPayload = {
          error: message ?? 'Çok fazla istek. Lütfen biraz bekleyin.',
          code: 'rate_limited',
        }
        reply.send(errPayload)
        return reply
      }
    }

    // All buckets under limit → record the hit in each one.
    for (const keyFn of keys) {
      const k = keyFn(request)
      if (!k) continue
      const arr = buckets.get(k) ?? []
      arr.push(now)
      buckets.set(k, arr)
    }
  }
}

/**
 * Drop all buckets — exposed for tests so each case starts clean.
 * Production code never needs this.
 */
export function _resetRateLimit() {
  buckets.clear()
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
