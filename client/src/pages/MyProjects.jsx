import { useEffect, useMemo, useState } from 'react'
import { useProjectModal } from '@/hooks/useProjectModal'
import { Search, ShoppingCart, Package, PenLine, Eye } from 'lucide-react'

import api, { ORDER_STEP_LABELS } from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import FilterChip from '@/components/FilterChip'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import TalepSignDialog, { TalepHistoryViewer } from '@/components/TalepSignDialog'
import { STAGE_LABELS, STATUS_META, TYPE_LABELS, statusKeyForProject } from '@/api'
import { cn, formatMonthYear } from '@/lib/utils'

const STAGE_GROUPS = {
  all: 'Tümü',
  active: 'Devam Eden',
  waiting: 'Onay Bekliyor',
}

export default function MyProjects() {
  const { user } = useAuth()
  const { projects, loading } = useProjects()
  const { openProject } = useProjectModal()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [stageGroup, setStageGroup] = useState('all')

  // Sipariş queue: orders at 'goruldu' for projects assigned to this designer
  const [siparisQueue, setSiparisQueue] = useState([])
  const [signOrder, setSignOrder] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)

  const mine = useMemo(
    () => projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user?.id)),
    [projects, user?.id],
  )

  const myProjectIds = useMemo(() => new Set(mine.map((p) => p.id)), [mine])

  useEffect(() => {
    if (user?.role !== 'designer') return
    api.listOrderRequests().then((reqs) => {
      // Designer signs orders that are at 'goruldu' status for their projects
      const relevant = reqs.filter(
        (r) => r.status === 'goruldu' && myProjectIds.has(r.project_id),
      )
      setSiparisQueue(relevant)
    }).catch(() => {})
  }, [user?.role, myProjectIds])

  function handleOrderSigned(updated) {
    setSiparisQueue((prev) => prev.filter((r) => r.id !== updated.id))
    setSignOrder(null)
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mine.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      if (stageGroup === 'active' && p.stage === 'satista') return false
      if (stageGroup === 'waiting') {
        const waiting = ['demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'cin_demo_teslim', 'cin_demo_onay']
        if (!waiting.includes(p.stage)) return false
      }
      if (!q) return true
      return p.title.toLowerCase().includes(q)
    })
  }, [mine, query, typeFilter, stageGroup])

  return (
    <>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Projelerim</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {rows.length} proje listeleniyor · {mine.length} toplam atama
          </p>
        </header>

        {/* Sipariş onay queue — shown only when there are pending orders */}
        {siparisQueue.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-amber-700">
                Sipariş Onayı Bekliyor — {siparisQueue.length} talep
              </h2>
            </div>
            <div className="space-y-2">
              {siparisQueue.map((order) => (
                <SiparisOrderRow
                  key={order.id}
                  order={order}
                  onSign={() => setSignOrder(order)}
                  onView={() => setViewOrder(order)}
                />
              ))}
            </div>
          </section>
        )}

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex w-full max-w-sm items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Proje ara…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(STAGE_GROUPS).map(([key, label]) => (
                <FilterChip key={key} active={stageGroup === key} onClick={() => setStageGroup(key)}>
                  {label}
                </FilterChip>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
                Tüm Türler
              </FilterChip>
              <FilterChip active={typeFilter === 'TR'} onClick={() => setTypeFilter('TR')}>
                {TYPE_LABELS.TR}
              </FilterChip>
              <FilterChip active={typeFilter === 'CIN'} onClick={() => setTypeFilter('CIN')}>
                {TYPE_LABELS.CIN}
              </FilterChip>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center">
            <p className="text-sm font-medium text-foreground">
              {mine.length === 0 ? 'Henüz atanmış projeniz yok.' : 'Bu filtreye uygun proje bulunamadı.'}
            </p>
            {mine.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Ayşenur size bir proje atadığında burada görünecek.</p>
            )}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Proje</th>
                    <th className="px-4 py-2.5 font-medium">Tür</th>
                    <th className="px-4 py-2.5 font-medium">Aşama</th>
                    <th className="px-4 py-2.5 font-medium w-40">İlerleme</th>
                    <th className="px-4 py-2.5 font-medium">Hedef Ay</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const meta = STATUS_META[statusKeyForProject(p)]
                    return (
                      <tr
                        key={p.id}
                        tabIndex={0}
                        onClick={() => openProject(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openProject(p.id)
                          }
                        }}
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                            <span className="font-medium text-foreground">{p.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                            {TYPE_LABELS[p.type]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1 text-xs font-medium', meta.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                            {STAGE_LABELS[p.stage]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Progress value={p.progress} className="h-1.5 w-24" indicatorClassName={meta.dot} />
                            <span className="text-xs font-medium tabular-nums text-foreground">
                              {p.progress}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {p.target_month ? formatMonthYear(p.target_month) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <TalepSignDialog
        order={signOrder}
        open={!!signOrder}
        onOpenChange={(v) => !v && setSignOrder(null)}
        onSigned={handleOrderSigned}
      />
      <TalepHistoryViewer
        order={viewOrder}
        open={!!viewOrder}
        onOpenChange={(v) => !v && setViewOrder(null)}
      />
    </>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function SiparisOrderRow({ order, onSign, onView }) {
  const items = normalizeItems(order.items, order.quantity)
  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-start gap-3">
          <Package className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {order.project_title?.replace(/ \/ /g, ' ')}
            </p>
            <p className="text-xs text-muted-foreground">
              Talep eden: {order.requested_by_name}
            </p>
            {items.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px]">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-amber-700/70">· {item.quantity.toLocaleString('tr-TR')}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-xs font-medium">{order.quantity?.toLocaleString('tr-TR')} adet</p>
            )}
            {order.notes && <p className="mt-0.5 text-xs text-muted-foreground">{order.notes}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
              {ORDER_STEP_LABELS.goruldu}
            </Badge>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onView}>
                <Eye className="h-3.5 w-3.5" />
                <span className="sr-only">Form</span>
              </Button>
              <Button size="sm" className="h-7 px-2.5" onClick={onSign}>
                <PenLine className="h-3.5 w-3.5" />
                Onayladım
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
