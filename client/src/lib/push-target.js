/**
 * Reader half of the push-tap handoff written by `client/public/sw.js`.
 *
 * Why this exists: tapping a push is supposed to open the screen the push is
 * about. `clients.openWindow('/baski-listesi')` does that on Android and on
 * desktop Chrome — but an installed PWA on iOS ignores the URL entirely and
 * relaunches at the manifest `start_url` (`/`). So the user got the dashboard
 * instead of the book they'd just been told about, which is indistinguishable
 * from "the link is broken".
 *
 * A service worker can't touch localStorage, so the target is parked in
 * IndexedDB by the worker and drained here on app start. The DB name, store and
 * key MUST match sw.js — the two files are one contract split across a build
 * boundary (sw.js ships as a static file with its own cache lifetime, so treat
 * a change here as a change to a published wire format).
 */

const HANDOFF_DB = 'yz-push'
const HANDOFF_STORE = 'handoff'
const HANDOFF_KEY = 'pending'

/**
 * How long a parked target stays valid.
 *
 * A tap that never reached the app (browser killed mid-launch, user swiped the
 * launch away) leaves an entry behind. Without an expiry it would hijack the
 * next unrelated app open — days later, silently — which is a far more
 * confusing bug than the one this fixes. Two minutes comfortably covers a cold
 * PWA boot on a slow phone and nothing else.
 */
export const MAX_AGE_MS = 2 * 60 * 1000

/**
 * Is a parked entry safe to act on? Split out from the IndexedDB plumbing
 * because these are the actual rules — the storage around them is a few lines
 * of boilerplate, and jsdom has no IndexedDB to exercise it against.
 *
 * Returns the normalised target, or `null` to drop the entry.
 */
export function readTarget(entry, now = Date.now()) {
  if (!entry || typeof entry !== 'object') return null
  if (!Number.isFinite(entry.at) || now - entry.at > MAX_AGE_MS) return null
  // A clock that jumped backwards (or an entry written by a device whose time
  // is ahead) would otherwise look infinitely fresh. Treat the future as stale.
  if (entry.at > now + MAX_AGE_MS) return null
  // Same-origin paths only. The value came from our own push payload, but it
  // has round-tripped through storage — validating costs nothing and keeps a
  // tampered entry from turning an app launch into an off-site redirect.
  // `//evil.com` is protocol-relative and passes a naive startsWith('/').
  if (typeof entry.url !== 'string') return null
  if (!entry.url.startsWith('/') || entry.url.startsWith('//')) return null
  return { url: entry.url, notificationId: entry.notificationId ?? null }
}

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
    // Another tab holding an old version open would otherwise hang forever.
    req.onblocked = () => reject(new Error('blocked'))
  })
}

/**
 * Read AND clear the parked target in one go.
 *
 * Deleting on read is deliberate and is what makes the double-delivery safe:
 * sw.js both postMessages the open tab and parks the target, because neither
 * path is reliable on its own. Whichever arrives first consumes the entry; the
 * other finds nothing and does nothing. A read-only peek would navigate twice.
 *
 * Returns `null` — never throws — when there's nothing pending, the entry is
 * stale, or IndexedDB is unavailable (private mode, storage denied). Losing the
 * deep link is a degradation, not an error worth surfacing.
 */
export async function takePendingPushTarget() {
  if (typeof indexedDB === 'undefined') return null
  let db = null
  try {
    db = await openHandoffDb()
    const entry = await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDOFF_STORE, 'readwrite')
      const store = tx.objectStore(HANDOFF_STORE)
      const get = store.get(HANDOFF_KEY)
      store.delete(HANDOFF_KEY)
      tx.oncomplete = () => resolve(get.result ?? null)
      tx.onerror = () => reject(tx.error)
    })
    return readTarget(entry)
  } catch {
    return null
  } finally {
    try { db?.close() } catch { /* already gone */ }
  }
}
