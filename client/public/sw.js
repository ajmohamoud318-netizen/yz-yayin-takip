/* eslint-disable no-restricted-globals */
/**
 * Service worker — web push delivery only.
 *
 * Deliberately NOT an offline cache. Caching a live pipeline dashboard would
 * show stale project stages to a printer standing at a machine, which is worse
 * than showing nothing. The only job here is to receive pushes while the SPA
 * is closed and route the tap back into the app.
 *
 * Lifecycle: skipWaiting + clients.claim so a deployed update takes over
 * immediately rather than waiting for every tab to close. Safe precisely
 * because there's no cache to invalidate.
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/* ------------------------- cold-start click handoff ----------------------- */

/**
 * Where a tap wants to go, parked so a COLD launch can pick it up.
 *
 * `clients.openWindow('/baski-listesi')` is supposed to launch the app on that
 * route. In an installed PWA on iOS it does not: WebKit ignores the URL and
 * relaunches the app at the manifest `start_url`, which is `/`. Android behaves,
 * but the same thing happens anywhere `matchAll` comes back empty while the app
 * is actually still alive in the background.
 *
 * The result was the bug this exists to fix: the push arrives, you tap it, and
 * you land on the dashboard instead of the book you were told about.
 *
 * A service worker has no localStorage, so the handoff goes through IndexedDB —
 * written here, drained by PushBridge on mount. Keep DB/store/key in sync with
 * client/src/lib/push-target.js; they are two halves of one contract.
 */
const HANDOFF_DB = 'yz-push'
const HANDOFF_STORE = 'handoff'
const HANDOFF_KEY = 'pending'

function openHandoffDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDOFF_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(HANDOFF_STORE)) {
        req.result.createObjectStore(HANDOFF_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Park the tap target. Never rejects: a failed handoff costs the deep link,
 * which is exactly what we have today — it must not also swallow the focus /
 * openWindow call that follows it.
 */
async function parkTarget(target) {
  try {
    const db = await openHandoffDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDOFF_STORE, 'readwrite')
      // `at` lets the reader ignore a stale target — without it, a tap that
      // never reached the app would hijack the next unrelated cold start.
      tx.objectStore(HANDOFF_STORE).put({ ...target, at: Date.now() }, HANDOFF_KEY)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* deep link degrades to start_url — the notification still opened the app */
  }
}

/**
 * Push received.
 *
 * `showNotification` is MANDATORY here, on every push, even if the payload is
 * unreadable: browsers permanently revoke push permission from origins that
 * receive a push and display nothing ("silent push"). So the catch path still
 * shows a generic notification rather than returning early.
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || 'YZ Yayın Takip'
  const options = {
    body: data.body || 'Yeni bir bildiriminiz var.',
    icon: '/icons/icon-192.png?v=2',
    badge: '/icons/icon-192.png?v=2',
    // Collapse: a second push about the same project replaces the first
    // instead of stacking. Without renotify:true the replacement would be
    // silent, so the device still buzzes for genuinely new information.
    tag: data.tag || 'yz-notification',
    renotify: true,
    // The pipeline is the user's actual job — these are not marketing pings,
    // so they should make a sound and appear on the lock screen.
    silent: false,
    // Round-trips the destination to notificationclick below. `id` rides along
    // so the tap can mark that exact row read instead of leaving it bold in the
    // bell after the user has clearly acted on it.
    data: { url: data.url || '/', type: data.type || 'info', id: data.id ?? null },
    timestamp: Date.now(),
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

/**
 * Notification tapped.
 *
 * Prefer FOCUSING an already-open tab over opening a new one — the team keeps
 * the dashboard open all day, and spawning a duplicate tab per notification is
 * how you end up with fifteen. Navigate the focused client to the target route
 * so the tap still lands on the right project.
 *
 * The target is parked in IndexedDB FIRST, before any focus/open call, and on
 * every path — including the warm one. Rationale:
 *
 *  • Cold launch: `openWindow(target)` is ignored by iOS PWAs (relaunches at
 *    start_url), so the parked value is the only thing that carries the route.
 *  • Warm focus: `postMessage` reaches the page only if PushBridge's listener
 *    is already attached. Right after a background wake it may not be, and the
 *    message is dropped with no retry. PushBridge drains the parked target on
 *    mount and on visibilitychange, so the tap lands either way.
 *
 * Whichever route runs first wins; the reader deletes the entry as it consumes
 * it, so the second is a no-op rather than a double navigation.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification?.data || {}
  const target = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/'
  const notificationId = data.id ?? null

  event.waitUntil((async () => {
    await parkTarget({ url: target, notificationId })

    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      // Same-origin tab already open → reuse it.
      if ('focus' in client) {
        try {
          await client.focus()
        } catch {
          // Focus can reject (backgrounded PWA on iOS). Keep going: the tab
          // still gets the message, and the parked target covers the rest.
        }
        // navigate() is unavailable in some browsers (and throws on iOS
        // Safari); postMessage lets the SPA route via React Router instead,
        // which also avoids a full page reload.
        if ('postMessage' in client) {
          client.postMessage({ type: 'notification-click', url: target, notificationId })
        }
        return
      }
    }
    if (self.clients.openWindow) {
      // Absolute URL: openWindow is specified against the SW scope, but a bare
      // path is resolved differently across engines. Pinning the origin removes
      // the ambiguity — and on the engines that honour it, this alone lands the
      // user on the right screen without the handoff.
      await self.clients.openWindow(new URL(target, self.location.origin).href)
    }
  })())
})
