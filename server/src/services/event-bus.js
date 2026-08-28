/**
 * In-process event bus for real-time SSE delivery.
 *
 * Lightweight pub/sub: emit() publishes a signal after the transaction
 * commits, and the SSE route subscribes to stream those signals to connected
 * clients. No external dependencies (Redis, Kafka) — this is a single-server
 * deployment, so an EventEmitter is sufficient.
 *
 * The signal is minimal (notification id + user id + event id). The client
 * receives the signal and refetches the notification feed. This keeps the
 * SSE payload small and the feed query as the single source of truth.
 *
 * Usage:
 *   // In emit(), after commit:
 *   publishNotificationEvent({ userId, notificationId, eventId })
 *
 *   // In SSE route:
 *   const unsubscribe = subscribe((event) => {
 *     reply.write(`data: ${JSON.stringify(event)}\n\n`)
 *   })
 *   request.raw.on('close', unsubscribe)
 */

import { EventEmitter } from 'node:events'

const bus = new EventEmitter()
bus.setMaxListeners(1000) // Support many concurrent SSE connections

/**
 * Publish a notification event to all SSE subscribers. Called from emit()'s
 * afterCommit hook so the signal only fires after the transaction is durable.
 *
 * The payload is deliberately minimal: the client uses it to decide whether
 * to refetch, not as the notification data itself. The feed query remains
 * the single source of truth.
 */
export function publishNotificationEvent(event) {
  bus.emit('notification', event)
}

/**
 * Subscribe to notification events. Returns an unsubscribe function.
 *
 * The callback receives the event payload ({ userId, notificationId, eventId }).
 * The SSE route uses this to stream events to the connected client.
 *
 * The caller MUST call the returned unsubscribe function when the connection
 * closes, otherwise the listener leaks and the EventEmitter's listener count
 * grows without bound.
 */
export function subscribe(callback) {
  bus.on('notification', callback)
  return () => bus.off('notification', callback)
}
