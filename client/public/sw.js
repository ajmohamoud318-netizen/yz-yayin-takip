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
    // Round-trips the destination to notificationclick below.
    data: { url: data.url || '/', type: data.type || 'info' },
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
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification?.data?.url || '/'

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      // Same-origin tab already open → reuse it.
      if ('focus' in client) {
        await client.focus()
        // navigate() is unavailable in some browsers (and throws on iOS
        // Safari); postMessage lets the SPA route via React Router instead,
        // which also avoids a full page reload.
        if ('postMessage' in client) {
          client.postMessage({ type: 'notification-click', url: target })
        }
        return
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(target)
    }
  })())
})
