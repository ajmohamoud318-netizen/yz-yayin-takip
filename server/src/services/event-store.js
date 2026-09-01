/**
 * Event store — append-only log of every business event.
 *
 * One row per business occurrence (not per recipient). A single emit() that
 * notifies 5 users creates 5 notification rows but only 1 domain_event. The
 * payload captures the full event context so a future consumer (Slack, email
 * digest, analytics) can extract whatever it needs without joining tables.
 *
 * Usage:
 *   await appendDomainEvent(client, {
 *     eventType: 'project.transition',
 *     aggregateId: project.id,
 *     actorId: actor.id,
 *     payload: { type: 'demo_approval_pending', title: project.title, ... },
 *   })
 *
 * The event is inserted in the SAME transaction as the state change and
 * notification rows. If the transaction rolls back, the event is gone too —
 * the event log is always consistent with the notification feed.
 */

/**
 * Append a domain event to the log. Called from emit() inside the same
 * transaction that writes the notification rows.
 *
 * Returns the inserted row's id (used by SSE for Last-Event-ID tracking).
 */
export async function appendDomainEvent(client, { eventType, aggregateId, actorId, payload }) {
  const { rows } = await client.query(
    `INSERT INTO domain_events (event_type, aggregate_id, actor_id, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [eventType, aggregateId ?? null, actorId ?? null, JSON.stringify(payload ?? {})],
  )
  return rows[0]
}

/**
 * Query events newer than a given id.
 *
 * WARNING — the `sinceId` cursor is NOT a reliable "everything after X".
 * domain_events.id is a random UUID (gen_random_uuid()::text), so `id > $1`
 * is a lexicographic comparison with no relationship to insertion order:
 * it returns a random subset and omits a random subset. Passing sinceId=null
 * (all events, oldest-first) is sound; anything else is not.
 *
 * This is why the SSE route no longer replays on Last-Event-ID — see
 * routes/events.js. A trustworthy cursor needs a monotonic column
 * (BIGSERIAL) on the table; until then treat sinceId as best-effort.
 *
 * Returns at most `limit` events, ordered oldest-first (the order they
 * occurred).
 */
export async function queryEventsSince(client, { sinceId, limit = 100 }) {
  const { rows } = await client.query(
    `SELECT id, event_type, aggregate_id, actor_id, payload, created_at
     FROM domain_events
     WHERE ($1::text IS NULL OR id > $1::text)
     ORDER BY created_at, id
     LIMIT $2`,
    [sinceId ?? null, limit],
  )
  return rows
}

/**
 * Query events for a specific aggregate (project, order, etc). Used by
 * future consumers that want "everything that happened to X" without
 * parsing notification rows.
 */
export async function queryEventsForAggregate(client, aggregateId, { limit = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT id, event_type, aggregate_id, actor_id, payload, created_at
     FROM domain_events
     WHERE aggregate_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [aggregateId, limit],
  )
  return rows
}
