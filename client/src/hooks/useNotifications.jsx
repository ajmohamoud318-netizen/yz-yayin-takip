import {
  createContext, useContext, useState, useCallback, useEffect, useRef,
  createElement, useMemo,
} from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'

/**
 * Server-backed notification feed, shared app-wide.
 *
 * Uses SSE (Server-Sent Events) for real-time delivery when cookie sessions
 * are available (production). Falls back to 15s polling for dev environments
 * with header auth (EventSource can't send custom headers).
 *
 * The SSE signal is minimal ({ userId, notificationId, eventId }) — the client
 * uses it to decide whether to refetch the feed, not as the notification data
 * itself. The feed query remains the single source of truth.
 */

const NotificationsContext = createContext(null)

const POLL_MS = 15_000

export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)   // per-item to-do (is_read=false)
  const [unseen, setUnseen] = useState(0)   // bell badge (seen=false)
  const [loading, setLoading] = useState(true)
  const [sseConnected, setSseConnected] = useState(false)
  // Mirror of sseConnected for use INSIDE the polling callback without
  // re-running the SSE effect when the value flips. The pre-fix version
  // included `sseConnected` in the effect's dependency array, so any error
  // (including the dev/header-auth 401 that fires once on every retry)
  // re-created the EventSource, which errored again — a recreate loop that
  // only stopped when the user navigated away.
  const sseConnectedRef = useRef(false)

  const refetch = useCallback(async () => {
    try {
      const { items: next, unread: nr, unseen: ns } = await api.listNotifications()
      setItems(next)
      setUnread(nr)
      setUnseen(ns)
    } catch {
      /* transient — next tick retries */
    } finally {
      setLoading(false)
    }
  }, [])

  const markRead = useCallback(async (id) => {
    // Reading implies seeing → flip both locally, then persist.
    setItems((prev) => {
      let wasUnread = false
      let wasUnseen = false
      const next = prev.map((it) => {
        if (it.id !== id) return it
        wasUnread = !it.is_read
        wasUnseen = !it.seen
        return { ...it, is_read: true, seen: true }
      })
      if (wasUnread) setUnread((u) => Math.max(0, u - 1))
      if (wasUnseen) setUnseen((u) => Math.max(0, u - 1))
      return next
    })
    try { await api.markNotificationRead(id) } catch { /* reconciled on next poll */ }
  }, [])

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((it) => ({ ...it, is_read: true, seen: true })))
    setUnread(0)
    setUnseen(0)
    try { await api.markAllNotificationsRead() } catch { /* reconciled on next poll */ }
  }, [])

  // Bell opened → clear the badge (seen) but keep per-item bold (is_read).
  const markSeen = useCallback(async () => {
    let hadUnseen = false
    setItems((prev) => {
      hadUnseen = prev.some((it) => !it.seen)
      return hadUnseen ? prev.map((it) => (it.seen ? it : { ...it, seen: true })) : prev
    })
    setUnseen(0)
    if (hadUnseen) {
      try { await api.markNotificationsSeen() } catch { /* reconciled on next poll */ }
    }
  }, [])

  // In-process pub/sub so other components (ProjectDetail, Orders, etc.) can
  // subscribe to notification events and refetch their own data when a relevant
  // event arrives. The signal carries projectId/orderId so subscribers can
  // filter by what they care about without parsing every event.
  //
  // Subscribers receive the full event payload: { userId, notificationId,
  // eventId, projectId, orderId, type }. They should be idempotent — the same
  // event may fire multiple times during a reconnect.
  const subscribersRef = useRef(new Set())
  const subscribe = useCallback((callback) => {
    subscribersRef.current.add(callback)
    return () => subscribersRef.current.delete(callback)
  }, [])

  const dispatchToSubscribers = useCallback((event) => {
    for (const cb of subscribersRef.current) {
      try { cb(event) } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[notifications] subscriber threw:', err)
      }
    }
  }, [])

  // Reset + refetch whenever the signed-in user changes (login / switch /
  // logout). Keyed on user id so a different account never sees stale rows.
  const userId = user?.id ?? null
  const lastUserRef = useRef(null)
  useEffect(() => {
    if (lastUserRef.current !== userId) {
      lastUserRef.current = userId
      setItems([])
      setUnread(0)
      setUnseen(0)
      setLoading(!!userId)
      sseConnectedRef.current = false
      setSseConnected(false)
    }
    if (!userId) return undefined

    // `userId` is only non-null once AuthProvider's GET /auth/me has resolved,
    // so reaching this line already means the session is good — no need to
    // also wait on the legacy localStorage token. That extra gate is what kept
    // the bell empty on cold start for sessions where "30 gün hatırla" was not
    // ticked (nothing is written to localStorage in that case).
    refetch()

    // (Re-)opens the SSE stream. Called once on mount and again when the
    // tab returns to the foreground with the socket in a non-OPEN state
    // (e.g. intermediaries timed out the idle connection while the tab
    // was backgrounded). Kept as a small helper so both call sites share
    // the same wiring.
    const openEventSource = () => {
      if (typeof EventSource === 'undefined') return null
      const es = new EventSource('/api/events/stream', { withCredentials: true })
      es.onopen = () => {
        sseConnectedRef.current = true
        setSseConnected(true)
      }
      es.addEventListener('notification', (ev) => {
        // The server's signal carries { userId, notificationId, eventId,
        // projectId, orderId, type }. Forward to the notification feed refetch
        // AND to any subscribers (e.g. ProjectDetail listening for events on
        // its projectId).
        try {
          const event = JSON.parse(ev.data)
          dispatchToSubscribers(event)
        } catch {
          // Malformed event — still refetch (the feed may have changed) but
          // skip subscriber dispatch.
        }
        refetch()
      })
      es.onerror = () => {
        // Native EventSource already auto-reconnects on transient network
        // failures (radio blip, proxy hiccup). The previous code closed
        // the socket on ANY error — including the dev/header-auth 401 —
        // and because `sseConnected` was a dep, every close triggered a
        // re-run of this effect, which built a fresh EventSource, which
        // errored again, forever. Leave the native reconnect alone and
        // only mark the state as down. The visibility handler below
        // decides when an explicit recreation is actually warranted.
        sseConnectedRef.current = false
        setSseConnected(false)
      }
      return es
    }

    let eventSource = openEventSource()

    // Polling fallback: only active when SSE is not connected. If SSE connects
    // successfully, we stop polling to save bandwidth and battery. If SSE
    // fails (dev with header auth, network issues), polling kicks in at 15s.
    // Reads sseConnectedRef rather than the state value so the polling
    // schedule doesn't re-subscribe every time the SSE blips.
    const pollTimer = setInterval(() => {
      if (!sseConnectedRef.current && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refetch()
      }
    }, POLL_MS)

    // Resume-while-backgrounded reconnection. Backgrounding the tab drops
    // idle SSE connections at intermediaries (proxies, mobile carriers);
    // on return the native EventSource may not have reconnected yet, and
    // the 15s polling tick is a noticeable delay. If the socket isn't
    // healthy when the page comes back, tear it down and open a fresh
    // one so the real-time signal resumes within a second instead of
    // waiting for the poll.
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible') return
      if (eventSource && eventSource.readyState === EventSource.OPEN) return
      if (eventSource) eventSource.close()
      eventSource = openEventSource()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (eventSource) eventSource.close()
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [userId, refetch, dispatchToSubscribers])

  const value = useMemo(() => ({
    items, unread, unseen, loading, refetch, markRead, markAllRead, markSeen, subscribe,
  }), [items, unread, unseen, loading, refetch, markRead, markAllRead, markSeen, subscribe])
  return createElement(NotificationsContext.Provider, { value }, children)
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider')
  return ctx
}
