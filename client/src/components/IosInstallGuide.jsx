import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Full-screen, screenshot-led guide for adding the app to the iOS Home Screen.
 *
 * Why a walkthrough and not a paragraph: Safari exposes no install API — Add
 * to Home Screen is Share-sheet only, by Apple's design — so instructions are
 * the only lever there is. Text instructions kept losing people at step one,
 * because "Paylaş düğmesi" describes a glyph most users have never
 * consciously looked at. A picture of their own screen with the button ringed
 * removes the guessing.
 *
 * The rings are drawn HERE, in CSS, not baked into the images. That means the
 * screenshots stay plain (anyone can retake them on a new iOS version without
 * an image editor) and the highlight can be nudged by editing one number.
 * Coordinates are percentages of the RENDERED IMAGE box — the wrapper shrinks
 * to the image, so they hold at any screen size.
 *
 * Every step degrades to its text instruction if the screenshot is missing or
 * fails to load, so the guide is useful before the images are ever added.
 */

const STEPS = [
  {
    img: '/ios-install/1-share.png',
    title: 'Paylaş düğmesine dokunun',
    caption: 'Safari’nin en alt çubuğunda, ortadaki yukarı oklu kare.',
    // Bottom toolbar, centre. iPhone puts Share in the middle of five icons.
    ring: { left: 43, top: 93, width: 14, height: 5.5 },
  },
  {
    img: '/ios-install/2-add.png',
    title: '"Ana Ekrana Ekle"yi seçin',
    caption: 'Açılan listeyi yukarı kaydırın, genelde biraz aşağıdadır.',
    ring: { left: 4, top: 58, width: 92, height: 7 },
  },
  {
    img: '/ios-install/3-confirm.png',
    title: 'Sağ üstteki "Ekle"ye dokunun',
    caption: 'Uygulama simgesi ana ekranınıza eklenir.',
    ring: { left: 78, top: 5, width: 18, height: 5 },
  },
]

export default function IosInstallGuide({ open, onOpenChange }) {
  const [step, setStep] = useState(0)
  const [broken, setBroken] = useState({})

  // Always reopen at step 1 — someone returning to the guide is returning
  // because they got lost, not to resume where they left off.
  useEffect(() => { if (open) setStep(0) }, [open])

  // A full-screen overlay that lets the page scroll underneath reads as broken
  // on iOS, where rubber-band scrolling drags the guide around with it.
  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  const current = STEPS[step]
  const last = step === STEPS.length - 1
  const imageOk = !broken[current.img]

  function next() {
    if (last) onOpenChange(false)
    else setStep((s) => s + 1)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Ana ekrana ekleme rehberi"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[60] flex flex-col bg-background"
          style={{
            paddingTop: 'var(--safe-top, 0px)',
            paddingBottom: 'var(--safe-bottom, 0px)',
          }}
        >
          <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Adım {step + 1} / {STEPS.length}
              </p>
              <h2 className="truncate text-sm font-semibold">{current.title}</h2>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Kapat"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/40 p-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.img}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
                className="relative flex h-full max-h-full items-center justify-center"
              >
                {imageOk ? (
                  // Wrapper shrinks to the rendered image, so the ring's
                  // percentages stay locked to the screenshot, not the viewport.
                  <span className="relative inline-block">
                    <img
                      src={current.img}
                      alt={current.title}
                      onError={() => setBroken((b) => ({ ...b, [current.img]: true }))}
                      className="block max-h-[60vh] w-auto rounded-xl border shadow-sm"
                    />
                    <motion.span
                      aria-hidden="true"
                      className="pointer-events-none absolute rounded-lg border-[3px] border-primary"
                      style={{
                        left: `${current.ring.left}%`,
                        top: `${current.ring.top}%`,
                        width: `${current.ring.width}%`,
                        height: `${current.ring.height}%`,
                      }}
                      animate={{ opacity: [1, 0.35, 1], scale: [1, 1.04, 1] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </span>
                ) : (
                  // Screenshots not added yet (or failed to load): the guide
                  // still has to be followable.
                  <ol className="max-w-xs space-y-3 text-[13px] leading-relaxed">
                    {STEPS.map((s, i) => (
                      <li key={s.title} className={cn('flex gap-2.5', i !== step && 'opacity-45')}>
                        <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                          {i + 1}
                        </span>
                        <span>
                          <span className="block font-medium">{s.title}</span>
                          <span className="block text-[11px] text-muted-foreground">{s.caption}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className="shrink-0 border-t px-4 py-3">
            <p className="text-center text-[12px] leading-snug text-muted-foreground">{current.caption}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-muted disabled:opacity-40"
                aria-label="Önceki adım"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>

              <div className="flex flex-1 items-center justify-center gap-1.5" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span
                    key={s.title}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === step ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30',
                    )}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={next}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {last ? <>Anladım <Check className="h-4 w-4" /></> : <>İleri <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
