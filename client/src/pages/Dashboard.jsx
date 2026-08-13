import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarOff } from 'lucide-react'
import { useProjects } from '../hooks/useProjects.js'
import {
  STAGE_LABELS,
  STATUS_STYLES,
  TYPE_LABELS,
  statusKeyForProject,
} from '../api.js'
import { Card, CardContent } from '../components/ui/card.jsx'
import { Skeleton } from '../components/ui/skeleton.jsx'
import { Button } from '../components/ui/button.jsx'
import { cn, initials } from '../lib/utils.js'

// The seven status color keys, in legend order.
// Order = pipeline order (Yeni → Devam → Demo → Özalit → Üretime Hazır → Üretimde → Satışta)
const LEGEND_KEYS = ['orange', 'purple', 'green', 'blue', 'teal', 'pink', 'yellow']

const TR_MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
]

// Estimated lead time (months) used to draw a bar that ends at target_month.
const LEAD_MONTHS = { TR: 3, CIN: 4 }

export default function Dashboard() {
  const { projects, loading, error, refetch } = useProjects()
  const navigate = useNavigate()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())

  // Counts per status group for the summary cards.
  const counts = useMemo(() => {
    const c = Object.fromEntries(LEGEND_KEYS.map((k) => [k, 0]))
    for (const p of projects) {
      const key = statusKeyForProject(p)
      if (key in c) c[key]++
    }
    return { ...c, total: projects.length }
  }, [projects])

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
    // Newest project first (matches Yıllık Planı). Falls back to title
    // for ties when two projects share the same created_at second.
    barList.sort(
      (a, b) =>
        (b.p.created_at ?? '').localeCompare(a.p.created_at ?? '') ||
        a.p.title.localeCompare(b.p.title, 'tr'),
    )
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
    <div
      className="mx-auto max-w-7xl 2xl:max-w-screen-2xl 3xl:max-w-[88rem] space-y-6 2xl:space-y-8 touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
    >
        {/* Summary cards — Toplam + one per status group.
            8 cards on a single row from xl+ (desktop with sidebar rail) so the count
            strip reads as one horizontal metric row. 4-col at lg (tablet) where 8
            would feel cramped, and 2-col on mobile. Gaps widen at 2xl for breathing.
            While loading, render 8 skeleton tiles instead of real values —
            otherwise the cards flash "0" for ~100–400 ms on every hard
            refresh, which reads as "your data is empty" until numbers pop
            in. */}
        <div className="stagger-children grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 xl:grid-cols-8 2xl:gap-4">
          {loading ? (
            <>
              <Skeleton className="h-[46px] rounded-lg sm:h-[78px]" />
              {LEGEND_KEYS.map((k) => (
                <Skeleton key={k} className="h-[46px] rounded-lg sm:h-[78px]" />
              ))}
            </>
          ) : (
            <>
              <SummaryCard label="Toplam Proje" value={counts.total} colorKey="total" />
              {LEGEND_KEYS.map((k) => (
                <SummaryCard key={k} label={STATUS_STYLES[k].label} value={counts[k]} colorKey={k} />
              ))}
            </>
          )}
        </div>

        {/* Title row */}
        <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
          <div>
            <h1 className="text-3xl text-foreground">Yıllık Plan</h1>
            {/* Was a <p> — but the loading branch renders a <Skeleton>
                (<div>), and the HTML spec disallows block content inside
                <p>. The browser silently lifts the <div> out of the <p>
                and React's dev-mode logs a validateDOMNesting warning
                every render. A <div> with the same prose spacing reads
                identically and keeps the DOM valid. */}
            <div className="mt-1 text-sm text-muted-foreground">
              {loading ? (
                <Skeleton className="inline-block h-4 w-48 align-middle" />
              ) : (
                <>{year} · {bars.length} proje zaman çizelgesinde</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              onClick={refetch}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm hover:bg-accent"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6" />
              </svg>
              Yenile
            </button>
          </div>
        </div>

        {/* Yıllık plan chart. A transient API error (e.g. a 30-second poll
            tick that 401'd mid-session) used to replace the chart wholesale
            with a red "X-User-Id header is required" card — even if bars
            were already loaded. Demote the error to an inline banner when
            we have data, keep the full-screen error card only as the cold-
            load fallback. */}
        {error && bars.length === 0 && !loading ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : (
          <>
            {error && bars.length > 0 && (
              <div
                role="status"
                className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <span>
                  Listenin son güncellemesi başarısız oldu, eski veriler gösteriliyor.
                  {error && /\b(x-user-id header is required|oturum geçersiz)\b/i.test(error) && (
                    <> Oturum sona ermiş olabilir; <button
                      type="button"
                      onClick={() => window.location.assign('/login?next=' + encodeURIComponent(window.location.pathname + window.location.search))}
                      className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                    >tekrar giriş yap</button>.</>
                  )}
                </span>
                <button
                  type="button"
                  onClick={refetch}
                  className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/40 dark:hover:bg-amber-900/60"
                >
                  Yenile
                </button>
              </div>
            )}
            {loading ? (
              <Skeleton className="h-[420px] w-full rounded-xl" />
            ) : bars.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-card p-12 text-center">
                <p className="text-sm font-medium text-foreground">{year} için planlanmış proje yok.</p>
                <p className="mt-1 text-xs text-muted-foreground">Başka bir yıl seçin veya proje hedef ayı belirleyin.</p>
              </div>
            ) : (
              <Card className="overflow-hidden shadow-sm ring-1 ring-border/60">
            <div ref={scrollRef} className="scrollbar-thin overflow-x-auto">
              <div className="relative min-w-[900px] bg-card">
                {/* Current-month band (spans full height behind rows) */}
                {isThisYear && (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-0 border-x border-primary/15 bg-primary/[0.055]"
                    style={{
                      left: `calc(100% * ${currentMonth} / 12)`,
                      width: `calc(100% / 12)`,
                    }}
                  />
                )}

                {/* Header */}
                <div className="relative z-10 flex bg-muted/50">
                  <div className="flex flex-1">
                    {TR_MONTHS_SHORT.map((m, i) => (
                      <div
                        key={m}
                        className={cn(
                          'flex-1 border-l px-1 py-3 text-center text-[11px] font-semibold uppercase',
                          isThisYear && i === currentMonth
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground',
                        )}
                      >
                        <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-full px-2">
                          {m}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rows */}
                <div className="relative z-10">
                  {bars.map(({ p, start, end }) => {
                    const key = statusKeyForProject(p)
                    const meta = STATUS_STYLES[key]
                    const leftPct = (start / 12) * 100
                    const widthPct = ((end - start + 1) / 12) * 100
                    return (
                      <div
                        key={p.id}
                        className="flex items-center border-b last:border-0 odd:bg-background/35 hover:bg-muted/25"
                      >
                        <div className="relative h-[4.5rem] flex-1">
                          {/* gridlines */}
                          <div className="absolute inset-0 flex">
                            {TR_MONTHS_SHORT.map((m) => (
                              <div key={m} className="flex-1 border-l border-border/35" />
                            ))}
                          </div>
                          {/* bar */}
                          <button
                            type="button"
                            onClick={() => navigate(`/projects/${p.id}`)}
                            title={`${p.title} · ${STAGE_LABELS[p.stage]} · ${TYPE_LABELS[p.type]} · ${p.assigned_name} · %${p.progress}`}
                            style={{ left: `calc(${leftPct}% + 6px)`, width: `calc(${widthPct}% - 12px)` }}
                            className={cn(
                              'group absolute top-1/2 flex h-12 -translate-y-1/2 flex-col justify-center overflow-hidden rounded-md px-3 shadow-sm ring-1 ring-black/5',
                              'transition-[transform,box-shadow,filter] duration-150 ease-out hover:-translate-y-[54%] hover:shadow-lg hover:brightness-105',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                              'motion-reduce:transition-none',
                              meta.barFill,
                              'text-white',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-2 pb-1.5">
                              <span
                                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/25 text-[10px] font-semibold ring-1 ring-white/40"
                                title={p.assigned_name}
                              >
                                {initials(p.assignees?.[0]?.name ?? p.assigned_name)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-left text-xs font-semibold leading-none">
                                {p.title}
                              </span>
                              <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                                %{p.progress}
                              </span>
                            </div>
                            {/* progress bar */}
                            <div className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-black/20">
                              <div
                                className="h-full rounded-full bg-white/95"
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
          </>
        )}

        {!loading && !error && undated.length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <CalendarOff className="h-4 w-4" />
                Tarihsiz
              </span>
              <div className="flex flex-wrap gap-1.5">
                {undated.map((p) => {
                  const meta = STATUS_STYLES[statusKeyForProject(p)]
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
  )
}

/* ----------------------------- bits ------------------------------- */

function SummaryCard({ label, value, colorKey }) {
  const isTotal = colorKey === 'total'
  const meta = isTotal ? null : STATUS_STYLES[colorKey]
  return (
    <div
      className={cn(
        // On phones these 8 tiles are the entire first screen — stacked
        // label-over-number they ran 78px each, 348px of counters before the
        // plan even starts. Below sm the label and the number share one
        // baseline row (46px), which halves the block without dropping any
        // of the counts. The stacked KPI card returns at sm+.
        'relative overflow-hidden rounded-lg border px-3 py-2 sm:block sm:p-4',
        'flex items-baseline justify-between gap-2',
        isTotal
          ? 'bg-foreground border-foreground'
          : cn(meta?.surface, meta?.border),
      )}
    >
      <p className={cn('truncate text-xs font-medium opacity-80', isTotal ? 'text-background' : meta?.onSurface)}>
        {label}
      </p>
      <p
        className={cn(
          'shrink-0 font-mono text-lg font-bold tabular-nums sm:mt-2 sm:text-3xl',
          isTotal ? 'text-background' : meta?.onSurface,
        )}
      >
        {value}
      </p>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/40">
      <p className="text-sm font-medium text-red-700 dark:text-red-300">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
      >
        Tekrar Dene
      </button>
    </div>
  )
}
