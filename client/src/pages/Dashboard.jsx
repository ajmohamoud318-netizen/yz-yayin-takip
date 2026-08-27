import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarOff, RefreshCw } from 'lucide-react'
import { useProjects } from '../hooks/useProjects.js'
import { useOpenOrdersByProject } from '../hooks/useOpenOrders.js'
import { STATUS_STYLES, statusKeyForProject } from '../api.js'
import { Card, CardContent } from '../components/ui/card.jsx'
import { Skeleton } from '../components/ui/skeleton.jsx'
import { Button } from '../components/ui/button.jsx'
import YearPlanBarPopover from '../components/YearPlanBarPopover.jsx'
import { cn, formatNumber } from '../lib/utils.js'

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
  const openOrders = useOpenOrdersByProject()
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
        <div className={cn(
                  'stagger-children grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 xl:grid-cols-8 2xl:gap-4',
                  // On a cold-load error, the cards still render but the counts can't
                  // be trusted — dim them so the user reads "stale data" rather than
                  // "0 projects". The amber banner below explains why.
                  error && 'opacity-60',
                )}>
          {loading ? (
            <>
              <Skeleton className="h-[46px] rounded-lg sm:h-[78px]" />
              {LEGEND_KEYS.map((k) => (
                <Skeleton key={k} className="h-[46px] rounded-lg sm:h-[78px]" />
              ))}
            </>
          ) : (
            <>
              {/* Toplam → /projects (no filter). The other 7 cards link to
                  /projects?status=<key> so AllProjects filters the list down
                  to that pipeline bucket. The status filter banner on that
                  page is removable. */}
              <SummaryCardLink label="Toplam Proje" value={counts.total} colorKey="total" to="/projects" />
              {LEGEND_KEYS.map((k) => (
                <SummaryCardLink
                  key={k}
                  label={STATUS_STYLES[k].label}
                  value={counts[k]}
                  colorKey={k}
                  to={`/projects?status=${k}`}
                />
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
              {/* Yenileyin as a tiny ghost icon button — no label, sits in
                  the stepper cluster so it doesn't look like a separate
                  chrome control. Title tooltip explains what it does. */}
              <Button
                variant="ghost"
                size="icon"
                onClick={refetch}
                aria-label="Listeyi yenileyin"
                title="Listeyi yenileyin"
                className="ml-1 h-9 w-9 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Yıllık plan chart. A transient API error (e.g. a 30-second poll
            tick that 401'd mid-session) used to replace the chart wholesale
            with a red "X-User-Id header is required" card — even if bars
            were already loaded. Demote the error to an inline banner when
            we have data, keep the full-screen error card only as the cold-
            load fallback. */}
        {/* Chart area: amber banner for any error, then skeleton/empty/chart/error.
            The cards above stay visible (just dimmed on cold-load error)
            so the dashboard never collapses to a single red card. */}
        {error && (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span>
              {/* Different copy for cold-load vs warm-failure: a warm error
                  carries forward existing data, a cold error doesn't. */}
              {bars.length > 0 || projects.length > 0
                ? 'Listenin son güncellemesi başarısız oldu, eski veriler gösteriliyor.'
                : 'Veriler yüklenemedi. Tekrar denemek için aşağıdaki butonu kullanın.'}
              {/\b(x-user-id header is required|oturum geçersiz)\b/i.test(error) && (
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
              Yenileyin
            </button>
          </div>
        )}
        {loading ? (
          <Skeleton className="h-[420px] w-full rounded-xl" />
        ) : error && bars.length === 0 && projects.length === 0 ? (
          // Cold-load error AND nothing to show: a full ErrorState is the
          // most readable fallback. The cards above are dimmed to flag this.
          <ErrorState message={error} onRetry={refetch} />
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
                    const leftPct = (start / 12) * 100
                    const widthPct = ((end - start + 1) / 12) * 100
                    const order = openOrders.get(p.id)
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
                          {/* bar — wrapped in <YearPlanBarPopover> for the
                              rich hover popover. The comfortable variant
                              matches the Dashboard's existing 48px bar. */}
                          <YearPlanBarPopover
                            variant="comfortable"
                            project={p}
                            order={order}
                            leftPct={leftPct}
                            widthPct={widthPct}
                            animationDelay={0}
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

/**
 * Wrapper that turns a SummaryCard into a click-through tile. Uses a
 * `<Link>` (not `<a onClick>`) so middle-click / right-click → "Open in
 * new tab" / "Copy link" works — every other KPI card in the app (Kanban,
 * YearPlan bars) uses the same primitive.
 */
function SummaryCardLink({ label, value, colorKey, to }) {
  return (
    <Link
      to={to}
      className="block rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <SummaryCard label={label} value={value} colorKey={colorKey} interactive />
    </Link>
  )
}

function SummaryCard({ label, value, colorKey, interactive = false }) {
  const isTotal = colorKey === 'total'
  const meta = isTotal ? null : STATUS_STYLES[colorKey]
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border px-3 py-2 sm:block sm:p-4',
        'flex items-baseline justify-between gap-2',
        isTotal
          ? 'bg-foreground border-foreground'
          : cn(meta?.surface, meta?.border),
        interactive && 'transition-transform hover:-translate-y-0.5 hover:shadow-md',
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
        {formatNumber(value)}
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
