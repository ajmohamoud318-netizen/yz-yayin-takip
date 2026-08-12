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
 * Those rows are deleted immediately — keeping them means every future emit
 * pays for a guaranteed-failing HTTPS request per dead device, which is how
 * push fan-out quietly gets slow.
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
    // Collapse key: a newer push about the SAME project replaces the older
    // banner instead of stacking five notifications for one book.
    tag: projectId ? `project-${projectId}` : `notif-${notificationId ?? 'general'}`,
  })
}

/**
 * Fan a single notification out to every device of every recipient.
 *
 * Returns { sent, pruned }. Never throws — failures are counted, not raised.
 *
 * Sends run in parallel: a slow push service (Apple's is routinely slower
 * than FCM) shouldn't serialise behind the others when a book notifies five
 * people across a dozen devices.
 */
export async function sendToUsers(userIds, payloadArgs) {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 }
  const ids = [...new Set((userIds ?? []).filter(Boolean))]
  if (ids.length === 0) return { sent: 0, pruned: 0 }

  const pool = getPool()
  let subs
  try {
    subs = await loadSubscriptions(pool, ids)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[push] failed to load subscriptions:', err.message)
    return { sent: 0, pruned: 0 }
  }
  if (subs.length === 0) return { sent: 0, pruned: 0 }

  const payload = buildPayload(payloadArgs)
  const dead = []
  let sent = 0

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        // TTL: if the device is offline, the push service holds the message
        // this long before dropping it. 24h — a demo request that surfaces a
        // day late is still useful; a week late is just noise.
        { TTL: 86_400 },
      )
      sent += 1
    } catch (err) {
      // 404 Not Found / 410 Gone = subscription permanently dead. Anything
      // else (429, 500, network) is transient — leave the row alone so the
      // device keeps working once the push service recovers.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        dead.push(sub.id)
      } else {
        // eslint-disable-next-line no-console
        console.error(`[push] send failed (${err?.statusCode ?? 'network'}):`, err?.message)
      }
    }
  }))

  const pruned = await pruneSubscriptions(dead)
  await touchLastUsed(subs.filter((s) => !dead.includes(s.id)).map((s) => s.id))
  return { sent, pruned }
}

/** Delete permanently-dead subscriptions. Best-effort. */
export async function pruneSubscriptions(ids) {
  if (!ids || ids.length === 0) return 0
  try {
    const { rowCount } = await getPool().query(
      'DELETE FROM push_subscriptions WHERE id = ANY($1)',
      [ids],
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
