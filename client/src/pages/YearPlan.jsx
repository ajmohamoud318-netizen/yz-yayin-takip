import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import { useOpenOrdersByProject } from '@/hooks/useOpenOrders'
import { Button } from '@/components/ui/button'
import YearPlanGantt from '@/components/YearPlanGantt'
import { STATUS_META } from '@/api'
import { cn } from '@/lib/utils'

// The seven status color keys, in legend order.
// Order = pipeline order (Yeni → Devam → Demo → Özalit → Üretime Hazır → Üretimde → Satışta)
const LEGEND_KEYS = ['orange', 'purple', 'green', 'blue', 'teal', 'pink', 'yellow']

// Estimated lead time (months) used to draw a bar that ends at target_month.
const LEAD_MONTHS = { TR: 3, CIN: 4 }

export default function YearPlan() {
  const { projects, allProjects, loading } = useProjects()
  const openOrders = useOpenOrdersByProject()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())

  // Legacy (backlist) projects are excluded from the main pipeline list (see
  // useProjectsStore), but one with an open sipariş is live work again, so
  // surface it here — it'll land in the Tarihsiz bucket below since backlist
  // imports carry no target_month.
  const visibleProjects = useMemo(() => {
    const extra = allProjects.filter((p) => p.origin === 'legacy' && openOrders.has(p.id))
    return extra.length ? [...projects, ...extra] : projects
  }, [projects, allProjects, openOrders])

  const { bars, undated } = useMemo(() => {
    const undatedList = []
    const barList = []
    for (const p of visibleProjects) {
      if (!p.target_month) {
        undatedList.push(p)
        continue
      }
      const y = Number(p.target_month.slice(0, 4))
      const end = Number(p.target_month.slice(5, 7)) - 1
      if (y !== year || end < 0 || end > 11) continue
      const dur = LEAD_MONTHS[p.type] ?? 3
      const start = Math.max(0, end - (dur - 1))
      barList.push({ p, start, end })
    }
    barList.sort((a, b) => (b.p.created_at ?? '').localeCompare(a.p.created_at ?? ''))
    return { bars: barList, undated: undatedList }
  }, [visibleProjects, year])

  const isThisYear = year === now.getFullYear()

  // --- Swipe / horizontal-scroll to change year ---------------------------
  // The scroll container lives inside <YearPlanGantt>; walk the DOM from the
  // touch/gesture target to find any horizontally-scrollable ancestor. If
  // one exists and isn't at its limit, the gesture should pan that container,
  // not flip the year.
  const touchStart = useRef(null)
  const wheelLock = useRef(false)

  function tableCanScroll(target) {
    let n = target
    while (n && n !== document.body) {
      if (n.scrollWidth > n.clientWidth + 1) {
        const style = getComputedStyle(n)
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true
      }
      n = n.parentElement
    }
    return false
  }

  function changeYear(delta) {
    setYear((y) => y + delta)
  }

  function onTouchStart(e) {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY, target: e.target }
  }

  function onTouchEnd(e) {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (tableCanScroll(start.target)) return
    changeYear(dx < 0 ? 1 : -1)
  }

  function onWheel(e) {
    if (Math.abs(e.deltaX) < 40 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    if (tableCanScroll(e.target)) return
    if (wheelLock.current) return
    wheelLock.current = true
    changeYear(e.deltaX > 0 ? 1 : -1)
    setTimeout(() => {
      wheelLock.current = false
    }, 500)
  }

  return (
    <>
      <div
        className="space-y-6 touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
      >
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Yıllık Plan</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {year} · {bars.length} proje zaman çizelgesinde
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setYear((y) => y - 1)} aria-label="Önceki yıl">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span key={`y-${year}`} className="yp-year-swap min-w-[4rem] text-center text-sm font-semibold tabular-nums">{year}</span>
            <Button variant="outline" size="icon" onClick={() => setYear((y) => y + 1)} aria-label="Sonraki yıl">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isThisYear && (
              <Button variant="ghost" size="sm" onClick={() => setYear(now.getFullYear())} className="ml-1">
                Bu yıl
              </Button>
            )}
          </div>
        </header>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {LEGEND_KEYS.map((k, i) => (
            <span
              key={k}
              className="yp-legend-pop inline-flex items-center gap-1.5"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            >
              <span className={cn('h-2 w-2 rounded-full', STATUS_META[k].dot)} />
              {STATUS_META[k].label}
            </span>
          ))}
          <span className="label ml-auto inline-flex items-center gap-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <span aria-hidden="true">ⓘ</span>
            Bar uzunluğu tahmini üretim süresi · TR = 3 ay · ÇİN = 4 ay
          </span>
        </div>

        <YearPlanGantt
          bars={bars}
          undated={undated}
          openOrders={openOrders}
          loading={loading}
          year={year}
        />
      </div>
    </>
  )
}
