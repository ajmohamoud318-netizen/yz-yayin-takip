import { useCallback, useEffect, useState } from 'react'
import { isIOS, isStandalone } from '@/hooks/usePushNotifications.js'

/**
 * Home-Screen install state for the running app.
 *
 * The awkward part of the install API is timing: Chrome fires
 * `beforeinstallprompt` once, very early — usually before React has mounted —
 * and the event is only usable if you called preventDefault() on it. Miss it
 * and there is no way to ask for it again this page load. So the event is
 * captured at boot into module scope by `initPwaInstall()` (called from
 * main.jsx) and components read it from here afterwards.
 *
 *   'installed'    → already running from the Home Screen / app window
 *   'available'    → Chrome/Edge/Android handed us a real install prompt
 *   'ios'          → iOS Safari tab: installable, but only via the Share
 *                    sheet. There is no programmatic prompt on iOS.
 *   'unavailable'  → desktop Firefox, in-app webviews, already-dismissed
 *                    prompts — nothing to offer.
 *
 * The prompt is single-use: once `prompt()` has been called the event is
 * spent, so it's cleared immediately rather than left around to throw
 * InvalidStateError on a second click.
 */

let deferredPrompt = null
let installedThisSession = false
const listeners = new Set()

function emit() {
  listeners.forEach((fn) => fn())
}

/** Call once at boot, before React mounts. Safe to call twice. */
export function initPwaInstall() {
  if (typeof window === 'undefined' || window.__yzPwaInstallInit) return
  window.__yzPwaInstallInit = true

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without preventDefault() the browser may show its own mini-infobar and
    // the event becomes unusable for a custom UI.
    event.preventDefault()
    deferredPrompt = event
    emit()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installedThisSession = true
    emit()
  })
}

export function usePwaInstall() {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1)
    listeners.add(onChange)

    // display-mode flips without a reload when the user launches the installed
    // app from an already-open tab on some Android builds.
    const mq = window.matchMedia?.('(display-mode: standalone)')
    mq?.addEventListener?.('change', onChange)

    return () => {
      listeners.delete(onChange)
      mq?.removeEventListener?.('change', onChange)
    }
  }, [])

  const standalone = installedThisSession || isStandalone()

  let mode = 'unavailable'
  if (standalone) mode = 'installed'
  else if (deferredPrompt) mode = 'available'
  else if (isIOS()) mode = 'ios'

  /**
   * Fire the native install dialog. Must be called from a user gesture.
   * Resolves to 'accepted' | 'dismissed' | 'unavailable'.
   */
  const promptInstall = useCallback(async () => {
    const event = deferredPrompt
    if (!event) return 'unavailable'
    deferredPrompt = null // spent — a second prompt() on the same event throws
    emit()
    try {
      await event.prompt()
      const choice = await event.userChoice
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed'
    } catch {
      return 'dismissed'
    }
  }, [version])

  return { mode, promptInstall, canInstall: mode === 'available' || mode === 'ios' }
}
