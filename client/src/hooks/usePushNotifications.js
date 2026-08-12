import { useState, useEffect, useCallback, useRef } from 'react'
import api from '@/api'
import { useAuth } from '@/hooks/useAuth.js'

/**
 * Web push subscription lifecycle for the signed-in user.
 *
 * Push has a long, silent failure chain — platform support → app installed
 * (iOS only) → permission granted → service worker registered → subscription
 * stored server-side. This hook collapses that into ONE `status` string the
 * UI can render a single honest sentence from, instead of showing a toggle
 * that does nothing on a device that was never going to work.
 *
 *   'unsupported'    → browser has no Push API at all (desktop Safari < 16,
 *                      Firefox with push disabled, embedded webviews)
 *   'needs-install'  → iOS Safari in a normal tab. Push exists on iOS 16.4+
 *                      but ONLY inside a Home Screen app, so the fix is an
 *                      install, not a permission prompt.
 *   'disabled'       → server has no VAPID keys configured
 *   'denied'         → user (or a previous session) blocked notifications
 *   'default'        → supported and available, not yet subscribed
 *   'subscribed'     → active subscription stored on the server
 *
 * The iOS distinction matters more than it looks: prompting for notification
 * permission in an iOS tab throws rather than showing a dialog, and a denied
 * permission can only be undone in system settings. Getting the order right
 * (install first, then prompt) is the difference between the feature working
 * and being permanently unavailable for that user.
 */

const IOS_INSTALL_STEPS = [
  'Safari\'de alt taraftaki Paylaş düğmesine dokunun.',
  '"Ana Ekrana Ekle" seçeneğini seçin.',
  'Ekle\'ye dokunun, sonra uygulamayı ana ekrandan açın.',
  'Uygulama içinden bildirimleri tekrar açın.',
]

/** iOS/iPadOS detection, including iPadOS 13+ which reports itself as a Mac. */
function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** True when running as an installed PWA rather than a browser tab. */
function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator.standalone === true
}

/**
 * VAPID keys travel as base64url text but PushManager.subscribe demands a
 * Uint8Array. Browsers have no built-in base64url decoder, hence the manual
 * padding + character swap.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

export function usePushNotifications() {
  const { user } = useAuth()
  const [status, setStatus] = useState('default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const serverKeyRef = useRef('')

  const supported = typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  // Resolve the initial status. Runs on mount and whenever the user changes,
  // because a subscription belongs to a user — signing in as someone else on
  // a shared machine must re-point the device rather than inherit silently.
  useEffect(() => {
    let cancelled = false

    async function resolve() {
      if (!user) return
      // iOS in a tab: report the install requirement rather than 'unsupported',
      // so the UI can show the 4-step fix instead of a dead end.
      if (!supported) {
        if (!cancelled) setStatus(isIOS() && !isStandalone() ? 'needs-install' : 'unsupported')
        return
      }
      if (isIOS() && !isStandalone()) {
        if (!cancelled) setStatus('needs-install')
        return
      }

      try {
        const { enabled, key } = await api.getPushPublicKey()
        if (cancelled) return
        if (!enabled || !key) { setStatus('disabled'); return }
        serverKeyRef.current = key

        if (Notification.permission === 'denied') { setStatus('denied'); return }

        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        if (cancelled) return
        if (existing && Notification.permission === 'granted') {
          // Re-POST on every load. Cheap (single upsert on a UNIQUE endpoint)
          // and it self-heals the case where the browser silently rotated the
          // subscription, or the row was pruned after a transient 410.
          try { await api.savePushSubscription(existing.toJSON()) } catch { /* retried next load */ }
          if (!cancelled) setStatus('subscribed')
        } else if (!cancelled) {
          // Permission may already be 'granted' with no subscription — e.g.
          // the row was pruned, or the browser dropped the subscription on a
          // storage sweep. Still 'default': the user must click again, but
          // the click won't re-prompt, so it's a single silent step for them.
          setStatus('default')
        }
      } catch {
        if (!cancelled) setStatus('default')
      }
    }

    resolve()
    return () => { cancelled = true }
  }, [user, supported])

  /**
   * Subscribe. MUST be called from a user gesture (click) — browsers ignore
   * or penalise permission requests that aren't tied to one, and Safari
   * throws outright.
   */
  const subscribe = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      if (isIOS() && !isStandalone()) { setStatus('needs-install'); return false }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'default')
        return false
      }

      let key = serverKeyRef.current
      if (!key) {
        const res = await api.getPushPublicKey()
        if (!res.enabled || !res.key) { setStatus('disabled'); return false }
        key = res.key
        serverKeyRef.current = key
      }

      const reg = await navigator.serviceWorker.ready
      // Reuse an existing subscription when there is one: calling subscribe()
      // twice with the same key returns the same object, but with a DIFFERENT
      // key it throws InvalidStateError — which is exactly what happens after
      // a VAPID rotation. Unsubscribing first makes that recoverable.
      let sub = await reg.pushManager.getSubscription()
      if (sub) {
        const sameKey = sub.options?.applicationServerKey &&
          btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === key
        if (!sameKey) { await sub.unsubscribe(); sub = null }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          // Required to be true by every browser: push must always result in
          // a visible notification (see the sw.js `push` handler).
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        })
      }

      const ok = await api.savePushSubscription(sub.toJSON())
      setStatus(ok ? 'subscribed' : 'default')
      return ok
    } catch (err) {
      setError(err?.message ?? 'Bildirim aboneliği başarısız oldu.')
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  /** Unsubscribe this device. Clears both the browser and the server row. */
  const unsubscribe = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        // Server first: if the browser unsubscribe succeeds and the API call
        // then fails, the row is orphaned and the user keeps getting pushes
        // they can no longer turn off from this device.
        try { await api.deletePushSubscription(sub.endpoint) } catch { /* pruned on 410 */ }
        await sub.unsubscribe()
      }
      setStatus('default')
      return true
    } catch (err) {
      setError(err?.message ?? 'Abonelik kaldırılamadı.')
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const sendTest = useCallback(async () => {
    setError(null)
    try {
      return await api.sendTestPush()
    } catch (err) {
      setError(err?.message ?? 'Test bildirimi gönderilemedi.')
      return { sent: 0, pruned: 0 }
    }
  }, [])

  return {
    status,
    busy,
    error,
    subscribe,
    unsubscribe,
    sendTest,
    iosInstallSteps: IOS_INSTALL_STEPS,
    isSubscribed: status === 'subscribed',
    // Only these two states are actionable by a button.
    canSubscribe: status === 'default' || status === 'denied',
  }
}

export { isIOS, isStandalone, urlBase64ToUint8Array }
