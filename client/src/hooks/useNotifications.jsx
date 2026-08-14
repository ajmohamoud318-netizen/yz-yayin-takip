import {
  createContext, useContext, useState, useCallback, useEffect, useRef, createElement,
} from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'

/**
 * Server-backed notification feed, shared app-wide.
 *
 * Replaces the old localStorage-derived bell log + project-diffing toasts.
 * The server owns the notifications (durable, cross-device, real read-state);
 * this provider polls the feed and exposes it to the bell AND the toast
 * watcher so there's exactly one poll loop and one source of truth.
 *
 * Polling (not push) is deliberate: the app authenticates with a trusted
 * `X-User-Id` header, which EventSource/WebSocket can't attach cleanly, and
 * the rest of the app already polls (projects at 30s). We poll a touch faster
 * (15s) so notifications feel timely.
 */

const NotificationsContext = createContext(null)

const POLL_MS = 15_000

export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)   // per-item to-do (is_read=false)
  const [unseen, setUnseen] = useState(0)   // bell badge (seen=false)
  const [loading, setLoading] = useState(true)

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
    }
    if (!userId) return undefined

    // `userId` is only non-null once AuthProvider's GET /auth/me has resolved,
    // so reaching this line already means the session is good — no need to
    // also wait on the legacy localStorage token. That extra gate is what kept
    // the bell empty on cold start for sessions where "30 gün hatırla" was not
    // ticked (nothing is written to localStorage in that case).
    refetch()
    // Don't poll a backgrounded app. iOS freezes the timer regardless, and
    // PushBridge refetches on every return to the foreground — so the only
    // thing these ticks would achieve is spending battery and data on a feed
    // nobody can see. A push that arrives meanwhile still shows as a system
    // notification, which is the point of the worker.
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      refetch()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [userId, refetch])

  const value = { items, unread, unseen, loading, refetch, markRead, markAllRead, markSeen }
  return createElement(NotificationsContext.Provider, { value }, children)
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider')
  return ctx
}
