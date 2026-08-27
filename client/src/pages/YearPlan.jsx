import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarOff } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import { useOpenOrdersByProject } from '@/hooks/useOpenOrders'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import OrderBadge from '@/components/OrderBadge'
import YearPlanBar from '@/components/YearPlanBar'
import { STATUS_META, statusKeyForProject } from '@/api'
import { cn } from '@/lib/utils'

const TR_MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
]

// The seven status color keys, in legend order.
// Order = pipeline order (Yeni → Devam → Demo → Özalit → Üretime Hazır → Üretimde → Satışta)
const LEGEND_KEYS = ['orange', 'purple', 'green', 'blue', 'teal', 'pink', 'yellow']

// Estimated lead time (months) used to draw a bar that ends at target_month.
const LEAD_MONTHS = { TR: 3, CIN: 4 }

export default function YearPlan() {
  const { projects, allProjects, loading } = useProjects()
  const openOrders = useOpenOrdersByProject()
  const navigate = useNavigate()
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

  const currentMonth = now.getMonth()
  const isThisYear = year === now.getFullYear()

  // --- Swipe / horizontal-scroll to change year ---------------------------
  const scrollRef = useRef(null)
  const touchStart = useRef(null)
  const wheelLock = useRef(false)

  // True when the timeline table itself can still scroll sideways — in that
  // case a horizontal gesture should pan the table, not flip the year.
  function tableCanScroll(target) {
    const el = scrollRef.current
    if (!el || !target || !el.contains(target)) return false
    return el.scrollWidth > el.clientWidth + 1
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
        </div>

        {loading ? (
          <Skeleton className="h-[420px] w-full rounded-xl" />
        ) : bars.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center">
            <p className="text-sm font-medium text-foreground">{year} için planlanmış proje yok.</p>
            <p className="mt-1 text-xs text-muted-foreground">Başka bir yıl seçin veya proje hedef ayı belirleyin.</p>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div ref={scrollRef} className="scrollbar-thin overflow-x-auto">
              {/* key={year} remounts the gantt on year change so the bar-draw
                  animation fires every time the user navigates years. */}
              <div key={year} className="relative min-w-[860px]">
                {/* Current-month band — clip-path reveal + quiet pulse */}
                {isThisYear && (
                  <div
                    aria-hidden="true"
                    className="yp-month-band pointer-events-none absolute inset-y-0 z-0"
                    style={{
                      left: `calc(100% * ${currentMonth} / 12)`,
                      width: `calc(100% / 12)`,
                    }}
                  />
                )}

                {/* Header */}
                <div className="relative z-10 flex border-b bg-muted/40">
                  <div className="flex flex-1">
                    {TR_MONTHS_SHORT.map((m, i) => (
                      <div
                        key={m}
                        className={cn(
                          'flex-1 border-l px-1 py-2 text-center text-[11px] font-medium',
                          isThisYear && i === currentMonth ? 'text-primary' : 'text-muted-foreground',
                        )}
                      >
                        {m}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rows */}
                <div className="relative z-10">
                  {bars.map(({ p, start, end }, rowIdx) => {
                    const leftPct = (start / 12) * 100
                    const widthPct = ((end - start + 1) / 12) * 100
                    const order = openOrders.get(p.id)
                    // Stagger: cap at 10 rows, 50ms each = 500ms total — matches
                    // the animate.md budget. 11th+ rows land together at 500ms.
                    const staggerIdx = Math.min(rowIdx, 10)
                    return (
                      <div
                        key={p.id}
                        className="yp-row-enter flex items-center border-b last:border-0 hover:bg-muted/20"
                        style={{ animationDelay: `${staggerIdx * 50}ms` }}
                      >
                        <div className="relative h-14 flex-1">
                          {/* gridlines */}
                          <div className="absolute inset-0 flex">
                            {TR_MONTHS_SHORT.map((m) => (
                              <div key={m} className="flex-1 border-l border-border/40" />
                            ))}
                          </div>
                          {/* bar — hover popover lives on Tüm Projeler rows now
                              (ProjectHoverCard), so the bar stays a plain styled
                              chip that navigates on click. */}
                          <YearPlanBar
                            project={p}
                            order={order}
                            leftPct={leftPct}
                            widthPct={widthPct}
                            animationDelay={staggerIdx * 50 + 80}
                            onClick={() => navigate(`/projects/${p.id}`)}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Card>
        )}

        {!loading && undated.length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <CalendarOff className="h-4 w-4" />
                Tarihsiz
              </span>
              <div className="flex flex-wrap gap-1.5">
                {undated.map((p) => {
                  const meta = STATUS_META[statusKeyForProject(p)]
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate(`/projects/${p.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs transition-colors hover:border-primary/30 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                      {p.title}
                      <OrderBadge order={openOrders.get(p.id)} className="h-3 w-3 shrink-0 text-amber-600" />
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
