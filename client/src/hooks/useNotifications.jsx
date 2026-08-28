import {
  createContext, useContext, useState, useCallback, useEffect, useRef, createElement,
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
      setSseConnected(false)
    }
    if (!userId) return undefined

    // `userId` is only non-null once AuthProvider's GET /auth/me has resolved,
    // so reaching this line already means the session is good — no need to
    // also wait on the legacy localStorage token. That extra gate is what kept
    // the bell empty on cold start for sessions where "30 gün hatırla" was not
    // ticked (nothing is written to localStorage in that case).
    refetch()

    // Try SSE for real-time delivery. EventSource sends cookies automatically,
    // so this works in production with cookie sessions. In dev with header
    // auth, the SSE endpoint returns 401 and the error handler closes the
    // connection, so we fall back to polling.
    let eventSource = null
    if (typeof EventSource !== 'undefined') {
      eventSource = new EventSource('/api/events/stream', { withCredentials: true })
      eventSource.onopen = () => setSseConnected(true)
      eventSource.addEventListener('notification', () => {
        refetch()
      })
      eventSource.onerror = () => {
        setSseConnected(false)
        eventSource.close()
      }
    }

    // Polling fallback: only active when SSE is not connected. If SSE connects
    // successfully, we stop polling to save bandwidth and battery. If SSE
    // fails (dev with header auth, network issues), polling kicks in at 15s.
    const pollTimer = setInterval(() => {
      if (!sseConnected && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refetch()
      }
    }, POLL_MS)

    return () => {
      if (eventSource) eventSource.close()
      clearInterval(pollTimer)
    }
  }, [userId, refetch, sseConnected])

  const value = { items, unread, unseen, loading, refetch, markRead, markAllRead, markSeen }
  return createElement(NotificationsContext.Provider, { value }, children)
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider')
  return ctx
}
