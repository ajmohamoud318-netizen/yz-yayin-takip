import { useEffect, useRef } from 'react'

import { STAGE_LABELS, STAGE_PIPELINE } from '../api.js'

// Single source of truth for stage order — keep StageBar in sync with the
// canonical pipeline so post-Ozalit stages (e.g. 'baskida') resolve
// correctly instead of falling back to step 1.
export function stagesForType(type) {
  return type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
}

/**
 * Compact horizontal stage indicator for a project card.
 * Highlights completed + current stages along the pipeline.
 */
export default function StageBar({ type, stage, compact = false }) {
  const stages = stagesForType(type)
  const currentIndex = Math.max(0, stages.indexOf(stage))
  const currentRef = useRef(null)

  // The 8-stage pipeline is ~600px wide, so on a phone the bar opens showing
  // steps 1–4 — i.e. a project at "Üretimde" looks like it hasn't started
  // until you think to swipe. Bring the current step into view instead.
  // `scrollLeft` on the scroll parent, not scrollIntoView: the latter also
  // scrolls the page vertically to reach the element.
  useEffect(() => {
    const el = currentRef.current
    const scroller = el?.parentElement?.parentElement // <li> → <ol> → scroll container
    if (!el || !scroller || scroller.scrollWidth <= scroller.clientWidth) return
    const target = el.offsetLeft - (scroller.clientWidth - el.offsetWidth) / 2
    scroller.scrollLeft = Math.max(0, target)
  }, [currentIndex, type])

  if (compact) {
    return (
      <div className="flex items-center gap-1" aria-hidden="true">
        {stages.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ease-out motion-reduce:transition-none ${
              i <= currentIndex ? 'bg-brand-500' : 'bg-muted'
            }`}
          />
        ))}
      </div>
    )
  }

  return (
    // Each stage gets a min-width so its label (e.g. "Üretime Hazır", 13 chars)
    // never overflows its column or gets clipped by the container edge. Combined
    // with `overflow-x-auto` on the parent in ProjectDetail.jsx this lets the
    // 8-stage TR pipeline scroll gracefully on narrow viewports instead of
    // cutting the first / last labels.
    <ol className="flex items-center min-w-max">
      {stages.map((s, i) => {
        const done = i < currentIndex
        const current = i === currentIndex
        return (
          <li
            key={s}
            ref={current ? currentRef : undefined}
            className="flex min-w-[68px] shrink-0 items-center justify-center"
          >
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-[background-color,color,box-shadow] duration-300 ease-out motion-reduce:transition-none ${
                  done
                    ? 'bg-brand-500 text-white'
                    : current
                      ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={`mt-1 max-w-[64px] text-center text-[10px] leading-tight ${
                  current ? 'font-semibold text-brand-700' : 'text-muted-foreground'
                }`}
              >
                {STAGE_LABELS[s]}
              </span>
            </div>
            {i < stages.length - 1 && (
              <span
                aria-hidden="true"
                className={`mx-2 h-0.5 w-8 transition-colors duration-500 ease-out motion-reduce:transition-none ${
                  i < currentIndex ? 'bg-brand-500' : 'bg-muted'
                }`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
