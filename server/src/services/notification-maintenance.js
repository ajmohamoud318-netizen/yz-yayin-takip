/**
 * Background maintenance for the notification subsystem.
 *
 * Three jobs, all of which exist because something in this system was
 * previously assumed to happen and never actually did:
 *
 *  1. **Push retry.** `emit` dispatches web push from an `afterCommit` hook —
 *     correct for transactional safety, but in-process and therefore lost if
 *     the container dies in the window between COMMIT and the HTTPS send. That
 *     window is hit on every redeploy. Migration 034 made the owed set
 *     queryable (`pushed_at IS NULL`); this sweep drains it.
 *
 *  2. **Dead-device cleanup.** `push.js` marks subscriptions `failed_at` on a
 *     404/410 so they leave the fan-out immediately, and this deletes them once
 *     the grace window has passed.
 *
 *  3. **Retention.** Deletes actioned and very old notification rows so the
 *     table stops growing forever.
 *
 * Design constraints:
 *
 *  • Runs on a plain `setInterval`, `unref()`d so it never holds the process
 *    open during shutdown. No job queue, no Redis dependency — this is a
 *    single-container deployment (see DEPLOY.md) and a cron table would be
 *    more moving parts than the work justifies.
 *
 *  • Every tick is guarded by an `running` latch. A slow sweep (a push service
 *    having a bad minute) must not overlap itself and double-send.
 *
 *  • Nothing here ever throws out of the timer. An unhandled rejection in a
 *    background interval takes the whole server down under Node's default
 *    `--unhandled-rejections=throw`, which would turn a notification-cleanup
 *    hiccup into an outage of the actual application.
 *
 *  • **Multi-instance**: blue/green means two containers now run this
 *    continuously, not just briefly during a deploy overlap. Each tick is
 *    gated behind a Postgres advisory lock (`pg_try_advisory_lock`) so only
 *    whichever instance wins it actually does the work that tick — the
 *    other no-ops and tries again next interval.
 */

import { getPool } from '../db/pool.js'
import { sweepPendingPushes, pruneOldNotifications } from './notifications.js'
import { pruneFailedSubscriptions, isPushEnabled } from './push.js'

// Two-int advisory lock keys, namespaced away from migrate.js's
// MIGRATION_LOCK_KEY. Distinct keys per job so a slow sweep on one instance
// doesn't block the other instance's cleanup from running its own tick.
const SWEEP_LOCK_KEY = [872_190, 2]
const CLEANUP_LOCK_KEY = [872_190, 3]

/**
 * Run `fn` only if this process wins the named advisory lock; otherwise skip
 * (another instance already owns it, or is currently running it). The lock
 * is held on a dedicated connection for the duration of `fn` and always
 * released afterward.
 */
async function withAdvisoryLock(key, fn) {
  const client = await getPool().connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', key)
    if (!rows[0].acquired) return
    try {
      await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', key)
    }
  } finally {
    client.release()
  }
}

/** How often the push retry sweep runs. */
const SWEEP_MS = 30_000
/** How often the (much cheaper to skip) cleanup jobs run. */
const CLEANUP_MS = 6 * 60 * 60 * 1000

let sweepTimer = null
let cleanupTimer = null
let sweeping = false
let cleaning = false

async function runSweep() {
  if (sweeping) return
  sweeping = true
  try {
    await withAdvisoryLock(SWEEP_LOCK_KEY, async () => {
      const { delivered, settled, retry } = await sweepPendingPushes()
      if (delivered > 0 || retry > 0) {
        // Only log when there was actually something owed — a heartbeat every
        // 30s would bury real signal in the container logs.
        // eslint-disable-next-line no-console
        console.log(`[notifications] recovered push: ${delivered} sent, ${settled} settled, ${retry} pending`)
      }
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifications] sweep failed:', err?.message)
  } finally {
    sweeping = false
  }
}

async function runCleanup() {
  if (cleaning) return
  cleaning = true
  try {
    await withAdvisoryLock(CLEANUP_LOCK_KEY, async () => {
      const removed = await pruneOldNotifications(getPool())
      const devices = await pruneFailedSubscriptions()
      if (removed > 0 || devices > 0) {
        // eslint-disable-next-line no-console
        console.log(`[notifications] cleanup: ${removed} notifications, ${devices} dead devices removed`)
      }
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifications] cleanup failed:', err?.message)
  } finally {
    cleaning = false
  }
}

/**
 * Start the background loops. Idempotent — a second call is a no-op, so a test
 * that boots two servers doesn't end up with two sweeps racing each other.
 *
 * The push sweep is skipped entirely when VAPID isn't configured: with push
 * disabled `emit` settles rows at insert time, so there is nothing owed and
 * the query would be pure overhead. Cleanup still runs — retention applies
 * whether or not anything is being pushed.
 */
export function startNotificationMaintenance() {
  if (cleanupTimer) return false

  if (isPushEnabled()) {
    sweepTimer = setInterval(runSweep, SWEEP_MS)
    sweepTimer.unref?.()
    // One immediate pass: the most likely reason rows are owed at boot is the
    // deploy that just replaced the container mid-flight, and those pushes are
    // worth delivering now rather than at the end of the first interval.
    setTimeout(runSweep, 5_000).unref?.()
  }

  cleanupTimer = setInterval(runCleanup, CLEANUP_MS)
  cleanupTimer.unref?.()
  return true
}

/** Stop the loops. Used by graceful shutdown and by tests. */
export function stopNotificationMaintenance() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null }
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null }
}

export const __testing = { SWEEP_MS, CLEANUP_MS, runSweep, runCleanup }
