import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Inbox, ShoppingCart, Search, ChevronDown, AlertTriangle,
  ChevronRight, X,
} from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import FilterChip from '@/components/FilterChip'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import AssigneeAvatars from '@/components/AssigneeAvatars'
import api, {
  STAGE_LABELS, STAGE_PIPELINE, TYPE_LABELS, ORDER_STEPS, ORDER_STEP_LABELS,
  statusKeyForProject, STATUS_STYLES,
} from '@/api'
import { cn, formatNumber, formatTargetDate } from '@/lib/utils'

// Each column gets a unique soft pastel. Light tints keep the
// dark heading text readable. Cycles if there are more stages than colors.
const COLUMN_PASTELS = ['#E7DBF5', '#D7F0E4', '#FDE3D1', '#D6ECF8', '#F8DCE8', '#FBF0C9', '#E0E4FA']

const SORT_OPTIONS = [
  { value: 'default', label: 'Varsayılan' },
  { value: 'target', label: 'Hedef Tarih' },
  { value: 'progress_asc', label: 'İlerleme ↑' },
  { value: 'progress_desc', label: 'İlerleme ↓' },
  { value: 'updated', label: 'Son Güncelleme' },
]

const EMPTY_MESSAGES = {
  tasarim: 'Tasarımda proje yok',
  demo_teslim: 'Demo bekleyen yok',
  demo_onay: 'Onay bekleyen demo yok',
  ozalit_teslim: 'Ozalit bekleyen yok',
  ozalit_onay: 'Onay bekleyen ozalit yok',
  baski_onay: 'Baskı onayı bekleyen yok',
  baskida: 'Baskıda proje yok',
  satista: 'Satışta proje yok',
  cin_demo_teslim: 'Çin demo bekleyen yok',
  cin_demo_onay: 'Çin onay bekleyen yok',
  cin_baski_onay: 'Çin baskı onayı bekleyen yok',
  gumruk: 'Gümrükte proje yok',
}

// ── Helpers ──────────────────────────────────────────────────────────────
function isOverdue(targetMonth) {
  if (!targetMonth) return false
  const d = new Date(targetMonth)
  const now = new Date()
  return d.getFullYear() < now.getFullYear() ||
    (d.getFullYear() === now.getFullYear() && d.getMonth() < now.getMonth())
}

function sortProjects(list, sortKey) {
  if (sortKey === 'default') return list
  const sorted = [...list]
  switch (sortKey) {
    case 'target':
      return sorted.sort((a, b) => (a.target_month ?? '9').localeCompare(b.target_month ?? '9'))
    case 'progress_asc':
      return sorted.sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0))
    case 'progress_desc':
      return sorted.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))
    case 'updated':
      return sorted.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    default:
      return sorted
  }
}

/**
 * Kanban-style board: one column per pipeline stage.
 * Each column is a vertical stack of project cards; click a card to open detail.
 * Project progression (which column a card lives in) is driven entirely by
 * the server's `stage` value — the board is a read-only snapshot.
 */
export default function Kanban() {
  const { projects, loading } = useProjects()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // URL-synced filters (deep linking)
  const typeFilter = searchParams.get('type') || 'all'
  const query = searchParams.get('q') || ''
  const assigneeFilter = searchParams.get('assignee') || ''
  const [sort, setSort] = useState('default')
  const [collapsed, setCollapsed] = useState(new Set())

  // ── Orders with periodic refresh (20 s) ────────────────────────────────
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)

  const fetchOrders = useCallback(() => {
    api.listOrderRequests()
      .then((data) => setOrders(data))
      .finally(() => setOrdersLoading(false))
  }, [])

  useEffect(() => {
    fetchOrders()
    const id = setInterval(fetchOrders, 20_000)
    return () => clearInterval(id)
  }, [fetchOrders])

  // ── Pipeline & filtered data ───────────────────────────────────────────
  const pipeline = typeFilter === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      if (q && !p.title.toLowerCase().includes(q) &&
          !(p.assigned_name ?? '').toLowerCase().includes(q)) return false
      if (assigneeFilter && !(p.assignees ?? []).some((a) => a.id === assigneeFilter)) return false
      return true
    })
  }, [projects, typeFilter, query, assigneeFilter])

  const grouped = useMemo(() => {
    const map = Object.fromEntries(pipeline.map((s) => [s, []]))
    for (const p of filteredProjects) {
      if (map[p.stage]) map[p.stage].push(p)
    }
    for (const s of pipeline) map[s] = sortProjects(map[s], sort)
    return map
  }, [filteredProjects, pipeline, sort])

  const groupedOrders = useMemo(() => {
    const map = Object.fromEntries(ORDER_STEPS.map((s) => [s, []]))
    for (const o of orders) {
      if (map[o.status]) map[o.status].push(o)
    }
    return map
  }, [orders])

  // Unique assignees from the current filtered set (for the filter chips)
  const assignees = useMemo(() => {
    const seen = new Map()
    for (const p of filteredProjects) {
      for (const a of (p.assignees ?? [])) {
        if (!seen.has(a.id)) seen.set(a.id, a.name)
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'tr'))
  }, [filteredProjects])

  // ── URL filter helpers ─────────────────────────────────────────────────
  const setFilter = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value && value !== 'all' && value !== '') {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const toggleCollapsed = useCallback((stage) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(stage) ? next.delete(stage) : next.add(stage)
      return next
    })
  }, [])

  // ── Keyboard navigation (arrow keys between cards) ─────────────────────
  const boardRef = useRef(null)

  const handleBoardKeyDown = useCallback((e) => {
    const cards = boardRef.current?.querySelectorAll('[data-kanban-card]')
    if (!cards?.length) return
    const focused = document.activeElement
    const idx = [...cards].indexOf(focused)
    if (idx === -1) return
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(idx + 1, cards.length - 1)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(idx - 1, 0)
    if (next >= 0 && next !== idx) {
      e.preventDefault()
      cards[next].focus()
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl 3xl:max-w-[88rem] space-y-5 2xl:space-y-7">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="label-eyebrow">İş Akışı</p>
            <h1 className="mt-1 text-3xl">Pano</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={typeFilter === 'all'} onClick={() => setFilter('type', 'all')}>Tümü</FilterChip>
            <FilterChip active={typeFilter === 'TR'} onClick={() => setFilter('type', 'TR')}>{TYPE_LABELS.TR}</FilterChip>
            <FilterChip active={typeFilter === 'CIN'} onClick={() => setFilter('type', 'CIN')}>{TYPE_LABELS.CIN}</FilterChip>
          </div>
        </header>

        {/* ── Search + filters bar ───────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring" style={{ minWidth: 200 }}>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setFilter('q', e.target.value)}
              placeholder="Proje veya tasarımcı arayın…"
              className="w-full min-w-[140px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button type="button" onClick={() => setFilter('q', '')} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Assignee filter */}
          {assignees.length > 0 && (
            <div className="relative">
              <select
                value={assigneeFilter}
                onChange={(e) => setFilter('assignee', e.target.value)}
                className="h-8 appearance-none rounded-md border bg-background py-1 pl-3 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Tüm Tasarımcılar</option>
                {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          )}

          {/* Sort */}
          <div className="relative ml-auto">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="h-8 appearance-none rounded-md border bg-background py-1 pl-3 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Toggle empty columns */}
          <button
            type="button"
            onClick={() => {
              const emptyStages = pipeline.filter((s) => (grouped[s] ?? []).length === 0)
              if (emptyStages.every((s) => collapsed.has(s))) {
                setCollapsed(new Set())
              } else {
                setCollapsed(new Set(emptyStages))
              }
            }}
            className="h-8 rounded-md border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {pipeline.filter((s) => (grouped[s] ?? []).length === 0).every((s) => collapsed.has(s))
              ? 'Boşları Göster' : 'Boşları Gizle'}
          </button>
        </div>

        {/* ── Projects board ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Projeler</h2>
          {loading ? (
            <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
              {pipeline.map((s) => <Skeleton key={s} className="h-64 w-72 shrink-0 rounded-xl sm:w-64" />)}
            </div>
          ) : (
            <div ref={boardRef} className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4" onKeyDown={handleBoardKeyDown}>
              {pipeline.map((stage, i) => {
                const items = grouped[stage] ?? []
                const isCollapsed = collapsed.has(stage) && items.length === 0
                return (
                  <KanbanColumn
                    key={stage}
                    stage={stage}
                    label={STAGE_LABELS[stage]}
                    color={COLUMN_PASTELS[i % COLUMN_PASTELS.length]}
                    items={items}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => toggleCollapsed(stage)}
                    overdueCount={items.filter((p) => isOverdue(p.target_month)).length}
                    renderItem={(p) => <ProjectCard project={p} onOpen={(proj) => navigate(`/projects/${proj.id}`)} />}
                  />
                )
              })}
            </div>
          )}
        </section>

        {/* ── Orders board ───────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Siparişler</h2>
          {ordersLoading ? (
            <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
              {ORDER_STEPS.map((s) => <Skeleton key={s} className="h-64 w-72 shrink-0 rounded-xl sm:w-64" />)}
            </div>
          ) : (
            <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
              {ORDER_STEPS.map((step, i) => (
                <KanbanColumn
                  key={step}
                  stage={step}
                  label={ORDER_STEP_LABELS[step]}
                  color={COLUMN_PASTELS[i % COLUMN_PASTELS.length]}
                  items={groupedOrders[step] ?? []}
                  onOpen={(o) => navigate(`/projects/${o.project_id}`)}
                  emptyIcon={ShoppingCart}
                  renderItem={(o) => <OrderCard order={o} />}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

// ── Column ─────────────────────────────────────────────────────────────────
function KanbanColumn({
  stage, label, color, items, isCollapsed, onToggleCollapse,
  overdueCount, renderItem, emptyIcon: EmptyIcon = Inbox,
}) {
  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex w-10 shrink-0 flex-col items-center rounded-xl border bg-muted/30 py-3 transition-colors hover:bg-muted/50"
        style={{ borderTop: `3px solid ${color}` }}
        title={`${label} (${items.length})`}
      >
        <span className="mb-1 text-[10px] font-semibold text-muted-foreground">{items.length}</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    )
  }

  return (
    <section
      className="flex w-72 2xl:w-80 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/30"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <header className="flex items-center justify-between border-b px-3 py-2.5" style={{ backgroundColor: color }}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{label}</h2>
          <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">{items.length}</span>
          {overdueCount > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
              <AlertTriangle className="h-2.5 w-2.5" />{overdueCount}
            </span>
          )}
        </div>
        {onToggleCollapse && items.length === 0 && (
          <button type="button" onClick={onToggleCollapse} className="text-muted-foreground hover:text-foreground" title="Sütunu gizle">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {items.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed bg-background/60 p-6 text-center text-xs text-muted-foreground">
            <div className="flex flex-col items-center gap-1">
              <EmptyIcon className="h-5 w-5" />
              <span>{EMPTY_MESSAGES[stage] || 'Boş'}</span>
            </div>
          </div>
        ) : (
          items.map((item) => renderItem(item))
        )}
      </div>
    </section>
  )
}

// ── Project Card (read-only snapshot of a project's current stage) ────────
function ProjectCard({ project: p, onOpen }) {
  const statusKey = statusKeyForProject(p)
  const statusStyle = STATUS_STYLES[statusKey]
  const overdue = isOverdue(p.target_month)

  return (
    <Card
      data-kanban-card=""
      role="button"
      tabIndex={0}
      aria-label="detayları aç"
      className={cn(
        'relative cursor-pointer transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        overdue && 'border-red-300',
      )}
      onClick={() => onOpen?.(p)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(p) }
      }}
    >
      <CardContent className="space-y-2 p-3">
        <div className="min-w-0 flex-1 space-y-2">
          {/* Status dot + title + type */}
          <div className="flex items-start gap-1.5">
            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', statusStyle.dot)} title={statusStyle.label} />
            <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-tight">{p.title}</p>
            <Badge variant="outline" className="shrink-0 text-[10px]">{TYPE_LABELS[p.type]}</Badge>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <Progress value={p.progress} className="h-1.5 flex-1" indicatorClassName={statusStyle.bar} />
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{p.progress}%</span>
          </div>

          {/* Target month + attempt badges */}
          <div className="flex items-center gap-1.5 text-[11px]">
            {p.target_month && (
              <span className={cn('flex items-center gap-0.5', overdue ? 'font-medium text-red-600' : 'text-muted-foreground')}>
                {overdue && <AlertTriangle className="h-3 w-3" />}
                {formatTargetDate(p.target_month)}
              </span>
            )}
            {p.demo_attempt > 0 && (
              <span className="rounded bg-purple-100 px-1 text-[9px] font-medium text-purple-700">D{p.demo_attempt + 1}</span>
            )}
            {p.ozalit_attempt > 0 && (
              <span className="rounded bg-blue-100 px-1 text-[9px] font-medium text-blue-700">Ö{p.ozalit_attempt + 1}</span>
            )}
          </div>

          {/* Assignee */}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <AssigneeAvatars assignees={p.assignees} size="h-5 w-5" text="text-[9px]" />
            <span className="truncate">{p.assigned_name}</span>
          </div>
        </div>
      </CardContent>

      {/* Overdue top border */}
      {overdue && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] rounded-t-xl bg-red-500" />
      )}
    </Card>
  )
}

// ── Order Card ─────────────────────────────────────────────────────────────
function OrderCard({ order: o }) {
  const quantity = o.quantity ?? (o.items ?? []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
  const stepIdx = ORDER_STEPS.indexOf(o.status)

  return (
    <>
      <p className="line-clamp-2 text-sm font-semibold leading-tight">
        {o.project_title?.replace(/ \/ /g, ' ')}
      </p>

      {/* Mini step progress */}
      <div className="flex items-center gap-1">
        {ORDER_STEPS.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 w-1.5 rounded-full transition-colors',
              i <= stepIdx ? 'bg-primary' : 'bg-muted-foreground/20',
            )}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{o.requested_by_name}</span>
        {quantity > 0 && <span className="shrink-0 font-medium text-foreground">{formatNumber(quantity)} adet</span>}
      </div>
    </>
  )
}
