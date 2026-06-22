import { useEffect, useState } from 'react'
import Lottie from 'lottie-react'

/**
 * Full-screen overlay that plays a Lottie animation for a fixed duration.
 */
export default function CelebrationOverlay({ url, durationMs, onComplete }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        if (!cancelled) onComplete()
      })

    const timer = setTimeout(onComplete, durationMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url, durationMs, onComplete])

  if (!data) return null

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[300] flex items-center justify-center"
      aria-hidden
    >
      <div className="h-72 w-72 max-w-[min(80vw,18rem)] drop-shadow-lg">
        <Lottie animationData={data} loop={false} />
      </div>
    </div>
  )
}
