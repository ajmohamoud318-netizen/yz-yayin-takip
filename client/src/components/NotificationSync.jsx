import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuth } from '@/hooks/useAuth'

/**
 * Invisible component that fires an in-app toast whenever a NEW server
 * notification arrives for the current user.
 *
 * This used to diff the whole project list and re-derive events client-side.
 * Now it just watches the shared, server-backed feed (useNotifications) and
 * toasts any id it hasn't seen this session — so toasts always match the
 * durable bell feed exactly (no drift between the two). Mounted once at the
 * app root; renders nothing.
 */

const TONE_TO_TOAST = {
  rose: 'error',
  amber: 'info',
  blue: 'info',
  green: 'success',
  pink: 'success',
}

export default function NotificationSync() {
  const { items, loading } = useNotifications()
  const { user } = useAuth()
  const seenRef = useRef(null)
  // Tracks whether the initial feed has been recorded as the baseline.
  // Decoupled from `seenRef.current === null` because `items` starts as []
  // and is only populated AFTER the first /api/notifications fetch resolves
  // — without this gate, the priming step ran against an empty array on
  // first effect run, and the moment items actually arrived the filter
  // treated every unread row as fresh and replayed the entire backlog as a
  // burst of toasts on every page load. That bug was previously hidden
  // because <Toaster /> was never mounted, so the silent calls did nothing.
  const primedRef = useRef(false)

  // Sign-in / user-switch: the new account must start with no "seen"
  // baseline. Refs themselves survive the prop change, so we explicitly
  // reset here — otherwise the very first fetch for the new user would
  // prime against an empty array (the items=[] reset that
  // NotificationsProvider does on user change races with our effect) and
  // we'd be back to the same replay bug, just scoped to a user switch.
  const userId = user?.id ?? null
  useEffect(() => {
    seenRef.current = null
    primedRef.current = false
  }, [userId])

  useEffect(() => {
    // Wait until the initial fetch resolves before deciding what's "already
    // there". An inbox that legitimately starts empty still has to prime —
    // `!loading` makes priming happen exactly once per user regardless of
    // whether the initial list is empty or full.
    if (!primedRef.current && !loading) {
      seenRef.current = new Set(items.map((it) => it.id))
      primedRef.current = true
      return
    }
    if (!primedRef.current) return
    const seen = seenRef.current
    // Toast unseen, unread items oldest-first so they stack in arrival order.
    const fresh = items.filter((it) => !seen.has(it.id) && !it.is_read).reverse()
    for (const it of fresh) {
      const fn = toast[TONE_TO_TOAST[it.tone] ?? 'info'] ?? toast
      fn(it.body ? `${it.title}, ${it.body}` : it.title, { duration: 6000 })
    }
    for (const it of items) seen.add(it.id)
  }, [items, loading, userId])

  return null
}
