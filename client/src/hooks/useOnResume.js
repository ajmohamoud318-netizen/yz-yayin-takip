import { useEffect, useRef } from 'react'

/**
 * Run `handler` every time the app comes back to the foreground.
 *
 * Why this exists: an installed PWA is not a tab. iOS suspends the whole page
 * when the app is backgrounded — timers stop, in-flight requests are dropped —
 * and resumes it minutes or hours later with the DOM exactly as it was. An app
 * whose only refresh path is `setInterval` therefore comes back showing
 * yesterday's pipeline (or the error card from the fetch that was killed
 * mid-flight) and stays that way until a tick happens to land. The team reads
 * that as "the app is broken, I have to close it and open it again".
 *
 * Three events, because no single one fires reliably:
 *   • `visibilitychange` — the main signal, but never fires on a bfcache restore
 *   • `pageshow`         — the bfcache restore, which `visibilitychange` misses
 *   • `focus`            — an installed PWA resumed from the app switcher
 *                          sometimes produces only this
 *
 * They overlap constantly (desktop fires focus alongside visibilitychange), so
 * calls are throttled: one resume must mean one refetch, not three.
 */
const RESUME_THROTTLE_MS = 1_000

export function useOnResume(handler) {
  // Kept in a ref so a caller passing an inline closure doesn't re-subscribe
  // on every render — the listeners attach once for the component's life.
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    let last = 0
    function onResume() {
      // `focus` and `pageshow` can both fire while the page is still hidden
      // (a background tab regaining focus in another window). Only a genuine
      // return to the foreground counts.
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - last < RESUME_THROTTLE_MS) return
      last = now
      handlerRef.current?.()
    }

    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)
    window.addEventListener('focus', onResume)
    return () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [])
}

export default useOnResume
