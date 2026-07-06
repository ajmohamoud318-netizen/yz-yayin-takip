import { useEffect, useMemo, useState } from 'react'
import Lottie from 'lottie-react'

const CONFETTI_COLORS = [
  '#f97316', // orange
  '#a855f7', // purple
  '#22c55e', // green
  '#3b82f6', // blue
  '#ec4899', // pink
  '#eab308', // yellow
]

/**
 * Full-screen celebration: dimmed backdrop fades in, a confetti burst rains
 * down, and the Lottie animation scales up big in the center, then everything
 * gracefully fades out.
 */
export default function CelebrationOverlay({ url, durationMs, onComplete }) {
  const [data, setData] = useState(null)
  const [phase, setPhase] = useState('enter') // 'enter' -> 'leave'

  // Pre-compute confetti pieces once.
  const confetti = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.4 + Math.random() * 1.6,
        size: 6 + Math.random() * 8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: Math.random() * 360,
        drift: (Math.random() - 0.5) * 160,
        round: Math.random() > 0.6,
      })),
    [],
  )

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

    // Start fading out shortly before the end for a smooth exit.
    const fadeMs = 600
    const leaveTimer = setTimeout(
      () => setPhase('leave'),
      Math.max(0, durationMs - fadeMs),
    )
    const doneTimer = setTimeout(onComplete, durationMs)

    return () => {
      cancelled = true
      clearTimeout(leaveTimer)
      clearTimeout(doneTimer)
    }
  }, [url, durationMs, onComplete])

  if (!data) return null

  const leaving = phase === 'leave'

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[300] flex items-center justify-center overflow-hidden"
      aria-hidden
      style={{
        opacity: leaving ? 0 : 1,
        transition: 'opacity 600ms ease',
      }}
    >
      <style>{`
        @keyframes yzCelebBackdrop {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes yzCelebPop {
          0%   { opacity: 0; transform: scale(0.6); }
          60%  { opacity: 1; transform: scale(1.06); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes yzCelebFall {
          0%   { opacity: 0; transform: translate3d(0, -10vh, 0) rotate(0deg); }
          10%  { opacity: 1; }
          100% { opacity: 1; transform: translate3d(var(--drift, 0), 110vh, 0) rotate(720deg); }
        }
      `}</style>

      {/* Dimmed, softly-blurred backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, rgba(15,23,42,0.45) 0%, rgba(15,23,42,0.7) 100%)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          animation: 'yzCelebBackdrop 400ms ease both',
        }}
      />

      {/* Confetti */}
      <div className="absolute inset-0">
        {confetti.map((c) => (
          <span
            key={c.id}
            style={{
              position: 'absolute',
              top: 0,
              left: `${c.left}%`,
              width: c.size,
              height: c.round ? c.size : c.size * 0.4,
              backgroundColor: c.color,
              borderRadius: c.round ? '9999px' : '2px',
              '--drift': `${c.drift}px`,
              transform: `rotate(${c.rotate}deg)`,
              animation: `yzCelebFall ${c.duration}s linear ${c.delay}s both`,
            }}
          />
        ))}
      </div>

      {/* Big centered animation */}
      <div
        className="relative drop-shadow-2xl"
        style={{
          width: 'min(80vw, 80vh, 560px)',
          height: 'min(80vw, 80vh, 560px)',
          animation: 'yzCelebPop 700ms cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        <Lottie animationData={data} loop={false} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}
