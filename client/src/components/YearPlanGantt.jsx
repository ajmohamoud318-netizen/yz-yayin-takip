import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarOff } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import OrderBadge from '@/components/OrderBadge'
import { STATUS_META, statusKeyForProject } from '@/api'
import { cn, initials } from '@/lib/utils'

const TR_MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
]

// Stable lane tints — name → soft pastel (light + dark variants).
// Pastels are 50-shade backgrounds at low opacity so the bar colors
// (saturated -600/-700) keep the dominant signal.
const LANE_TINTS = [
  'bg-rose-50/55 dark:bg-rose-950/25',
  'bg-amber-50/60 dark:bg-amber-950/20',
  'bg-sky-50/60 dark:bg-sky-950/25',
  'bg-emerald-50/60 dark:bg-emerald-950/20',
  'bg-violet-50/60 dark:bg-violet-950/25',
  'bg-orange-50/60 dark:bg-orange-950/20',
  'bg-teal-50/60 dark:bg-teal-950/20',
]

// Hash → tint. Stable across renders; never reassigns mid-session.
function laneTint(name) {
  let h = 5381
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) >>> 0
  }
  return LANE_TINTS[h % LANE_TINTS.length]
}

// Yellow (Satışta) and peach (Üretimde) bars need dark text for AA contrast.
function barText(key) {
  return key === 'yellow' || key === 'pink' ? 'text-[#5A3017]' : 'text-white'
}

const HEADER_H = 40
const LANE_HEADER_H = 40
const ROW_H = 40
const NAME_COL_W = 220

/**
 * Yıllık Plan — yearly gantt with four upgrades on top of the original:
 *
 *   A. Sticky name column — project titles live in their own left column
 *      that stays visible while the chart scrolls horizontally. Bars become
 *      pure schedule signals (color + position) instead of carrying the
 *      title text (which truncated at narrow widths).
 *
 *   B. Crisp "today" line — a 2px vertical rule + a small floating label
 *      ("Bugün · 27 Ağu") sits inside the current-month band so the user
 *      can answer "where are we in the year?" in one glance.
 *
 *   D. Progress outside the bar — the % chip lives in the name column
 *      next to the title, so it stays readable even when a bar is so
 *      narrow the in-bar label would clip.
 *
 *   F. Swim lanes by editor — projects group by `assigned_name` with a
 *      pastel lane background, a header row showing editor + project
 *      count. "What is Aylin committing to?" becomes answerable in one
 *      glance instead of hunting across the timeline.
 */
export default function YearPlanGantt({
  bars,
  undated,
  openOrders,
  loading,
  year,
}) {
  const navigate = useNavigate()
  const scrollRef = useRef(null)
  const now = new Date()
  const isThisYear = year === now.getFullYear()

  // --- Swim lanes ---------------------------------------------------------
  // Group by primary assignee (p.assigned_name). Sort lanes alphabetically
  // for stable ordering across renders.
  const lanes = useMemo(() => {
    const groups = new Map()
    for (const bar of bars) {
      const editor = bar.p.assigned_name?.trim() || 'Atanmamış'
      if (!groups.has(editor)) groups.set(editor, [])
      groups.get(editor).push(bar)
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'tr'))
      .map(([editor, items]) => ({
        editor,
        // Sort items within a lane: earliest target month first so reading
        // top-down matches the calendar flow.
        items: [...items].sort((a, b) => a.start - b.start),
        tint: laneTint(editor),
      }))
  }, [bars])

  // --- Today line geometry -----------------------------------------------
  const currentMonth = now.getMonth()
  const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate()
  const todayPct = isThisYear
    ? (currentMonth + (now.getDate() - 1) / daysInMonth) / 12 * 100
    : null
  const todayLabel = now.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
  })

  if (loading) {
    return <Skeleton className="h-[420px] w-full rounded-xl" />
  }

  if (bars.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-12 text-center">
        <p className="text-sm font-medium text-foreground">
          {year} için planlanmış proje yok.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Başka bir yıl seçin veya proje hedef ayı belirleyin.
        </p>
      </div>
    )
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div ref={scrollRef} className="scrollbar-thin overflow-x-auto">
          {/* min-width = sticky col (220) + chart col (≥660) so the chart
              scrolls inside the card on narrow viewports. */}
          <div
            className="relative flex"
            style={{ minWidth: `${NAME_COL_W + 660}px` }}
          >
            {/* === STICKY NAME COLUMN ===================================== */}
            <div className="sticky left-0 z-20 w-[220px] shrink-0 border-r bg-card">
              {/* Header — z-30 so it stacks above the body rows */}
              <div className="sticky left-0 top-0 z-30 flex h-[40px] items-center border-b bg-muted/40 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Proje
              </div>
              {lanes.map((lane) => (
                <div key={lane.editor}>
                  {/* Lane header — editor + count */}
                  <div
                    className={cn(
                      'flex items-center gap-2 border-b border-stone-200/70 px-3',
                      lane.tint,
                    )}
                    style={{ height: LANE_HEADER_H }}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/85 text-[10px] font-semibold ring-1 ring-stone-300/60 dark:bg-stone-900/40">
                      {initials(lane.editor)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold leading-tight">
                        {lane.editor}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {lane.items.length} proje
                      </div>
                    </div>
                  </div>
                  {/* Lane rows */}
                  {lane.items.map((bar) => {
                    const key = statusKeyForProject(bar.p)
                    const meta = STATUS_META[key]
                    const order = openOrders.get(bar.p.id)
                    return (
                      <div
                        key={bar.p.id}
                        className={cn(
                          'flex items-center gap-2 border-b border-stone-200/40 px-3',
                          lane.tint,
                          'hover:bg-black/[0.025] dark:hover:bg-white/[0.025]',
                        )}
                        style={{ height: ROW_H }}
                      >
                        <span
                          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)}
                          title={meta.label}
                        />
                        <button
                          type="button"
                          onClick={() => navigate(`/projects/${bar.p.id}`)}
                          title={bar.p.title}
                          className="min-w-0 flex-1 truncate text-left text-[12px] font-medium hover:text-primary focus:outline-none focus-visible:text-primary"
                        >
                          {bar.p.title}
                        </button>
                        <OrderBadge
                          order={order}
                          className="h-3 w-3 shrink-0 text-amber-600"
                        />
                        <span className="ml-auto shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ring-stone-200/70 dark:bg-stone-900/60">
                          {bar.p.progress}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* === CHART COLUMN =========================================== */}
            <div className="relative flex-1 min-w-[660px]">
              {/* Background overlays: today line + month band.
                  These live BEHIND the lanes (z-0) so the lane tints and
                  bars paint over them in their own areas. */}
              {isThisYear && (
                <>
                  <div
                    aria-hidden="true"
                    className="yp-month-band pointer-events-none absolute inset-y-0 z-0 border-x border-primary/15"
                    style={{
                      left: `${(currentMonth / 12) * 100}%`,
                      width: `${100 / 12}%`,
                    }}
                  />
                  <div
                    aria-hidden="true"
                    className="yp-today-line pointer-events-none absolute inset-y-0 z-0 w-[2px]"
                    style={{ left: `${todayPct}%` }}
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm"
                    style={{ left: `${todayPct}%`, top: 4 }}
                  >
                    Bugün · {todayLabel}
                  </div>
                </>
              )}

              {/* Month header */}
              <div className="relative z-10 flex h-[40px] border-b bg-muted/40">
                {TR_MONTHS_SHORT.map((m, i) => (
                  <div
                    key={m}
                    className={cn(
                      'flex-1 border-l border-stone-200/40 px-1 py-2 text-center text-[11px] font-medium',
                      isThisYear && i === currentMonth
                        ? 'text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {m}
                  </div>
                ))}
              </div>

              {/* Lanes */}
              {lanes.map((lane) => (
                <div key={lane.editor}>
                  {/* Lane header spacer — same height as the name column */}
                  <div
                    className={cn('border-b border-stone-200/70', lane.tint)}
                    style={{ height: LANE_HEADER_H }}
                  />
                  {/* Lane rows */}
                  {lane.items.map((bar, rowIdx) => {
                    const key = statusKeyForProject(bar.p)
                    const meta = STATUS_META[key]
                    const leftPct = (bar.start / 12) * 100
                    const widthPct = ((bar.end - bar.start + 1) / 12) * 100
                    const order = openOrders.get(bar.p.id)
                    // Stagger per-lane + per-row, capped at 10 to honor
                    // the animate.md budget. Lane offset makes the
                    // reveal feel grouped rather than random.
                    const staggerIdx = Math.min(
                      lanes.indexOf(lane) * 2 + rowIdx,
                      10,
                    )
                    return (
                      <div
                        key={bar.p.id}
                        className={cn(
                          'yp-row-enter relative border-b border-stone-200/40',
                          lane.tint,
                          'hover:bg-black/[0.025] dark:hover:bg-white/[0.025]',
                        )}
                        style={{
                          height: ROW_H,
                          animationDelay: `${staggerIdx * 40}ms`,
                        }}
                      >
                        {/* Gridlines */}
                        <div className="pointer-events-none absolute inset-0 flex">
                          {TR_MONTHS_SHORT.map((m) => (
                            <div
                              key={m}
                              className="flex-1 border-l border-stone-200/40"
                            />
                          ))}
                        </div>
                        {/* Bar */}
                        <button
                          type="button"
                          onClick={() => navigate(`/projects/${bar.p.id}`)}
                          title={`${bar.p.title} · ${meta.label} · ${bar.p.assigned_name} · ${bar.p.progress}%`}
                          style={{
                            left: `calc(${leftPct}% + 4px)`,
                            width: `calc(${widthPct}% - 8px)`,
                            animationDelay: `${staggerIdx * 40 + 80}ms`,
                          }}
                          className={cn(
                            'yp-bar-draw group absolute top-1/2 flex h-7 -translate-y-1/2 overflow-hidden rounded-md shadow-sm ring-1 ring-black/5',
                            meta.barFill,
                            barText(key),
                            'transition-[box-shadow,filter] duration-200 ease-out hover:shadow-md hover:brightness-105',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                            'motion-reduce:transition-none',
                          )}
                        >
                          {/* Progress fill — left-anchored white overlay */}
                          <div
                            aria-hidden="true"
                            className="absolute inset-y-0 left-0 bg-white/25"
                            style={{ width: `${bar.p.progress}%` }}
                          />
                          {/* Bar content: market tag (TR / ÇİN) keeps the
                              bar readable without taking space from the
                              title (which lives in the sticky column). */}
                          <span className="relative z-10 px-2 text-[10px] font-semibold uppercase leading-none tracking-wide opacity-95">
                            {bar.p.type === 'CIN' ? 'ÇİN' : bar.p.type === 'TR' ? 'TR' : ''}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Tarihsiz — projects with no target_month. Lives outside the chart
          Card so it can flow on its own when the chart is empty/full. */}
      {undated.length > 0 && (
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
                    <OrderBadge
                      order={openOrders.get(p.id)}
                      className="h-3 w-3 shrink-0 text-amber-600"
                    />
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
