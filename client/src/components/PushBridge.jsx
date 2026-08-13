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
 *         a full reload where it does work). Works when the SPA is already
 *         running with this listener attached.
 *       • IndexedDB handoff — sw.js also parks the target before focusing. An
 *         installed PWA on iOS ignores the URL passed to openWindow() and
 *         relaunches at start_url ('/'), so on a cold start the parked value is
 *         the only thing that knows where the tap was headed. Same for a
 *         backgrounded app whose listener wasn't attached yet when the message
 *         was posted — postMessage has no retry.
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
export default function PushBridge() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const { refetch, markRead } = useNotifications()
  // Guards the drain against React 18 StrictMode's double-mount, which would
  // otherwise run two overlapping IndexedDB transactions on boot.
  const draining = useRef(false)

  const go = useCallback((url, notificationId) => {
    if (typeof url !== 'string' || !url.startsWith('/')) return
    if (notificationId) markRead(notificationId)
    refetch()
    navigate(url)
  }, [markRead, navigate, refetch])

  /**
   * Drain the parked target.
   *
   * Gated on `isAuthenticated`: a deep link consumed while the session is still
   * bootstrapping would navigate into a guarded route, get bounced to /login,
   * and the target is gone — consumed, and unrecoverable. Waiting costs a few
   * hundred milliseconds on cold start and makes the link actually land.
   */
  const drain = useCallback(async () => {
    if (draining.current || !isAuthenticated) return
    draining.current = true
    try {
      const pending = await takePendingPushTarget()
      if (pending) go(pending.url, pending.notificationId)
    } finally {
      draining.current = false
    }
  }, [go, isAuthenticated])

  useEffect(() => { drain() }, [drain])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined

    function onMessage(event) {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'notification-click' && typeof data.url === 'string') {
        // Same-origin paths only. The URL originates from our own push payload,
        // but treating it as untrusted costs nothing and stops a malformed or
        // injected absolute URL from turning a tap into an off-site redirect.
        go(data.url.startsWith('/') ? data.url : '/', data.notificationId)
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [go])

  // A push that arrives while the tab is in the background should still be
  // reflected the moment the user comes back, without waiting for the timer —
  // and a tap that woke the app is drained here when the message path missed it.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      refetch()
      drain()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [drain, refetch])

  return null
}
