import { attachUser } from '../middleware/auth.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  listForUser, countsForUser, markRead, markAllRead, markAllSeen, clampPageSize,
} from '../services/notifications.js'

/**
 * Per-user notification feed.
 *
 * GET   /api/notifications              → newest page + { unread, unseen, nextCursor }
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

/**
 * Cursor codec. `<created_at ISO>|<id>` — opaque to the client, which only
 * ever echoes back what it was handed. Encoded as one string rather than two
 * query params so a caller can't construct a half-valid cursor (a timestamp
 * with no tiebreak id) that silently drops rows at a page boundary.
 */
function encodeCursor(row) {
  if (!row) return null
  const at = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  return `${at}|${row.id}`
}

function decodeCursor(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  const sep = raw.indexOf('|')
  if (sep <= 0) return null
  const createdAt = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!id || Number.isNaN(Date.parse(createdAt))) return null
  return { createdAt, id }
}

export async function notificationRoutes(fastify) {
  fastify.get('/notifications', { schema: schemas.notificationListQuery }, async (request) => {
    await attachUser(request)
    const pool = getPool()
    // Same normalisation the query will apply, so `nextCursor` below compares
    // against the number of rows actually asked for.
    const limit = clampPageSize(request.query.limit)
    const cursor = decodeCursor(request.query.cursor)

    const items = await listForUser(pool, request.user.id, { limit, cursor })
    // Counts come from a real aggregate, NOT from looping `items`. The old
    // version derived them from the page, so a user with more unread rows than
    // fit in one page saw a badge that was quietly wrong — and capped.
    const { unread, unseen } = await countsForUser(pool, request.user.id)

    return {
      items,
      unread,
      unseen,
      // Null once the page came back short: there is nothing after it.
      nextCursor: items.length === limit ? encodeCursor(items[items.length - 1]) : null,
    }
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
