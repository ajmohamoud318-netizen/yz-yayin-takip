import { useCallback, useEffect, useRef } from 'react'

/**
 * Coalesces rapid-fire calls into one: `fn` runs `delayMs` after the LAST
 * call, not the first. Built for SSE-triggered refetches — a single pipeline
 * action can fan out more than one server-sent event to the same recipient
 * (see notifyDemoReceived/notifyOzalitReceived on the server, which each
 * call `emit()` twice), and each event independently calling `refetch()`
 * fires overlapping, redundant GET requests instead of one.
 *
 * `fn` is read from a ref on every invocation, so callers don't need to
 * memoize it — the returned function's identity only changes if `delayMs`
 * changes.
 */
export function useDebouncedCallback(fn, delayMs) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      fnRef.current(...args)
    }, delayMs)
  }, [delayMs])
}
