import { createContext, useCallback, useContext, useState } from 'react'
import CelebrationOverlay from '@/components/CelebrationOverlay'
import { useAuth } from '@/hooks/useAuth'

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
        <CelebrationOverlay
          key={active.key}
          url={active.url}
          durationMs={CELEBRATION_MS}
          onComplete={() => setActive(null)}
        />
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
