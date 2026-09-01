/**
 * SSE (Server-Sent Events) route for real-time notification delivery.
 *
 * Replaces the 15s polling loop in useNotifications with instant push.
 * When emit() commits a notification, it publishes a signal to the event bus;
 * this route subscribes and streams those signals to the connected client.
 *
 * The signal is minimal ({ userId, notificationId, eventId }) — the client
 * uses it to decide whether to refetch the feed, not as the notification
 * data itself. The feed query remains the single source of truth.
 *
 * Auth: EventSource can't send custom headers, so this relies on cookie
 * sessions (which attachUser checks first). In dev with header auth, SSE
 * won't connect and the client falls back to polling. In production with
 * cookie sessions, SSE works automatically.
 *
 * Reconnection: the client resyncs by refetching the whole feed in its
 * `onopen` handler — see useNotifications. There is deliberately no
 * Last-Event-ID replay here. Two reasons it was removed:
 *   1. domain_events.id is a random UUID (gen_random_uuid()::text), so the
 *      `WHERE id > $1` cursor it relied on compared UUIDs lexicographically.
 *      That has no relationship to time: each reconnect replayed a random
 *      slice of the table and skipped a random slice of what was missed.
 *   2. domain_events holds one row per business event, not per recipient,
 *      so a replay could not be scoped to the reconnecting user — every
 *      client got every other user's title/body/link over the wire.
 * A full feed refetch on open is cheap, correct, and already the single
 * source of truth. This path matters: mobile clients drop the stream
 * constantly (QUIC RTO timeouts on carrier handoff), so reconnect is the
 * common case, not the edge case.
 */

import { attachUser } from '../middleware/auth.js'
import { subscribe } from '../services/event-bus.js'

export async function eventRoutes(fastify) {
  /**
   * GET /api/events/stream — SSE endpoint for real-time notification signals.
   *
   * The client opens this with EventSource. The server:
   *   1. Authenticates via cookie session
   *   2. Sets SSE headers (Content-Type: text/event-stream, no caching)
   *   3. Subscribes to the event bus for live streaming
   *   4. Keeps the connection open until the client disconnects
   *
   * Anything the client missed while disconnected is picked up by its own
   * refetch on open, not by a server-side replay — see the module header.
   */
  fastify.get('/events/stream', async (request, reply) => {
    await attachUser(request)
    const userId = request.user.id

    // SSE headers. Cache-Control: no-cache prevents proxies from buffering.
    // Connection: keep-alive is implicit in HTTP/1.1 but explicit here for
    // clarity. X-Accel-Buffering: no disables nginx buffering if present.
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Subscribe to live events. Filter by userId so the client only receives
    // events it cares about (notifications addressed to it). The event bus
    // publishes every notification event; we filter here to avoid sending
    // irrelevant signals to every connected client.
    const unsubscribe = subscribe((event) => {
      if (event.userId === userId) {
        reply.raw.write(`id: ${event.eventId}\nevent: notification\ndata: ${JSON.stringify(event)}\n\n`)
      }
    })

    // Heartbeat every 30s to keep the connection alive through proxies and
    // load balancers that close idle connections. The client ignores comments
    // (lines starting with ":") but they reset the idle timer.
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 30_000)

    // Cleanup on disconnect. The client may close the connection for many
    // reasons (tab closed, network change, page navigation). We must
    // unsubscribe from the event bus and clear the heartbeat to avoid
    // leaking listeners and timers.
    request.raw.on('close', () => {
      unsubscribe()
      clearInterval(heartbeat)
    })
  })
}
