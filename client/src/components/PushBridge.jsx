import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuth } from '@/hooks/useAuth.js'
import { takePendingPushTarget } from '@/lib/push-target.js'

/**
 * Invisible component that connects the service worker to the running SPA.
 *
 * Three jobs:
 *
 *  1. Route notification taps, by TWO independent paths, because neither one
 *     covers every platform:
 *
 *       • postMessage — sw.js focuses an existing tab and posts the target
 *         rather than calling client.navigate() (unsupported on iOS Safari, and
 *         a full reload where it does work). Works when the SPA is running with
 *         this listener attached and the page is not suspended.
 *       • IndexedDB handoff — sw.js also parks the target before focusing.
 *
 *     Both funnel through `go()`, and the parked entry is deleted as it's read,
 *     so a tap that takes both paths still navigates exactly once.
 *
 *  2. Mark the tapped notification read. Acting on a push is acting on the
 *     item; leaving it bold in the bell afterwards makes the to-do queue lie.
 *
 *  3. Refresh the feed on arrival. A push means something changed server-side;
 *     without this the bell badge would lag by up to a poll interval (15s)
 *     behind a notification the user just saw on their lock screen.
 *
 * Mounted once at the app root alongside NotificationSync. Renders nothing.
 */

/**
 * When to re-check the parked target after the app comes to the foreground.
 *
 * A single check is NOT enough, and this is the bug that made the second tap
 * appear to do nothing while the first one worked. Cold start: the worker
 * parks the target long before React mounts, so one read finds it. Warm
 * resume: `notificationclick` (in the worker) and the page waking up are
 * concurrent, and on iOS the page frequently wins — it reads an empty store,
 * gives up, and the app just sits on whatever project the PREVIOUS tap opened.
 * The entry then lingers until the next resume, which is why the stale target
 * sometimes surfaced one launch late.
 *
 * Re-reading on a short decaying schedule closes the race without putting a
 * timing guess in the worker. Each attempt is one small IndexedDB read, the
 * schedule is abandoned the moment it hits, and the whole window is under two
 * seconds — shorter than it takes to read the screen you just landed on.
 */
const DRAIN_RETRY_MS = [0, 150, 400, 900, 1600]

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

export default function PushBridge() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const { refetch, markRead } = useNotifications()

  /**
   * Cancellation token for the retry schedule above.
   *
   * Bumped by every new drain and by the postMessage path. Without it, a user
   * who resumes the app, gets routed, and then taps something else themselves
   * would be yanked back by an in-flight attempt from the schedule that hadn't
   * finished yet — a navigation they didn't ask for, one second late.
   */
  const drainToken = useRef(0)

  const go = useCallback((url, notificationId) => {
    if (typeof url !== 'string' || !url.startsWith('/')) return
    if (notificationId) markRead(notificationId)
    refetch()
    navigate(url)
  }, [markRead, navigate, refetch])

  /**
   * Read the parked target, retrying briefly to cover the resume race.
   *
   * Gated on `isAuthenticated`: a deep link consumed while the session is still
   * bootstrapping would navigate into a guarded route, get bounced to /login,
   * and the target is gone — consumed, and unrecoverable. Waiting costs a few
   * hundred milliseconds on cold start and makes the link actually land.
   */
  const drain = useCallback(async () => {
    if (!isAuthenticated) return
    const token = drainToken.current + 1
    drainToken.current = token

    for (const delay of DRAIN_RETRY_MS) {
      if (delay) await sleep(delay)
      // Superseded (another drain started, or postMessage got there first).
      if (drainToken.current !== token) return
      const pending = await takePendingPushTarget()
      if (drainToken.current !== token) return
      if (pending) {
        go(pending.url, pending.notificationId)
        return
      }
    }
  }, [go, isAuthenticated])

  useEffect(() => { drain() }, [drain])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined

    function onMessage(event) {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type !== 'notification-click' || typeof data.url !== 'string') return

      // This path won the race: stop the retry schedule and clear the parked
      // copy of the same tap, so it can't re-fire a second later.
      drainToken.current += 1
      takePendingPushTarget().catch(() => {})

      // Same-origin paths only. The URL originates from our own push payload,
      // but treating it as untrusted costs nothing and stops a malformed or
      // injected absolute URL from turning a tap into an off-site redirect.
      go(data.url.startsWith('/') ? data.url : '/', data.notificationId)
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [go])

  /**
   * Every way the app can come back to the foreground.
   *
   * `visibilitychange` is the main one, but it does not fire on a bfcache
   * restore (that's `pageshow`), and an installed PWA resumed from the app
   * switcher sometimes only produces a window `focus`. A tap that resumes the
   * app must be routed on all three, or it silently lands on the old screen.
   * Overlapping calls are harmless — the token makes the last one win.
   */
  useEffect(() => {
    function onResume() {
      if (document.visibilityState === 'hidden') return
      drain()
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)
    window.addEventListener('focus', onResume)
    return () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [drain])

  // A push that arrived while the tab was in the background should be reflected
  // the moment the user comes back, without waiting for the 15s poll. Kept on
  // `visibilitychange` alone — the resume listeners above deliberately overlap
  // (focus fires alongside it on desktop), and one refetch per return is
  // enough. A tap that routes somewhere refetches via `go()` regardless.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refetch])

  return null
}
