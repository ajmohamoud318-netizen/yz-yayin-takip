import { attachUser } from '../middleware/auth.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  getVapidPublicKey, isPushEnabled, saveSubscription, deleteSubscription, sendToUsers,
} from '../services/push.js'

/**
 * Web push subscription API.
 *
 * GET    /api/push/public-key   → { enabled, key } for the SPA to subscribe with
 * POST   /api/push/subscribe    → store this device
 * DELETE /api/push/subscribe    → forget this device
 * POST   /api/push/test         → send yourself one, to prove it works
 *
 * All routes are per-user and owner-scoped: a subscription always binds to
 * `request.user.id`, never to a user id from the body. Otherwise anyone could
 * register their own device against a colleague's account and silently mirror
 * that colleague's notifications.
 *
 * Writes are single-statement, so plain pool queries — no transaction needed.
 */
export async function pushRoutes(fastify) {
  // Public key + enabled flag. The SPA calls this BEFORE prompting for
  // permission: when push is disabled server-side (no VAPID keys) we want the
  // UI to hide the toggle entirely rather than ask for a permission it can't
  // then honour — a denied permission is very hard to recover from.
  fastify.get('/push/public-key', async (request) => {
    await attachUser(request)
    return { enabled: isPushEnabled(), key: getVapidPublicKey() }
  })

  fastify.post('/push/subscribe', { schema: schemas.pushSubscribe }, async (request) => {
    await attachUser(request)
    const id = await saveSubscription(getPool(), {
      userId: request.user.id,
      subscription: request.body.subscription,
      userAgent: request.headers['user-agent'] ?? '',
    })
    return { ok: id !== null, id }
  })

  fastify.delete('/push/subscribe', { schema: schemas.pushUnsubscribe }, async (request) => {
    await attachUser(request)
    const count = await deleteSubscription(getPool(), {
      userId: request.user.id,
      endpoint: request.body.endpoint,
    })
    return { ok: count > 0 }
  })

  // Send yourself a test push. This exists because push has a long, silent
  // failure chain (permission → service worker → VAPID → OS notification
  // settings) and "nothing happened" is otherwise undebuggable for a
  // non-technical user. One button that either buzzes the phone or reports
  // exactly how many devices were reached collapses that whole chain.
  fastify.post('/push/test', async (request) => {
    await attachUser(request)
    const { sent, pruned } = await sendToUsers([request.user.id], {
      type: 'info',
      title: 'YZ Yayın Takip',
      body: 'Bildirimler çalışıyor. ✅',
      tone: 'green',
      link: '/',
      notificationId: 'test',
    })
    return { sent, pruned }
  })
}
