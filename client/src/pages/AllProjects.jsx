import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import { useOpenOrdersByProject } from '@/hooks/useOpenOrders'
import FilterChip from '@/components/FilterChip'
import { Card, CardContent } from '@/components/ui/card'
import AssigneeAvatars from '@/components/AssigneeAvatars'
import OrderBadge from '@/components/OrderBadge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  STAGE_LABELS,
  STATUS_META,
  TYPE_LABELS,
  statusKeyForProject,
  groupKeyForProject,
} from '@/api'
import { cn, formatTargetDate } from '@/lib/utils'

const GROUP_LABELS = { all: 'Tümü', yeni_proje: 'Yeni Proje', devam_eden: 'Devam Eden' }

export default function AllProjects() {
  const { projects, allProjects, loading } = useProjects()
  const openOrders = useOpenOrdersByProject()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' })

  // Legacy (Kayıtlı ürünler / backlist) projects are filtered out of the
  // main pipeline list on purpose (see useProjectsStore) to keep ~90 dormant
  // backlist titles out of Tüm Projeler. But once one has an open sipariş
  // it's live work again, so surface it here for the duration of that order.
  const visibleProjects = useMemo(() => {
    const extra = allProjects.filter((p) => p.origin === 'legacy' && openOrders.has(p.id))
    return extra.length ? [...projects, ...extra] : projects
  }, [projects, allProjects, openOrders])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = visibleProjects.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      if (groupFilter !== 'all' && groupKeyForProject(p) !== groupFilter) return false
      if (!q) return true
      return (
        p.title.toLowerCase().includes(q) ||
        (p.assigned_name ?? '').toLowerCase().includes(q)
      )
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      let av
      let bv
      if (sort.key === 'progress') {
        av = a.progress
        bv = b.progress
      } else if (sort.key === 'target_month' || sort.key === 'created_at') {
        av = a[sort.key] ?? ''
        bv = b[sort.key] ?? ''
      } else {
        av = (a[sort.key] ?? '').toString().toLowerCase()
        bv = (b[sort.key] ?? '').toString().toLowerCase()
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return list
  }, [visibleProjects, query, typeFilter, groupFilter, sort])

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  return (
    <>
      <div className="mx-auto max-w-7xl 2xl:max-w-screen-2xl 3xl:max-w-[88rem] space-y-6 2xl:space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tüm Projeler</h1>
          </div>
        </header>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex w-full max-w-sm 2xl:max-w-md items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Proje veya tasarımcı ara…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {['all', 'yeni_proje', 'devam_eden'].map((g) => (
                <FilterChip key={g} active={groupFilter === g} onClick={() => setGroupFilter(g)}>
                  {GROUP_LABELS[g]}
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
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center">
            <p className="text-sm font-medium text-foreground">Bu filtreye uygun proje bulunamadı.</p>
            <p className="mt-1 text-xs text-muted-foreground">Aramayı veya filtreleri değiştirin.</p>
          </div>
        ) : (
          <Card className="overflow-hidden">
            {/* Card-on-mobile (same pattern as MyProjects): below sm the
              table becomes a list of tappable cards; above sm it scrolls
              horizontally with min-width. */}
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
                      <OrderBadge order={openOrders.get(p.id)} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{TYPE_LABELS[p.type]} · {STAGE_LABELS[p.stage]}</span>
                      <span className="ml-auto shrink-0">
                        <AssigneeAvatars assignees={p.assignees} />
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={p.progress} className="h-1.5 flex-1" indicatorClassName={meta.dot} />
                      <span className="font-mono text-xs tabular-nums">{p.progress}%</span>
                    </div>
                    {p.target_month && (
                      <p className="text-[11px] text-muted-foreground/80">Hedef: {formatTargetDate(p.target_month)}</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <Th label="Proje" sortKey="title" sort={sort} onSort={toggleSort} />
                    <th className="px-4 py-2.5 font-medium">Tür</th>
                    <th className="px-4 py-2.5 font-medium">Aşama</th>
                    <th className="px-4 py-2.5 font-medium">Tasarımcı</th>
                    <Th label="İlerleme" sortKey="progress" sort={sort} onSort={toggleSort} className="w-40" />
                    <Th label="Hedef Ay" sortKey="target_month" sort={sort} onSort={toggleSort} />
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
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                            <span className="font-medium text-foreground">{p.title}</span>
                            <OrderBadge order={openOrders.get(p.id)} />
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
                          <AssigneeAvatars assignees={p.assignees} />
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
    </>
  )
}

function Th({ label, sortKey, sort, onSort, className }) {
  const active = sort.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={cn('px-4 py-2.5 font-medium', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'text-foreground' : 'text-muted-foreground/50')} />
      </button>
    </th>
  )
}
