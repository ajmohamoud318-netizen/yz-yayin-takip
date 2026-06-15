import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarOff } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import AppShell from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { STAGE_LABELS, STATUS_META, TYPE_LABELS, statusKeyForProject } from '@/api'
import { cn, initials } from '@/lib/utils'

const TR_MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
]

const LEGEND_KEYS = ['orange', 'purple', 'green', 'blue', 'pink', 'yellow']

// Estimated lead time (months) used to draw a bar that ends at target_month.
const LEAD_MONTHS = { TR: 3, CIN: 4 }

// Yellow (Satışta) is too light for white text.
function barText(key) {
  return key === 'yellow' ? 'text-amber-950' : 'text-white'
}

export default function YearPlan() {
  const { projects, loading } = useProjects()
  const navigate = useNavigate()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())

  const { bars, undated } = useMemo(() => {
    const undatedList = []
    const barList = []
    for (const p of projects) {
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
    barList.sort((a, b) => a.start - b.start || a.end - b.end || a.p.title.localeCompare(b.p.title, 'tr'))
    return { bars: barList, undated: undatedList }
  }, [projects, year])

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
    <AppShell>
      <div
        className="space-y-6 touch-pan-y"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
      >
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Yıllık Plan</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {year} · {bars.length} proje zaman çizelgesinde
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">
              Yıl değiştirmek için sağa / sola kaydırın
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => setYear((y) => y - 1)} aria-label="Önceki yıl">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[4rem] text-center text-sm font-semibold tabular-nums">{year}</span>
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
          {LEGEND_KEYS.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
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
              <div className="relative min-w-[860px]">
                {/* Current-month band (spans full height behind rows) */}
                {isThisYear && (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-0 bg-primary/[0.06]"
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
                  {bars.map(({ p, start, end }) => {
                    const key = statusKeyForProject(p)
                    const meta = STATUS_META[key]
                    const leftPct = (start / 12) * 100
                    const widthPct = ((end - start + 1) / 12) * 100
                    return (
                      <div key={p.id} className="flex items-center border-b last:border-0 hover:bg-muted/20">
                        <div className="relative h-14 flex-1">
                          {/* gridlines */}
                          <div className="absolute inset-0 flex">
                            {TR_MONTHS_SHORT.map((m) => (
                              <div key={m} className="flex-1 border-l border-border/40" />
                            ))}
                          </div>
                          {/* bar */}
                          <button
                            type="button"
                            onClick={() => navigate(`/projects/${p.id}`)}
                            title={`${p.title} · ${STAGE_LABELS[p.stage]} · ${TYPE_LABELS[p.type]} · ${p.assigned_name} · %${p.progress}`}
                            style={{ left: `calc(${leftPct}% + 4px)`, width: `calc(${widthPct}% - 8px)` }}
                            className={cn(
                              'group absolute top-1/2 flex h-9 -translate-y-1/2 flex-col justify-center overflow-hidden rounded-md px-1.5 shadow-sm',
                              'transition-[transform,box-shadow] duration-150 ease-out hover:shadow-md hover:brightness-105',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                              'motion-reduce:transition-none',
                              meta.dot,
                              barText(key),
                            )}
                          >
                            <div className="flex items-center gap-1.5 pb-1">
                              <span
                                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-white/25 text-[9px] font-semibold ring-1 ring-white/40"
                                title={p.assigned_name}
                              >
                                {initials(p.assignees?.[0]?.name ?? p.assigned_name)}
                              </span>
                              <span className="truncate text-[11px] font-semibold leading-none">
                                {p.title}
                              </span>
                              <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums opacity-90">
                                %{p.progress}
                              </span>
                            </div>
                            {/* progress bar */}
                            <div className="absolute inset-x-1.5 bottom-1 h-1 overflow-hidden rounded-full bg-black/20">
                              <div
                                className={cn('h-full rounded-full', key === 'yellow' ? 'bg-amber-900' : 'bg-white')}
                                style={{ width: `${p.progress}%` }}
                              />
                            </div>
                          </button>
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
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
