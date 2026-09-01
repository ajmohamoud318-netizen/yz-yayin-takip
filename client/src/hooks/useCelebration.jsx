import { createContext, lazy, Suspense, useCallback, useContext, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

// Lazy-load the Lottie overlay so the 600+ KB of lottie-web only ships to a
// browser that actually triggers a designer celebration. The overlay only
// renders when `active` is non-null (see triggerCelebration below), so
// <Suspense fallback={null}> never paints anything visible during the chunk
// fetch — the trigger only happens on a designer milestone, and the overlay
// itself draws on top of everything anyway.
const CelebrationOverlay = lazy(() => import('@/components/CelebrationOverlay'))

const CelebrationContext = createContext(null)

const ANIMATIONS = [
  '/animations/celebration-giraffe.json',
  '/animations/kiss.json',
  '/animations/kiss2.json',
]

const CELEBRATION_MS = 4000

export function CelebrationProvider({ children }) {
  const [active, setActive] = useState(null)

  const triggerCelebration = useCallback(() => {
    const url = ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)]
    setActive({ url, key: Date.now() })
  }, [])

  return (
    <CelebrationContext.Provider value={{ triggerCelebration }}>
      {children}
      {active && (
        <Suspense fallback={null}>
          <CelebrationOverlay
            key={active.key}
            url={active.url}
            durationMs={CELEBRATION_MS}
            onComplete={() => setActive(null)}
          />
        </Suspense>
      )}
    </CelebrationContext.Provider>
  )
}

export function useCelebration() {
  const ctx = useContext(CelebrationContext)
  if (!ctx) {
    throw new Error('useCelebration must be used within CelebrationProvider')
  }
  return ctx
}

/** Play a random celebration animation when the current user is a designer. */
export function useDesignerCelebration() {
  const { triggerCelebration } = useCelebration()
  const { user } = useAuth()

  return useCallback(() => {
    if (user?.role === 'designer') triggerCelebration()
  }, [triggerCelebration, user?.role])
}
