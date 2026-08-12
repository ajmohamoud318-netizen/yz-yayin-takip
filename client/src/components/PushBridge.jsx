import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '@/hooks/useNotifications'

/**
 * Invisible component that connects the service worker to the running SPA.
 *
 * Two jobs:
 *
 *  1. Route notification taps. sw.js focuses an existing tab and postMessages
 *     the target URL rather than calling client.navigate() — navigate() is
 *     unsupported on iOS Safari and forces a full reload where it does work.
 *     Handling it here means a tap does a normal React Router transition.
 *
 *  2. Refresh the feed on arrival. A push means something changed server-side;
 *     without this the bell badge would lag by up to a poll interval (15s)
 *     behind a notification the user just saw on their lock screen.
 *
 * Mounted once at the app root alongside NotificationSync. Renders nothing.
 */
export default function PushBridge() {
  const navigate = useNavigate()
  const { refetch } = useNotifications()

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined

    function onMessage(event) {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'notification-click' && typeof data.url === 'string') {
        // Same-origin paths only. The URL originates from our own push payload,
        // but treating it as untrusted costs nothing and stops a malformed or
        // injected absolute URL from turning a tap into an off-site redirect.
        const path = data.url.startsWith('/') ? data.url : '/'
        refetch()
        navigate(path)
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate, refetch])

  // A push that arrives while the tab is in the background should still be
  // reflected the moment the user comes back, without waiting for the timer.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refetch])

  return null
}
