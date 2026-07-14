/**
 * Redis client wrapper.
 *
 * Lazily connects on first use so the server can boot even if Redis is
 * temporarily unreachable. Exposes a small subset (get/set/del/quit) and a
 * `withClient(fn)` helper that runs a callback with a connected client.
 *
 * Use cases (planned):
 *   • Session storage (session:<id> with TTL)
 *   • Dashboard cache (cache:projects with 30s TTL)
 *   • Notification pub-sub (notify:<userId>)
 *
 * Today the wrapper just exports `getClient()` so future route modules can
 * `import { getClient } from '../services/redis.js'` without crashing the
 * boot if Redis is down.
 */

import Redis from 'ioredis'
import { config } from '../config.js'

let client = null
let connectAttempted = false

export function getClient() {
  if (client) return client
  if (!config.redisUrl) return null

  client = new Redis(config.redisUrl, {
    // Don't block boot if Redis is down — fail commands fast and let the
    // caller decide whether to fall back. The dev pass is tolerant.
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  })

  client.on('error', (err) => {
    // ioredis logs these too; we keep the message short so it doesn't
    // spam the boot log when Redis isn't running locally.
    // eslint-disable-next-line no-console
    console.warn('[redis] error:', err.message)
  })

  // Kick off the connection but don't await — the rest of the server
  // should boot even if Redis isn't ready yet.
  if (!connectAttempted) {
    connectAttempted = true
    client.connect().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[redis] connect failed:', err.message)
    })
  }

  return client
}

export async function quit() {
  if (!client) return
  try {
    await client.quit()
  } catch {
    /* ignore */
  }
  client = null
  connectAttempted = false
}