import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { cn, formatTargetDate } from '@/lib/utils'

const STAGE_GROUPS = {
  all: 'Tümü',
  active: 'Devam Eden',
  waiting: 'Onay Bekliyor',
}

export default function MyProjects() {
  const { user } = useAuth()
  const { projects, loading } = useProjects()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [stageGroup, setStageGroup] = useState('all')

  // Sipariş queue: orders at 'goruldu' for projects assigned to this designer
  const [siparisQueue, setSiparisQueue] = useState([])
  const [signOrder, setSignOrder] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)

  // Filter to projects this designer is assigned to. Today only the
  // legacy `projects.assigned_to` column is the source of truth on the
  // server (the /api/projects list endpoint hydrates an `assignees`
  // array from it), but we also fall back to `assigned_to` so a stale
  // or older list payload still routes the project here correctly.
  const mine = useMemo(
    () => projects.filter((p) => {
      if ((p.assignees ?? []).some((a) => a.id === user?.id)) return true
      if (p.assigned_to && p.assigned_to === user?.id) return true
      return false
    }),
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
    const filtered = mine.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      if (stageGroup === 'active' && p.stage === 'satista') return false
      if (stageGroup === 'waiting') {
        const waiting = ['demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'cin_demo_teslim', 'cin_demo_onay']
        if (!waiting.includes(p.stage)) return false
      }
      if (!q) return true
      return p.title.toLowerCase().includes(q)
    })
    // Newest assignments on top. created_at is ISO; lexicographic compare = chronological.
    return [...filtered].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }, [mine, query, typeFilter, stageGroup])

  return (
    <>
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl 3xl:max-w-[88rem] space-y-6 2xl:space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Projelerim</h1>
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
            <div className="flex w-full max-w-sm 2xl:max-w-md items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring">
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
            {/* Card-on-mobile: below sm the table is replaced with a list of
              cards so each row fits a 360px screen. Above sm the table
              scrolls horizontally with min-width. */}
            <div className="space-y-2 sm:hidden">
            {rows.map((p) => {
              const meta = STATUS_META[statusKeyForProject(p)]
              return (
                <Card
                  key={p.id}
                  tabIndex={0}
                  aria-label={`${p.title} – detayları aç`}
                  className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => navigate(`/projects/${p.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(`/projects/${p.id}`)
                    }
                  }}
                >
                  <CardContent className="space-y-2 p-3.5">
                    <div className="flex items-start gap-2">
                      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                      <p className="text-sm font-semibold leading-snug">{p.title}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{TYPE_LABELS[p.type]} · {STAGE_LABELS[p.stage]} · {p.assigned_name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={p.progress} className="h-1.5 flex-1" indicatorClassName={meta.dot} />
                      <span className="font-mono text-xs tabular-nums">{p.progress}%</span>
                    </div>
                    {p.target_month && (
                      <p className="text-[11px] text-muted-foreground/80">Hedef: {p.target_month}</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <div className="hidden overflow-x-auto sm:block">
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
                        onClick={() => navigate(`/projects/${p.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            navigate(`/projects/${p.id}`)
                          }
                        }}
                        aria-label={`${p.title} – detayları aç`}
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
                          {p.target_month ? formatTargetDate(p.target_month) : '—'}
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
          <div className="flex w-full shrink-0 flex-col items-stretch gap-1.5 sm:w-auto sm:items-end">
            <Badge variant="outline" className="self-start bg-blue-50 text-blue-700 border-blue-200 text-[10px] sm:self-auto">
              {ORDER_STEP_LABELS.goruldu}
            </Badge>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 flex-1 px-2 sm:flex-none" onClick={onView}>
                <Eye className="h-3.5 w-3.5" />
                <span className="sr-only">Form</span>
              </Button>
              <Button size="sm" className="h-7 flex-1 px-2.5 sm:flex-none" onClick={onSign}>
                <PenLine className="h-3.5 w-3.5" />
                İncele ve Gönder
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
