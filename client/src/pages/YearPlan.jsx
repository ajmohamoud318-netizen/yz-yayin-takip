import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import { useOpenOrdersByProject } from '@/hooks/useOpenOrders'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import YearPlanBar from '@/components/YearPlanBar'
import { STATUS_META } from '@/api'
import { cn } from '@/lib/utils'

const TR_MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
]

// The seven status color keys, in legend order.
// Order = pipeline order (Yeni → Devam → Demo → Özalit → Üretime Hazır → Üretimde → Satışta)
const LEGEND_KEYS = ['orange', 'purple', 'green', 'blue', 'teal', 'pink', 'yellow']

export default function YearPlan() {
  const { projects, loading } = useProjects()
  const openOrders = useOpenOrdersByProject()
  const navigate = useNavigate()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  // Accordion: only one month's project list is open at a time, so the
  // page's height depends on how many projects land in that one month,
  // never on the total project count for the year. Defaults to the
  // current month when viewing the current year.
  const [expandedMonth, setExpandedMonth] = useState(
    year === now.getFullYear() ? now.getMonth() : null,
  )

  const bars = useMemo(() => {
    const barList = []
    for (const p of projects) {
      if (!p.target_month) continue
      const y = Number(p.target_month.slice(0, 4))
      const end = Number(p.target_month.slice(5, 7)) - 1
      if (y !== year || end < 0 || end > 11) continue

      // Bar starts where the project actually started (created_at), not a
      // guessed lead time — a project made this month shows a short bar,
      // not always a multi-month one. Clip to Jan when created in an
      // earlier year, and never start after its own target month.
      const created = p.created_at ? new Date(p.created_at) : null
      let start = end
      if (created && !Number.isNaN(created.getTime())) {
        if (created.getFullYear() < year) start = 0
        else if (created.getFullYear() === year) start = Math.min(created.getMonth(), end)
      }
      barList.push({ p, start, end })
    }
    barList.sort((a, b) => (b.p.created_at ?? '').localeCompare(a.p.created_at ?? ''))
    return barList
  }, [projects, year])

  // Group projects by their target (due) month — one accordion section
  // per month, each project appearing on its own row inside its section.
  const monthGroups = useMemo(() => {
    const groups = Array.from({ length: 12 }, () => [])
    for (const bar of bars) groups[bar.end].push(bar)
    return groups
  }, [bars])

  const currentMonth = now.getMonth()
  const isThisYear = year === now.getFullYear()

  function goToYear(newYear) {
    setYear(newYear)
    setExpandedMonth(newYear === now.getFullYear() ? now.getMonth() : null)
  }

  function toggleMonth(i) {
    setExpandedMonth((cur) => (cur === i ? null : i))
  }

  // --- Swipe / wheel to change year ----------------------------------
  const touchStart = useRef(null)
  const wheelLock = useRef(false)

  function changeYear(delta) {
    goToYear(year + delta)
  }

  function onTouchStart(e) {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }

  function onTouchEnd(e) {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    changeYear(dx < 0 ? 1 : -1)
  }

  function onWheel(e) {
    if (Math.abs(e.deltaX) < 40 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
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
              {year} · {bars.length} proje
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => goToYear(year - 1)} aria-label="Önceki yıl">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span key={`y-${year}`} className="yp-year-swap min-w-[4rem] text-center text-sm font-semibold tabular-nums">{year}</span>
            <Button variant="outline" size="icon" onClick={() => goToYear(year + 1)} aria-label="Sonraki yıl">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isThisYear && (
              <Button variant="ghost" size="sm" onClick={() => goToYear(now.getFullYear())} className="ml-1">
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
            {/* key={year} remounts the accordion on year change so entrance
                animations fire every time the user navigates years. */}
            <div key={year} className="divide-y">
              {TR_MONTHS_SHORT.map((label, i) => {
                const group = monthGroups[i]
                const isOpen = expandedMonth === i
                const isCurrent = isThisYear && i === currentMonth
                return (
                  <div key={label} className={cn(isCurrent && 'yp-month-band')}>
                    <button
                      type="button"
                      onClick={() => toggleMonth(i)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/20"
                    >
                      <span className={cn('text-sm font-bold', isCurrent ? 'text-primary' : 'text-foreground')}>
                        {label}
                      </span>
                      <span className="flex items-center gap-2">
                        {group.length > 0 && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                            {group.length}
                          </span>
                        )}
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform duration-200',
                            isOpen && 'rotate-180',
                          )}
                        />
                      </span>
                    </button>
                    {isOpen && (
                      <div key={`${year}-${i}`} className="space-y-2 px-4 pb-4">
                        {group.length === 0 ? (
                          <p className="py-2 text-xs text-muted-foreground">Bu ay için proje yok.</p>
                        ) : (
                          group.map(({ p }, idx) => {
                            const orders = openOrders.get(p.id)
                            const staggerIdx = Math.min(idx, 10)
                            return (
                              <div key={p.id} className="relative h-[4.5rem]">
                                <YearPlanBar
                                  variant="comfortable"
                                  project={p}
                                  orders={orders}
                                  leftPct={0}
                                  widthPct={100}
                                  animationDelay={staggerIdx * 50}
                                  onClick={() => navigate(`/projects/${p.id}`)}
                                />
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )}

      </div>
    </>
  )
}
