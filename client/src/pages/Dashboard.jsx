import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useProjects } from '../hooks/useProjects.js'
import { useOpenOrdersByProject } from '../hooks/useOpenOrders.js'
import { STATUS_STYLES, statusKeyForProject } from '../api.js'
import { Card } from '../components/ui/card.jsx'
import { Skeleton } from '../components/ui/skeleton.jsx'
import { Button } from '../components/ui/button.jsx'
import YearPlanBar from '../components/YearPlanBar.jsx'
import { cn, formatNumber } from '../lib/utils.js'

// The seven status color keys, in legend order.
// Order = pipeline order (Yeni → Devam → Demo → Özalit → Üretime Hazır → Üretimde → Satışta)
const LEGEND_KEYS = ['orange', 'purple', 'green', 'blue', 'teal', 'pink', 'yellow']

const TR_MONTHS_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
]

// School-year season tints — painted in the year-row (the strip ABOVE the
// horizontal divider, between the divider and the top border of the cell).
// Eylül–Haziran = BİLSEM hazırlık dönemi (mavi). Tem–Ağu–Eyl = yaza hazırlık
// dönemi (turuncu). Eylül sits in both lists in your spec; we paint it blue
// because the *active* period is the school year, not the trailing wrap-up.
const SCHOOL_YEAR_MONTHS = new Set([8, 9, 10, 11, 0, 1, 2, 3, 4, 5])

// Solid Tailwind colors used as both the band fill and a darker divider
// line so the divider sits ON the band edge (no white sliver).
function seasonColors(month) {
  if (month === 6 || month === 7) {
    // Orange (yaza hazırlık) for Temmuz + Ağustos.
    return {
      band: 'bg-orange-300 dark:bg-orange-700',
      divider: 'divide-orange-500/60 dark:divide-orange-500/70',
    }
  }
  // Eylül + the rest of the school year: blue.
  return {
    band: 'bg-sky-300 dark:bg-sky-800',
    divider: 'divide-sky-600/60 dark:divide-sky-400/60',
  }
}

const YEAR_START = 2013
const YEAR_END = 2045
const MONTH_COUNT = (YEAR_END - YEAR_START + 1) * 12

const TIMELINE_MONTHS = Array.from({ length: MONTH_COUNT }, (_, i) => {
  const year = YEAR_START + Math.floor(i / 12)
  const month = i % 12
  return { i, year, month, label: TR_MONTHS_SHORT[month] }
})

function monthIndex(year, month) {
  return (year - YEAR_START) * 12 + month
}

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

  const bars = useMemo(() => {
    const barList = []
    for (const p of projects) {
      if (!p.target_month) continue
      const y = Number(p.target_month.slice(0, 4))
      const endMonth = Number(p.target_month.slice(5, 7)) - 1
      if (y < YEAR_START || y > YEAR_END || endMonth < 0 || endMonth > 11) continue

      // Bar starts where the project actually started (created_at), not a
      // guessed lead time — a project made this month shows a short bar,
      // not always a multi-month one. Clip to the timeline start when
      // created before 2013, and never start after its own target month.
      let end = monthIndex(y, endMonth)
      let start = end
      const created = p.created_at ? new Date(p.created_at) : null
      if (created && !Number.isNaN(created.getTime())) {
        start = monthIndex(created.getFullYear(), created.getMonth())
      }
      start = Math.min(Math.max(0, start), end)
      end = Math.min(end, MONTH_COUNT - 1)
      if (end < 0 || start > MONTH_COUNT - 1) continue
      barList.push({ p, start, end })
    }
    // Newest project first (matches Yıllık Planı). Falls back to title
    // for ties when two projects share the same created_at second.
    barList.sort(
      (a, b) =>
        (b.p.created_at ?? '').localeCompare(a.p.created_at ?? '') ||
        a.p.title.localeCompare(b.p.title, 'tr'),
    )
    return barList
  }, [projects])

  const nowYear = now.getFullYear()
  const currentIndex = Math.min(
    MONTH_COUNT - 1,
    Math.max(0, monthIndex(nowYear, now.getMonth())),
  )
  const isThisYear = year === nowYear

  // --- Month carousel (2013–2045) ----------------------------------------
  const scrollRef = useRef(null)
  const dragRef = useRef(null)
  const skipClickRef = useRef(false)
  const didInitScroll = useRef(false)

  function monthWidth() {
    const el = scrollRef.current
    if (!el) return 0
    return el.scrollWidth / MONTH_COUNT
  }

  function scrollToMonthIndex(index) {
    const el = scrollRef.current
    const w = monthWidth()
    if (!el || w < 1) return
    const maxIndex = Math.max(0, Math.round((el.scrollWidth - el.clientWidth) / w))
    const clamped = Math.min(Math.max(0, index), maxIndex)
    el.scrollLeft = clamped * w
  }

  function scrollByMonth(delta) {
    const el = scrollRef.current
    const w = monthWidth()
    if (!el || w < 1) return
    const index = Math.round(el.scrollLeft / w)
    scrollToMonthIndex(index + delta)
  }

  function snapToNearestMonth() {
    const el = scrollRef.current
    const w = monthWidth()
    if (!el || w < 1) return
    scrollToMonthIndex(Math.round(el.scrollLeft / w))
  }

  function syncYearFromScroll() {
    const el = scrollRef.current
    const w = monthWidth()
    if (!el || w < 1) return
    const index = Math.min(MONTH_COUNT - 1, Math.max(0, Math.round(el.scrollLeft / w)))
    const nextYear = YEAR_START + Math.floor(index / 12)
    setYear((cur) => (cur === nextYear ? cur : nextYear))
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || loading) return

    function applyInitial() {
      const w = el.scrollWidth / MONTH_COUNT
      if (w < 1 || el.scrollWidth <= el.clientWidth + 1) return false
      if (!didInitScroll.current) {
        el.scrollLeft = currentIndex * w
        didInitScroll.current = true
      }
      return true
    }

    if (applyInitial()) return undefined

    const ro = new ResizeObserver(() => {
      if (applyInitial()) ro.disconnect()
    })
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [loading, bars.length, currentIndex])

  function onTrackPointerDown(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    const el = scrollRef.current
    if (!el) return
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
      captured: false,
    }
  }

  function onTrackPointerMove(e) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const el = scrollRef.current
    if (!el) return
    const dx = e.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) < 6) return
    if (!drag.captured) {
      el.setPointerCapture(e.pointerId)
      drag.captured = true
      drag.moved = true
      el.classList.remove('snap-x', 'snap-mandatory')
      el.classList.add('snap-none')
    }
    el.scrollLeft = drag.startScroll - dx
  }

  function onTrackPointerUp(e) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const el = scrollRef.current
    if (drag.moved) skipClickRef.current = true
    if (el) {
      if (drag.captured) el.releasePointerCapture(e.pointerId)
      el.classList.add('snap-x', 'snap-mandatory')
      el.classList.remove('snap-none')
    }
    dragRef.current = null
    if (drag.moved) snapToNearestMonth()
  }

  function onTrackClickCapture(e) {
    if (!skipClickRef.current) return
    skipClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  function onTrackKeyDown(e) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      scrollByMonth(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      scrollByMonth(1)
    }
  }

  return (
    <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl 3xl:max-w-[88rem] space-y-6 2xl:space-y-8">
        {/* Summary cards — Toplam + one per status group.
            8 cards on a single row from xl+ (desktop with sidebar rail) so the count
            strip reads as one horizontal metric row. 4-col at lg (tablet) where 8
            would feel cramped, and 2-col on mobile. Gaps widen at 2xl for breathing.
            While loading, render 8 skeleton tiles instead of real values —
            otherwise the cards flash "0" for ~100–400 ms on every hard
            refresh, which reads as "your data is empty" until numbers pop
            in. */}
        {/* Grouped, not merged — each stat keeps its own card (rounded
            corners, border, colored surface); the group container just
            clusters the 8 of them into one visual section. */}
        <Card
          className={cn(
            'bg-muted/30 p-2 shadow-sm ring-1 ring-border/60 sm:p-3',
            // On a cold-load error, the cards still render but the counts can't
            // be trusted — dim them so the user reads "stale data" rather than
            // "0 projects". The amber banner below explains why.
            error && 'opacity-60',
          )}
        >
          <div className="stagger-children grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 xl:grid-cols-8">
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
        </Card>

        {/* Grouped, not merged — the header and the chart each keep their
            own card; this wrapper just clusters the two into one section,
            same pattern as the stat-card group above. */}
        <Card className={cn('space-y-3 bg-gradient-to-br from-sky-100/50 via-rose-50/40 to-amber-50/35 p-2 shadow-sm ring-1 ring-border/60 sm:p-3', error && 'opacity-60')}>
          <Card className="ios-glass relative grid grid-cols-1 items-end gap-3 rounded-2xl border-transparent bg-transparent px-4 py-3 shadow-none ring-0 sm:grid-cols-[1fr_auto_1fr]">
            <div className="hidden sm:block" aria-hidden="true" />
            <h1 className="text-center text-3xl text-slate-900">Yıllık Plan</h1>
            <div className="flex items-center justify-end gap-2">
              <div className="flex items-center gap-1">
                <span className="min-w-[4rem] text-center text-sm font-bold tabular-nums text-slate-800">{year}</span>
                {!isThisYear && (
                  <Button variant="ghost" size="sm" onClick={() => scrollToMonthIndex(currentIndex)} className="ml-1 text-slate-600 hover:bg-white/50 hover:text-slate-900">
                    Bu yıl
                  </Button>
                )}
                {/* Yenileyin as a tiny ghost icon button — no label, sits in
                    the year cluster so it doesn't look like a separate
                    chrome control. Title tooltip explains what it does. */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={refetch}
                  aria-label="Listeyi yenileyin"
                  title="Listeyi yenileyin"
                  className="ml-1 h-9 w-9 text-slate-500 hover:bg-white/50 hover:text-slate-900"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>

          {/* Yıllık plan chart. A transient API error (e.g. a 30-second poll
              tick that 401'd mid-session) used to replace the chart wholesale
              with a red "X-User-Id header is required" card — even if bars
              were already loaded. Demote the error to an inline banner when
              we have data, keep the full-screen error card only as the cold-
              load fallback. */}
          {/* Chart area: amber banner for any error, then skeleton/empty/chart/error. */}
          {error && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
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
                    className="underline underline-offset-2 hover:text-amber-900"
                  >tekrar giriş yap</button>.</>
                )}
              </span>
              <button
                type="button"
                onClick={refetch}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100"
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
              <p className="text-sm font-medium text-foreground">Planlanmış proje yok.</p>
              <p className="mt-1 text-xs text-muted-foreground">Proje hedef ayı belirleyin.</p>
            </div>
          ) : (
            <Card className="relative overflow-hidden shadow-sm ring-1 ring-border/60">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => scrollByMonth(-1)}
                onPointerDown={(e) => {
                  e.stopPropagation()
                }}
                aria-label="Önceki ay"
                className="absolute left-1 top-1.5 z-20 h-8 w-8 bg-card/80 text-muted-foreground backdrop-blur-sm hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => scrollByMonth(1)}
                onPointerDown={(e) => {
                  e.stopPropagation()
                }}
                aria-label="Sonraki ay"
                className="absolute right-1 top-1.5 z-20 h-8 w-8 bg-card/80 text-muted-foreground backdrop-blur-sm hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div
                ref={scrollRef}
                tabIndex={0}
                role="region"
                aria-label="Yıllık plan, 2013–2045. Sürükleyerek sonraki aya geçin."
                onScroll={syncYearFromScroll}
                onPointerDown={onTrackPointerDown}
                onPointerMove={onTrackPointerMove}
                onPointerUp={onTrackPointerUp}
                onPointerCancel={onTrackPointerUp}
                onClickCapture={onTrackClickCapture}
                onKeyDown={onTrackKeyDown}
                className="scrollbar-thin cursor-grab touch-[pan-x_pan-y] overflow-x-auto overscroll-x-contain snap-x snap-mandatory select-none active:cursor-grabbing"
              >
                {/*
                  --mc is the month count (2013–2045). Each month stays the
                  same on-screen width as before: ~1 / 3 / 4 months in view.
                */}
                <div
                  className="relative bg-card w-[calc(var(--mc)*90%)] md:w-[calc(var(--mc)*30%)] xl:w-[calc(var(--mc)*22.5%)]"
                  style={{ '--mc': MONTH_COUNT }}
                >
                  {/* Current-month band (spans full height behind rows) */}
                  <div
                    className="pointer-events-none absolute inset-y-0 z-0 border-x border-primary/15 bg-primary/[0.055]"
                    style={{
                      left: `calc(100% * ${currentIndex} / ${MONTH_COUNT})`,
                      width: `calc(100% / ${MONTH_COUNT})`,
                    }}
                  />

                  {/* Header — independent comic/vector planner tabs, each with
                      its own thin 1px black outline and rounded top corners,
                      a cobalt blue (#0B4ED2) cap, and a pure white body with
                      a large bold black sans-serif month label. Tabs sit
                      flush shoulder-to-shoulder (no horizontal gap); the
                      1px black border on each side is the only divider
                      between them, matching the reference design exactly. */}
                  <div className="relative z-10 flex">
                    {TIMELINE_MONTHS.map((m) => {
                      const isCurrent = m.i === currentIndex
                      return (
                        <div
                          key={`${m.year}-${m.label}`}
                          className="flex w-[calc(100%/var(--mc))] shrink-0 snap-start snap-always flex-col items-stretch pb-[2px] text-center"
                        >
                          <div
                            className={cn(
                              // Rounded ONLY on the top-left and top-right
                              // corners; bottom corners stay sharp so the
                              // tab sits flush against the chart body.
                              'flex flex-1 flex-col overflow-hidden rounded-tl-md rounded-tr-md rounded-bl-none rounded-br-none border border-b-0 border-black',
                              isCurrent ? 'bg-blue-50/60' : 'bg-white',
                            )}
                          >
                            {/* Cobalt blue header bar — solid #0B4ED2 fills the
                                rounded top portion of each tab. */}
                            <div className="h-5 w-full bg-[#0B4ED2]" />
                            {/* Month label — bold black sans-serif centered on a
                                pure white body, matching the spec exactly. */}
                            <div className="flex h-7 w-full items-center justify-center px-1 text-base font-black leading-none text-black">
                              {m.label}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Rows — one per project, never shared with another. */}
                  <div className="relative z-10">
                    {/* Shared month gridlines for the whole chart */}
                    <div className="pointer-events-none absolute inset-0 flex">
                      {TIMELINE_MONTHS.map((m) => (
                        <div
                          key={`g-${m.year}-${m.label}`}
                          className={cn(
                            'w-[calc(100%/var(--mc))] shrink-0 border-l',
                            m.month === 0 ? 'border-border/70' : 'border-border/35',
                          )}
                        />
                      ))}
                    </div>
                    {bars.map(({ p, start, end }) => {
                      const leftPct = (start / MONTH_COUNT) * 100
                      const widthPct = ((end - start + 1) / MONTH_COUNT) * 100
                      const orders = openOrders.get(p.id)
                      return (
                        <div
                          key={p.id}
                          className="flex items-center border-b last:border-0 odd:bg-background/35 hover:bg-muted/25"
                        >
                          <div className="relative h-[4.5rem] flex-1">
                            <YearPlanBar
                              variant="comfortable"
                              project={p}
                              orders={orders}
                              leftPct={leftPct}
                              widthPct={widthPct}
                              animationDelay={0}
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
        </Card>

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
      <p className={cn('truncate text-xs font-bold opacity-80', isTotal ? 'text-background' : meta?.onSurface)}>
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
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
      >
        Tekrar Dene
      </button>
    </div>
  )
}
