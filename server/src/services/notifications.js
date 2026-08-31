/**
 * Notifications service — orchestrator + delivery + queries.
 *
 * The single place that decides WHO gets told WHAT when project / order /
 * handover state changes. Called from the transition routes inside the same
 * `withTx` client that wrote the `stage_history` row, so a notification is
 * committed iff the state change it describes is committed — no more
 * client-side diffing / guessing.
 *
 * Design:
 *  - `emit()` is the low-level primitive: fan a single event out to a set of
 *    recipient user ids (deduped, actor removed) as one row each.
 *  - The `notify*` helpers encode the role/assignment rules that used to live
 *    (twice, and drifting) in the client's NotificationSync + buildNotifications.
 *    Now they live here once, event-driven.
 *
 * Sibling files split out by concern (slice: `refactor/notifications-split`):
 *  - `./notifications-pipeline.js` — project pipeline events (create,
 *    demo/ozalit receive, change-request/accept/decline, baski onay,
 *    project transition / delete, product catalog, ekran demo).
 *  - `./notifications-domains.js` — sipariş (orders), toplantı
 *    (meetings), hedef proje (target project ideas), and teslim
 *    (handover) notification paths.
 *
 * The two sibling files are re-exported from this module so the
 * external import shape (`import { notifyXxx } from
 * '../services/notifications.js'`) keeps working unchanged.
 *
 * Recipients are resolved against the CURRENT active user set, so a
 * deactivated user never accrues a feed and "all team leaders" always means
 * the live ones.
 */

import { getPool } from '../db/pool.js'
import { isPushEnabled, sendToRecipients } from './push.js'
import { appendDomainEvent } from './event-store.js'
import { publishNotificationEvent } from './event-bus.js'

/**
 * How many times a notification whose delivery keeps failing transiently is
 * retried before we give up and mark it pushed anyway.
 *
 * Delivery is best-effort by design — the bell feed is the source of truth and
 * is unaffected — so the only thing an unbounded retry buys is an ever-growing
 * pending set. Five attempts spans roughly a minute of sweeps, which covers a
 * push-service blip or a redeploy without chasing a genuinely broken device.
 */
export const PUSH_MAX_ATTEMPTS = 5

/** Active user ids for the given role(s). */
export async function activeUserIdsByRole(client, ...roles) {
  if (roles.length === 0) return []
  const { rows } = await client.query(
    `SELECT id FROM users WHERE role = ANY($1) AND is_active = TRUE`,
    [roles],
  )
  return rows.map((r) => r.id)
}

/**
 * Low-level fan-out. Inserts one notification row per recipient.
 *
 *  recipientIds  array of user ids (may contain dups / the actor / nulls —
 *                all are cleaned here)
 *  actorId       who caused the event; removed from recipients so you never
 *                get pinged for your own action
 *
 * Returns the number of rows written.
 */
export async function emit(client, {
  recipientIds = [],
  actorId = null,
  type,
  title = '',
  body = '',
  tone = 'blue',
  projectId = null,
  orderId = null,
  link = null,
  event = undefined,
}) {
  const clean = [...new Set(recipientIds.filter(Boolean))].filter((id) => id !== actorId)
  if (clean.length === 0) return 0

  // Delivery state (migration 034). When push is disabled server-side — the
  // local dev default, and any deploy without VAPID keys — nothing will ever
  // deliver these, so stamp them settled at insert time. Leaving them owed
  // would grow the `pushed_at IS NULL` partial index to cover the whole table
  // and give the sweeper a backlog it can never drain.
  const settledNow = isPushEnabled() ? null : new Date()

  // Multi-row parameterised insert: one ($n,…) tuple per recipient.
  const cols = '(user_id, type, title, body, tone, project_id, order_id, link, actor_id, pushed_at)'
  const tuples = []
  const values = []
  clean.forEach((uid, i) => {
    const b = i * 10
    tuples.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`,
    )
    values.push(uid, type, title, body, tone, projectId, orderId, link, actorId, settledNow)
  })
  // RETURNING the recipient alongside the id: each row is a DISTINCT
  // notification and must be pushed under its OWN id, not the first one's.
  const { rows } = await client.query(
    `INSERT INTO notifications ${cols} VALUES ${tuples.join(',')} RETURNING id, user_id`,
    values,
  )

  // Record the business event in the domain event log (one event per emit
  // call, not per recipient). This is the append-only event store that
  // future consumers (Slack, email digest, analytics) can replay from
  // without changing any notifyXxx caller. The INSERT runs in the same
  // transaction, so it commits iff the notifications commit.
  let eventId = null
  if (event?.type) {
    const ev = await appendDomainEvent(client, {
      eventType: event.type,
      aggregateId: event.aggregateId ?? projectId ?? orderId ?? null,
      actorId,
      payload: { type, title, body, tone, link, projectId, orderId },
    })
    eventId = ev?.id ?? null
  }

  // Deliver to registered devices as well as the in-app feed. Runs only
  // after the caller's transaction commits — see dispatchPush.
  const pushEntries = rows.map((r) => ({
    userId: r.user_id,
    notificationId: r.id,
    payload: { type, title, body, tone, link, projectId, notificationId: r.id },
  }))
  dispatchPush(client, pushEntries)

  // Signal connected SSE clients after commit. Each affected user gets a
  // lightweight signal so their bell can refetch the feed in real time
  // instead of waiting for the next 15s poll. The signal carries the
  // projectId/orderId so pages like ProjectDetail can decide whether to
  // refetch their own data — otherwise the bell updates but the page the
  // user is currently viewing stays stale until a manual refresh.
  if (eventId) {
    const signalEntries = rows.map((r) => ({
      userId: r.user_id,
      notificationId: r.id,
      eventId,
      projectId: projectId ?? null,
      orderId: orderId ?? null,
      type,
    }))
    dispatchSseSignal(client, signalEntries)
  }

  return clean.length
}

/**
 * Schedule web push for a just-inserted batch of notifications.
 *
 * Two properties this has to get right, and both are why it isn't just an
 * `await deliverBatch(...)` inline above:
 *
 *  1. It must not run inside the caller's transaction. `emit()` is called
 *     with the same client that wrote stage_history, mid-transaction. Awaiting
 *     an HTTPS round-trip to Apple/Google there would hold a Postgres
 *     transaction (and a pool connection) open for the duration — under
 *     concurrent teslim/onay traffic that exhausts the pool.
 *
 *  2. It must not push for a transaction that later rolls back. A push for an
 *     approval that never happened is worse than a missed one.
 *
 * `client.afterCommit` (see db/pool.js#withTx) satisfies both exactly: the
 * callback is queued now and invoked only once COMMIT succeeds, outside the
 * transaction.
 *
 * ⚠️ The obvious-looking alternative — `setImmediate` plus a "are the rows
 * visible yet?" probe — is WRONG and shipped broken once. `setImmediate`
 * fires on the next event-loop check phase, which arrives well before `fn`
 * resolves and COMMIT is issued, so the probe always found nothing and every
 * push for a real pipeline event was silently dropped. Only `/api/push/test`
 * worked, because it calls sendToUsers directly. Do not reintroduce timing
 * guesses here.
 *
 * When `emit` is called with a plain pool client (no transaction, e.g. from a
 * future non-transactional caller) there is nothing to wait for, so the send
 * is scheduled immediately.
 *
 * NOTE: "fire and forget" no longer means "and hope". The rows are written
 * with `pushed_at` NULL, so anything this hook fails to deliver — including
 * everything in flight when the container is stopped, which happens on every
 * deploy — is still owed and gets retried by `sweepPendingPushes`. See
 * migration 034.
 */
function dispatchPush(client, entries) {
  if (!isPushEnabled() || entries.length === 0) return
  const send = () => deliverBatch(entries)
  if (typeof client?.afterCommit === 'function') {
    client.afterCommit(send)
  } else {
    setImmediate(() => {
      Promise.resolve()
        .then(send)
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[notifications] push dispatch failed:', err?.message)
        })
    })
  }
}

/**
 * Signal SSE clients after the transaction commits.
 *
 * Same afterCommit pattern as dispatchPush: the signal must not fire for a
 * transaction that later rolls back (a push for an event that never happened
 * is worse than a missed one). Each entry is published to the in-process
 * event bus, which the SSE route subscribes to for real-time streaming.
 *
 * The signal is fire-and-forget — if the event bus has no subscribers (no
 * SSE connections open), the publish is a no-op. Nothing to retry because
 * the bell feed is the source of truth and SSE is just a latency optimiser.
 */
function dispatchSseSignal(client, entries) {
  if (entries.length === 0) return
  const publish = () => {
    for (const entry of entries) {
      publishNotificationEvent(entry)
    }
  }
  if (typeof client?.afterCommit === 'function') {
    client.afterCommit(publish)
  } else {
    setImmediate(publish)
  }
}

/* --------------------------- delivery bookkeeping ------------------------- */

/**
 * Push a batch of notification rows and record what happened to each.
 *
 * This is the half of the outbox pattern that closes the loop: `emit` writes
 * rows with `pushed_at` NULL ("owed"), this marks them settled once a device
 * has them. If the process dies before this runs — which is exactly what a
 * redeploy does to any request in flight — the rows stay owed and
 * `sweepPendingPushes` picks them up on the next boot. Before migration 034
 * that push was simply lost, invisibly, because the bell still showed the
 * notification.
 *
 * Three outcomes per row, and the distinction is the whole point:
 *   • at least one device reached      → settled
 *   • no live device for the recipient → settled (nothing to deliver, ever)
 *   • every attempt failed transiently → still owed; the sweeper retries
 *
 * Never throws — the caller is a detached afterCommit hook.
 */
export async function deliverBatch(entries) {
  if (!isPushEnabled() || !entries || entries.length === 0) {
    return { delivered: 0, settled: 0, retry: 0 }
  }
  const { delivered, settled, retry } = classifyDelivery(await sendToRecipients(entries))

  await markPushed(settled)
  await recordPushAttempt(retry)
  return { delivered, settled: settled.length, retry: retry.length }
}

/**
 * Turn per-notification send stats into "settle it" / "retry it" buckets.
 *
 * Pure and exported because this three-way rule is the subtle part of the
 * outbox and the easy thing to get backwards:
 *
 *   • sent > 0        → at least one of the recipient's devices has it. Done.
 *                       (Partial success is still success — retrying to reach
 *                       the second device would re-buzz the first.)
 *   • transient > 0   → a network error / 429 / 5xx. The push is still owed;
 *                       leave the row pending so the sweeper tries again.
 *   • neither         → the recipient has no live device, or every device
 *                       returned 404/410. Nothing will ever deliver this, so
 *                       settling it is correct — retrying forever is how the
 *                       pending index turns into a full-table scan.
 *
 * Note the ordering: `sent > 0` wins even when some other device of the same
 * user failed transiently. Delivered once is delivered.
 */
export function classifyDelivery(results) {
  const settled = []
  const retry = []
  let delivered = 0
  for (const [id, stat] of results ?? []) {
    delivered += stat?.sent ?? 0
    if ((stat?.sent ?? 0) > 0 || (stat?.transient ?? 0) === 0) settled.push(id)
    else retry.push(id)
  }
  return { delivered, settled, retry }
}

/** Stamp rows as delivered (or as having nothing to deliver). Best-effort. */
async function markPushed(ids) {
  if (ids.length === 0) return
  try {
    await getPool().query(
      'UPDATE notifications SET pushed_at = NOW() WHERE id = ANY($1) AND pushed_at IS NULL',
      [ids],
    )
  } catch (err) {
    // Not fatal: the row stays owed and the sweeper retries. At-least-once —
    // a duplicate push collapses under the payload tag, a lost one doesn't.
    // eslint-disable-next-line no-console
    console.error('[notifications] mark-pushed failed:', err?.message)
  }
}

/**
 * Count a failed attempt, and give up once the cap is reached — the CASE arm
 * settles the row so a device that is permanently unreachable (but never
 * returns a clean 404/410) can't hold a slot in the pending index forever.
 */
async function recordPushAttempt(ids) {
  if (ids.length === 0) return
  try {
    await getPool().query(
      `UPDATE notifications
          SET push_attempts = push_attempts + 1,
              pushed_at = CASE WHEN push_attempts + 1 >= $2 THEN NOW() ELSE NULL END
        WHERE id = ANY($1) AND pushed_at IS NULL`,
      [ids, PUSH_MAX_ATTEMPTS],
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifications] attempt bookkeeping failed:', err?.message)
  }
}

/**
 * Retry every push still owed. Called on a timer by the maintenance loop.
 *
 * `minAgeSeconds` keeps the sweeper off rows the in-process dispatch is still
 * working on — without it, a slow Apple round-trip would be duplicated by a
 * sweep firing underneath it. Ten seconds is comfortably longer than a normal
 * send and short enough that a redeploy-dropped push arrives while it still
 * matters.
 */
export async function sweepPendingPushes({ minAgeSeconds = 10, limit = 200 } = {}) {
  if (!isPushEnabled()) return { delivered: 0, settled: 0, retry: 0 }
  let rows
  try {
    ({ rows } = await getPool().query(
      `SELECT id, user_id, type, title, body, tone, link, project_id
         FROM notifications
        WHERE pushed_at IS NULL
          AND created_at < NOW() - make_interval(secs => $1::int)
        ORDER BY created_at
        LIMIT $2`,
      [minAgeSeconds, limit],
    ))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifications] sweep query failed:', err?.message)
    return { delivered: 0, settled: 0, retry: 0 }
  }
  if (rows.length === 0) return { delivered: 0, settled: 0, retry: 0 }

  return deliverBatch(rows.map((r) => ({
    userId: r.user_id,
    notificationId: r.id,
    payload: {
      type: r.type,
      title: r.title,
      body: r.body,
      tone: r.tone,
      link: r.link,
      projectId: r.project_id,
      notificationId: r.id,
    },
  })))
}

/* ------------------------------- queries --------------------------------- */

export const FEED_PAGE_SIZE = 50
export const FEED_MAX_PAGE_SIZE = 100

/**
 * Normalise a caller-supplied page size.
 *
 * Anything that isn't a positive number falls back to the DEFAULT, not to the
 * floor: clamping a bogus `limit=-10` to 1 would hand back a one-item feed and
 * look like a data bug rather than a bad request. Exported so the route can
 * derive `nextCursor` from the same number the query actually used — computing
 * it twice with different rules is how a "load more" button ends up either
 * skipping rows or looping on the last page forever.
 */
export function clampPageSize(limit) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n < 1) return FEED_PAGE_SIZE
  return Math.min(Math.trunc(n), FEED_MAX_PAGE_SIZE)
}
   
/**
 * One page of a user's feed, newest first.
 *
 * Keyset-paginated on `(created_at, id)` rather than OFFSET: the feed is
 * append-at-the-top, so an OFFSET page shifts under the reader every time a
 * new notification lands and they'd see duplicates while scrolling. The
 * compound cursor is required because `created_at` is not unique — a single
 * `emit` writes every recipient's row in one statement, and a user with two
 * rows sharing a timestamp would lose one at a page boundary under a
 * timestamp-only cursor.
 *
 * The tuple comparison `(created_at, id) < ($3, $4)` matches the
 * `(user_id, created_at DESC)` index directly, so paging stays an index scan.
 */
export async function listForUser(client, userId, { limit = FEED_PAGE_SIZE, cursor = null } = {}) {
  const size = clampPageSize(limit)
  const { rows } = await client.query(
    `SELECT id, type, title, body, tone, project_id, order_id, link,
            is_read, read_at, seen, seen_at, created_at
       FROM notifications
      WHERE user_id = $1
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::text))
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, size, cursor?.createdAt ?? null, cursor?.id ?? null],
  )
  return rows
}

/**
 * Real unread / unseen totals for the badge.
 *
 * These used to be derived by looping the 50-row page the feed had just
 * fetched, which silently capped both counts: a user with 60 unseen rows saw a
 * number computed from 50 of them, and there was no way to reach the rest. The
 * aggregate below scans only this user's rows via
 * `idx_notifications_user_created` and is exact regardless of page size.
 */
export async function countsForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE is_read = FALSE) AS unread,
            COUNT(*) FILTER (WHERE seen    = FALSE) AS unseen
       FROM notifications
      WHERE user_id = $1`,
    [userId],
  )
  return {
    // pg returns bigint aggregates as strings — Number() or the SPA compares
    // "0" > 0 and shows a badge on an empty feed.
    unread: Number(rows[0]?.unread ?? 0),
    unseen: Number(rows[0]?.unseen ?? 0),
  }
}

/**
 * Retention. Nothing deleted notification rows before this, so the table grew
 * monotonically: every pipeline transition fans out to 2–6 recipients, forever,
 * while the feed only ever renders the newest page.
 *
 * Two windows, because "old" means different things for done and not-done work:
 *   • readAfterDays — a notification the user has actioned is history. 30 days
 *     is long enough to answer "when did that book go to production?" from the
 *     feed rather than from stage_history, which is the real audit log.
 *   • maxAgeDays    — a hard ceiling that also catches rows nobody ever read,
 *     so an inactive account can't pin its backlog indefinitely.
 */
export async function pruneOldNotifications(
  client,
  { readAfterDays = 30, maxAgeDays = 90 } = {},
) {
  const { rowCount } = await client.query(
    `DELETE FROM notifications
      WHERE (is_read = TRUE AND created_at < NOW() - make_interval(days => $1::int))
         OR created_at < NOW() - make_interval(days => $2::int)`,
    [readAfterDays, maxAgeDays],
  )
  return rowCount
}

/**
 * Mark one notification read — scoped to the owner. Reading implies seeing,
 * so we set `seen` too (keeps the is_read ⇒ seen invariant).
 */
export async function markRead(client, userId, id) {
  const { rowCount } = await client.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = NOW(),
            seen = TRUE, seen_at = COALESCE(seen_at, NOW())
      WHERE id = $1 AND user_id = $2 AND is_read = FALSE`,
    [id, userId],
  )
  return rowCount > 0
}

/** Mark every row read (and therefore seen). Returns rows affected. */
export async function markAllRead(client, userId) {
  const { rowCount } = await client.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = NOW(),
            seen = TRUE, seen_at = COALESCE(seen_at, NOW())
      WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  )
  return rowCount
}

/**
 * Mark every unseen row seen — called when the user OPENS the bell. Clears
 * the badge WITHOUT touching is_read, so items stay bold/to-do until acted on.
 */
export async function markAllSeen(client, userId) {
  const { rowCount } = await client.query(
    `UPDATE notifications SET seen = TRUE, seen_at = NOW()
      WHERE user_id = $1 AND seen = FALSE`,
    [userId],
  )
  return rowCount
}



/* ----------------------------- Barrel re-exports --------------------------- */

/**
 * `services/orders-service.js`, `services/project-service.js`, every route
 * in `routes/`, etc. all do
 * `import { notifyXxx } from '../services/notifications.js'`.
 * Keep that import shape working by re-exporting the sibling concerns here.
 * Zero lines change in any caller.
 */
export * from './notifications-pipeline.js'
export * from './notifications-domains.js'
