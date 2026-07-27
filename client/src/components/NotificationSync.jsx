import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useNotifications } from '@/hooks/useNotifications'

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
  const { items } = useNotifications()
  const seenRef = useRef(null)

  useEffect(() => {
    // First delivery after mount/login: record what's already there without
    // toasting, so we don't replay the backlog as a burst of popups.
    if (seenRef.current === null) {
      seenRef.current = new Set(items.map((it) => it.id))
      return
    }
    const seen = seenRef.current
    // Toast unseen, unread items oldest-first so they stack in arrival order.
    const fresh = items.filter((it) => !seen.has(it.id) && !it.is_read).reverse()
    for (const it of fresh) {
      const fn = toast[TONE_TO_TOAST[it.tone] ?? 'info'] ?? toast
      fn(it.body ? `${it.title} — ${it.body}` : it.title, { duration: 6000 })
    }
    for (const it of items) seen.add(it.id)
  }, [items])

  return null
}
