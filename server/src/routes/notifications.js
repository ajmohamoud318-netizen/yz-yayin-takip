import { attachUser } from '../middleware/auth.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  listForUser, unreadCount, unseenCount, markRead, markAllRead, markAllSeen,
} from '../services/notifications.js'

/**
 * Per-user notification feed.
 *
 * GET   /api/notifications              → newest 50 + { unread, unseen }
 * GET   /api/notifications/unread-count → { count, unseen }
 * PATCH /api/notifications/:id/read     → mark one read (owner-scoped)
 * POST  /api/notifications/read-all     → mark all read, returns { count }
 * POST  /api/notifications/seen         → mark all seen (badge), returns { count }
 *
 * "seen" drives the bell badge (cleared on open); "is_read" drives per-item
 * bold styling (cleared on click). See migration 024 for the rationale.
 *
 * Reads are plain pool queries (no transaction needed); the writes are
 * single-statement and owner-scoped so a user can only touch their own rows.
 */
export async function notificationRoutes(fastify) {
  fastify.get('/notifications', async (request) => {
    await attachUser(request)
    const items = await listForUser(getPool(), request.user.id)
    // Aggregate both counts from the page we already fetched (avoids extra
    // round-trips; the 50-row cap is plenty for the badge in practice).
    let unread = 0
    let unseen = 0
    for (const it of items) {
      if (!it.is_read) unread += 1
      if (!it.seen) unseen += 1
    }
    return { items, unread, unseen }
  })

  fastify.get('/notifications/unread-count', async (request) => {
    await attachUser(request)
    const [count, unseen] = await Promise.all([
      unreadCount(getPool(), request.user.id),
      unseenCount(getPool(), request.user.id),
    ])
    return { count, unseen }
  })

  fastify.patch('/notifications/:id/read', { schema: schemas.notificationIdParams }, async (request) => {
    await attachUser(request)
    const ok = await markRead(getPool(), request.user.id, request.params.id)
    return { ok }
  })

  fastify.post('/notifications/read-all', async (request) => {
    await attachUser(request)
    const count = await markAllRead(getPool(), request.user.id)
    return { count }
  })

  // Mark everything seen — called when the bell is opened. Clears the badge
  // but leaves is_read alone so items stay bold until clicked.
  fastify.post('/notifications/seen', async (request) => {
    await attachUser(request)
    const count = await markAllSeen(getPool(), request.user.id)
    return { count }
  })
}
