import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarRange, CalendarOff, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import { STAGE_LABELS, STATUS_META, TYPE_LABELS, statusKeyForProject } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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

/**
 * Compact year-plan preview embedded at the bottom of the dashboard.
 * Renders the current year as a horizontal Gantt-style table.
 * Year can be flipped with prev/next buttons; no swipe or wheel hijack
 * (the dashboard already has horizontal-scroll card lanes nearby).
 */
export default function YearPlanSummary() {
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

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-primary/10 text-primary">
                <CalendarRange className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold tracking-tight">Yıllık Plan</h2>
              {!isThisYear && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  Geçmiş yıl görünümü
                </span>
              )}
            </div>
            <p className="pl-9 text-xs text-muted-foreground">
              {loading
                ? 'Yükleniyor…'
                : `${year} · ${bars.length} proje zaman çizelgesinde`}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setYear((y) => y - 1)}
                aria-label="Önceki yıl"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[3rem] text-center text-xs font-semibold tabular-nums">
                {year}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setYear((y) => y + 1)}
                aria-label="Sonraki yıl"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            {!isThisYear && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setYear(now.getFullYear())}
              >
                Bu yıl
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => navigate('/plan')}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Tümünü Gör
            </Button>
          </div>
        </header>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-9 text-[11px] text-muted-foreground">
          {LEGEND_KEYS.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', STATUS_META[k].dot)} />
              {STATUS_META[k].label}
            </span>
          ))}
        </div>

        {loading ? (
          <Skeleton className="h-[220px] w-full rounded-lg" />
        ) : bars.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
            <p className="text-sm font-medium text-foreground">
              {year} için planlanmış proje yok.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Başka bir yıl seçin veya proje hedef ayı belirleyin.
            </p>
          </div>
        ) : (
          <div className="scrollbar-thin -mx-1 overflow-x-auto rounded-lg border bg-background px-1">
            <div className="relative min-w-[760px]">
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
                        'flex-1 border-l px-1 py-1.5 text-center text-[10px] font-medium',
                        isThisYear && i === currentMonth
                          ? 'text-primary'
                          : 'text-muted-foreground',
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
                    <div
                      key={p.id}
                      className="flex items-center border-b last:border-0 hover:bg-muted/20"
                    >
                      <div className="relative h-11 flex-1">
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
                          style={{
                            left: `calc(${leftPct}% + 4px)`,
                            width: `calc(${widthPct}% - 8px)`,
                          }}
                          className={cn(
                            'group absolute top-1/2 flex h-7 -translate-y-1/2 flex-col justify-center overflow-hidden rounded-md px-1.5 shadow-sm',
                            'transition-[transform,box-shadow] duration-150 ease-out hover:shadow-md hover:brightness-105',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                            'motion-reduce:transition-none',
                            meta.dot,
                            barText(key),
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full bg-white/25 text-[8px] font-semibold ring-1 ring-white/40"
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
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {!loading && undated.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarOff className="h-3.5 w-3.5" />
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
                    className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-[11px] transition-colors hover:border-primary/30 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                    {p.title}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
