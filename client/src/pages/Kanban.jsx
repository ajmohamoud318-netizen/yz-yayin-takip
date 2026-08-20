import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox, ShoppingCart } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import FilterChip from '@/components/FilterChip'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import api, { STAGE_LABELS, STAGE_PIPELINE, TYPE_LABELS, ORDER_STEPS, ORDER_STEP_LABELS } from '@/api'
import AssigneeAvatars from '@/components/AssigneeAvatars'
import { formatNumber } from '@/lib/utils'

// Each column gets a unique soft pastel (rule 11). Light tints keep the
// dark heading text readable. Cycles if there are more stages than colors.
const COLUMN_PASTELS = ['#E7DBF5', '#D7F0E4', '#FDE3D1', '#D6ECF8', '#F8DCE8', '#FBF0C9', '#E0E4FA']

/**
 * Kanban-style board: one column per pipeline stage.
 * Each column is a vertical stack of project cards; click a card to open detail.
 * The "Advance" button on a card moves the project to the next stage
 * (team leader / designer for tasarim → demo; printer for demo/ozalit → onay).
 */
export default function Kanban() {
  const { projects, loading } = useProjects()
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState('all')

  // Build columns: pick TR or CIN pipeline
  const pipeline = typeFilter === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR

  const grouped = useMemo(() => {
    const list = projects.filter((p) => typeFilter === 'all' || p.type === typeFilter)
    const map = Object.fromEntries(pipeline.map((s) => [s, []]))
    for (const p of list) {
      if (map[p.stage]) map[p.stage].push(p)
    }
    return map
  }, [projects, pipeline, typeFilter])

  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setOrdersLoading(true)
    api.listOrderRequests()
      .then((data) => !cancelled && setOrders(data))
      .finally(() => !cancelled && setOrdersLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const groupedOrders = useMemo(() => {
    const map = Object.fromEntries(ORDER_STEPS.map((s) => [s, []]))
    for (const o of orders) {
      if (map[o.status]) map[o.status].push(o)
    }
    return map
  }, [orders])

  return (
    <>
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl 3xl:max-w-[88rem] space-y-5 2xl:space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="label-eyebrow">İş Akışı</p>
            <h1 className="mt-1 text-3xl">Pano</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
              Tümü
            </FilterChip>
            <FilterChip active={typeFilter === 'TR'} onClick={() => setTypeFilter('TR')}>
              {TYPE_LABELS.TR}
            </FilterChip>
            <FilterChip active={typeFilter === 'CIN'} onClick={() => setTypeFilter('CIN')}>
              {TYPE_LABELS.CIN}
            </FilterChip>
          </div>
        </header>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Projeler</h2>
          {loading ? (
            /* Skeletons match the column-scroll container below so the loading
               state doesn't flash as a stacked grid on mobile. */
            <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
              {pipeline.map((s) => (
                <Skeleton key={s} className="h-64 w-72 shrink-0 rounded-xl sm:w-64" />
              ))}
            </div>
          ) : (
            <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
              {pipeline.map((stage, i) => (
                <KanbanColumn
                  key={stage}
                  stage={STAGE_LABELS[stage]}
                  color={COLUMN_PASTELS[i % COLUMN_PASTELS.length]}
                  items={grouped[stage] ?? []}
                  onOpen={(p) => navigate(`/projects/${p.id}`)}
                  renderItem={(p) => <ProjectCard project={p} />}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Siparişler</h2>
          {ordersLoading ? (
            <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
              {ORDER_STEPS.map((s) => (
                <Skeleton key={s} className="h-64 w-72 shrink-0 rounded-xl sm:w-64" />
              ))}
            </div>
          ) : (
            <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
              {ORDER_STEPS.map((step, i) => (
                <KanbanColumn
                  key={step}
                  stage={ORDER_STEP_LABELS[step]}
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

function KanbanColumn({ stage, color, items, onOpen, renderItem, emptyIcon: EmptyIcon = Inbox }) {
  return (
    <section
      className="flex w-72 2xl:w-80 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/30"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <header
        className="flex items-center justify-between border-b px-3 py-2.5"
        style={{ backgroundColor: color }}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{stage}</h2>
          <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
            {items.length}
          </span>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {items.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed bg-background/60 p-6 text-center text-xs text-muted-foreground">
            <EmptyIcon className="mx-auto mb-1 h-5 w-5" />
            Boş
          </div>
        ) : (
          items.map((item) => (
            <Card
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label="detayları aç"
              className="cursor-pointer transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              onClick={() => onOpen(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(item)
                }
              }}
            >
              <CardContent className="space-y-2 p-3">{renderItem(item)}</CardContent>
            </Card>
          ))
        )}
      </div>
    </section>
  )
}

function ProjectCard({ project: p }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-semibold leading-tight">{p.title}</p>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {TYPE_LABELS[p.type]}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <AssigneeAvatars assignees={p.assignees} size="h-5 w-5" text="text-[9px]" />
        <span className="truncate">{p.assigned_name}</span>
      </div>
    </>
  )
}

function OrderCard({ order: o }) {
  const quantity = o.quantity ?? (o.items ?? []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
  return (
    <>
      <p className="line-clamp-2 text-sm font-semibold leading-tight">
        {o.project_title?.replace(/ \/ /g, ' ')}
      </p>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{o.requested_by_name}</span>
        {quantity > 0 && <span className="shrink-0 font-medium text-foreground">{formatNumber(quantity)} adet</span>}
      </div>
    </>
  )
}
