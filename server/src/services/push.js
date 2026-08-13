/**
 * Web Push service.
 *
 * Wraps the `web-push` package so the rest of the server never imports it
 * directly — the same containment `mail.js` applies to nodemailer.
 *
 * Behaviour mirrors mail.js deliberately:
 *   • If VAPID keys are configured, sends real pushes.
 *   • Otherwise the service disables itself (logs ONCE) and every send is a
 *     no-op. Local dev needs no keys; the bell feed still works because push
 *     is an ADDITIONAL delivery channel, never the source of truth.
 *   • Nothing here ever throws. A notification is already committed to
 *     Postgres by the time we try to deliver it; a push service outage must
 *     not turn into a 500 on a teslim or an approval.
 *
 * Why push at all, given the SPA already polls every 15s: polling only works
 * while a tab is open. The matbaa team is on the print floor. Push reaches a
 * closed app on both Android and iOS 16.4+ (once installed to Home Screen),
 * which is the entire point of this feature.
 *
 * Dead-subscription hygiene: push services return 404/410 when a subscription
 * is permanently gone (permission revoked, site data cleared, PWA deleted).
 * Those rows are stamped `failed_at` immediately, which takes them out of the
 * fan-out query (`loadSubscriptions` filters on it) — keeping them live means
 * every future emit pays for a guaranteed-failing HTTPS request per dead
 * device, which is how push fan-out quietly gets slow.
 *
 * They are DELETED later, by the maintenance sweep, after a grace period. The
 * two-phase approach is deliberate and is what migration 032's schema always
 * described: the grace window is the only way to answer "why did Oktay stop
 * getting pushes on his phone?" after the fact, and re-subscribing from that
 * device clears `failed_at` (see saveSubscription) so a device that comes back
 * inside the window is restored rather than re-registered.
 */

import webpush from 'web-push'
import { config } from '../config.js'
import { getPool } from '../db/pool.js'

let configured = null // null = not yet checked, true/false = resolved

/**
 * Lazily configure web-push. Returns false when VAPID keys are absent, in
 * which case every public function below becomes a no-op.
 */
function ensureConfigured() {
  if (configured !== null) return configured
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = config.push
  if (!vapidPublicKey || !vapidPrivateKey) {
    configured = false
    // eslint-disable-next-line no-console
    console.warn(
      '[push] VAPID keys not configured — web push disabled. ' +
      'Notifications will still appear in the in-app bell. ' +
      'Run `npx web-push generate-vapid-keys` and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable.',
    )
    return configured
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  configured = true
  return configured
}

/** True when VAPID is configured and pushes will actually be sent. */
export function isPushEnabled() {
  return ensureConfigured()
}

/** The public key the browser needs to create a subscription. '' when disabled. */
export function getVapidPublicKey() {
  return ensureConfigured() ? config.push.vapidPublicKey : ''
}

/**
 * Store (or refresh) a subscription for a user.
 *
 * Upserts on `endpoint` because the browser hands back the SAME endpoint when
 * an existing subscription is re-read on next page load. Without ON CONFLICT
 * every visit would insert a duplicate row and the user would get N copies of
 * every notification.
 *
 * Re-binds `user_id` on conflict so a shared device (two people using the same
 * browser profile) follows whoever signed in last, rather than silently
 * delivering one user's notifications to another. Also clears `failed_at`,
 * since a fresh subscribe means the device is alive again.
 */
export async function saveSubscription(client, { userId, subscription, userAgent = '' }) {
  const { endpoint, keys } = subscription ?? {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) return null
  const { rows } = await client.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           failed_at = NULL
     RETURNING id`,
    [userId, endpoint, keys.p256dh, keys.auth, String(userAgent).slice(0, 400)],
  )
  return rows[0]?.id ?? null
}

/**
 * Remove a subscription. Scoped to the owner so one user can't unsubscribe
 * another's device by guessing an endpoint.
 */
export async function deleteSubscription(client, { userId, endpoint }) {
  if (!endpoint) return 0
  const { rowCount } = await client.query(
    'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [userId, endpoint],
  )
  return rowCount
}

/** Every stored device for the given users. */
async function loadSubscriptions(client, userIds) {
  if (userIds.length === 0) return []
  const { rows } = await client.query(
    `SELECT id, user_id, endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE user_id = ANY($1) AND failed_at IS NULL`,
    [userIds],
  )
  return rows
}

/**
 * Build the payload the service worker receives.
 *
 * Kept deliberately small: push services cap payload size (~4KB) and, more
 * importantly, the notification body may sit in a lock-screen preview. We
 * send only what's needed to render and route.
 */
export function buildPayload({ type, title, body, tone, link, projectId, notificationId }) {
  return JSON.stringify({
    type: type ?? 'info',
    title: title || 'YZ Yayın Takip',
    body: body || '',
    tone: tone ?? 'blue',
    // Where notificationclick should navigate. Mirrors the bell's own
    // fallback (link → project detail → home) so tapping a push and clicking
    // the bell item land in exactly the same place.
    url: link || (projectId ? `/projects/${projectId}` : '/'),
    // Round-tripped so the tap can mark THIS row read. Must be the recipient's
    // own notification id — see sendToRecipients on why a shared id is a
    // cross-user bug waiting to happen.
    id: notificationId ?? null,
    // Collapse key: a newer push about the SAME project replaces the older
    // banner instead of stacking five notifications for one book.
    tag: projectId ? `project-${projectId}` : `notif-${notificationId ?? 'general'}`,
  })
}

/**
 * How many sends may be in flight at once.
 *
 * The previous `Promise.all` over every subscription was unbounded: one team
 * leader bulk-approving a shelf of books fans out to (recipients × devices ×
 * notifications) simultaneous HTTPS requests, all from a single Node process
 * that also has to serve the API. 12 keeps the tail latency of a fan-out flat
 * without letting a burst monopolise the event loop or the socket pool.
 */
const MAX_CONCURRENT_SENDS = 12

/** Run `worker` over `items`, at most `limit` at a time. Never rejects. */
async function mapWithConcurrency(items, limit, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      await worker(items[i])
    }
  })
  await Promise.all(runners)
}

/**
 * Deliver a batch of DISTINCT notifications, each to its own recipient's
 * devices.
 *
 *   entries: [{ userId, notificationId, payload }]
 *
 * This replaced a `sendToUsers(userIds, onePayload)` signature that could not
 * express what `emit()` actually produces. `emit` writes one row PER recipient
 * — five people notified about a book is five rows with five ids — but the old
 * call site collapsed them into a single payload carrying `rows[0].id`, so
 * four of the five recipients received a push stamped with a notification id
 * belonging to someone else's row. Harmless while nothing read the field back;
 * a silent cross-user data bug the moment anything did (marking a push read,
 * per-row delivery receipts, click attribution). Carrying the pairs through is
 * the only shape that can't drift.
 *
 * Returns Map<notificationId, { sent, transient, dead }> so the caller can
 * tell the three outcomes apart:
 *   • sent > 0                      → delivered, settle the row
 *   • all zero                      → recipient has no live device, settle it
 *   • transient > 0, sent === 0     → retryable, leave the row owed
 *
 * Never throws: a notification is already committed to Postgres by the time we
 * get here, and a push-service outage must not turn into a 500 on a teslim.
 */
export async function sendToRecipients(entries) {
  const list = (entries ?? []).filter((e) => e?.userId && e?.notificationId)
  const result = new Map(list.map((e) => [e.notificationId, { sent: 0, transient: 0, dead: 0 }]))
  if (!ensureConfigured() || list.length === 0) return result

  const byUser = new Map()
  for (const e of list) {
    if (!byUser.has(e.userId)) byUser.set(e.userId, [])
    byUser.get(e.userId).push(e)
  }

  let subs
  try {
    subs = await loadSubscriptions(getPool(), [...byUser.keys()])
  } catch (err) {
    // Treat a DB failure as transient for every entry — the sweeper retries.
    // eslint-disable-next-line no-console
    console.error('[push] failed to load subscriptions:', err.message)
    for (const stat of result.values()) stat.transient += 1
    return result
  }
  if (subs.length === 0) return result

  // One job per (device × notification owed to that device's user).
  const jobs = []
  for (const sub of subs) {
    for (const entry of byUser.get(sub.user_id) ?? []) jobs.push({ sub, entry })
  }

  const dead = new Set()
  const reached = new Set()

  await mapWithConcurrency(jobs, MAX_CONCURRENT_SENDS, async ({ sub, entry }) => {
    const stat = result.get(entry.notificationId)
    // Skip devices already known dead in this batch — no point spending
    // another guaranteed-404 round-trip per remaining notification.
    if (dead.has(sub.id)) { stat.dead += 1; return }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        buildPayload(entry.payload),
        // TTL: if the device is offline, the push service holds the message
        // this long before dropping it. 24h — a demo request that surfaces a
        // day late is still useful; a week late is just noise.
        { TTL: 86_400 },
      )
      stat.sent += 1
      reached.add(sub.id)
    } catch (err) {
      // 404 Not Found / 410 Gone = subscription permanently dead. Anything
      // else (429, 500, network) is transient — leave the row alone so the
      // device keeps working once the push service recovers, and let the
      // caller retry the notification.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        stat.dead += 1
        dead.add(sub.id)
      } else {
        stat.transient += 1
        // eslint-disable-next-line no-console
        console.error(`[push] send failed (${err?.statusCode ?? 'network'}):`, err?.message)
      }
    }
  })

  await markSubscriptionsFailed([...dead])
  await touchLastUsed([...reached])
  return result
}

/**
 * Fan ONE ad-hoc payload out to a set of users. Kept for callers that aren't
 * delivering a stored notification row — currently just POST /api/push/test.
 *
 * Returns { sent, pruned } for backwards compatibility with that route (and
 * the PushToggle UI that reads `sent` to prove delivery to the user).
 */
export async function sendToUsers(userIds, payloadArgs) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))]
  const results = await sendToRecipients(ids.map((userId, i) => ({
    userId,
    notificationId: `${payloadArgs?.notificationId ?? 'adhoc'}-${i}`,
    payload: payloadArgs,
  })))
  let sent = 0
  let pruned = 0
  for (const stat of results.values()) {
    sent += stat.sent
    pruned += stat.dead
  }
  return { sent, pruned }
}

/**
 * Take permanently-dead subscriptions out of the fan-out immediately.
 *
 * Marks rather than deletes, so `pruneFailedSubscriptions` can clear them
 * after a grace period — see this file's header for why the two phases exist.
 * `AND failed_at IS NULL` keeps the first failure timestamp, so the grace
 * window is measured from when the device actually died, not from the last
 * time something tried to reach it.
 */
export async function markSubscriptionsFailed(ids) {
  if (!ids || ids.length === 0) return 0
  try {
    const { rowCount } = await getPool().query(
      'UPDATE push_subscriptions SET failed_at = NOW() WHERE id = ANY($1) AND failed_at IS NULL',
      [ids],
    )
    return rowCount
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[push] mark-failed failed:', err.message)
    return 0
  }
}

/**
 * Delete subscriptions that have been dead longer than the grace period.
 * Called from the maintenance sweep. Best-effort.
 */
export async function pruneFailedSubscriptions({ graceHours = 72 } = {}) {
  try {
    const { rowCount } = await getPool().query(
      `DELETE FROM push_subscriptions
        WHERE failed_at IS NOT NULL
          AND failed_at < NOW() - make_interval(hours => $1::int)`,
      [graceHours],
    )
    return rowCount
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[push] prune failed:', err.message)
    return 0
  }
}

/** Bump last_used_at for successfully-reached devices. Best-effort, non-blocking. */
async function touchLastUsed(ids) {
  if (!ids || ids.length === 0) return
  try {
    await getPool().query(
      'UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = ANY($1)',
      [ids],
    )
  } catch {
    /* diagnostics only — never worth surfacing */
  }
}

/** Test seam: reset the memoised VAPID check between unit tests. */
export function __resetPushConfigForTests() {
  configured = null
}

/**
 * Test seam for the internals worth locking down without a live push service.
 * `mapWithConcurrency` in particular: an off-by-one in its cursor silently
 * drops sends, which is invisible in production (nobody reports the push they
 * never got).
 */
export const __testing = { mapWithConcurrency, MAX_CONCURRENT_SENDS }
