import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import AppShell from '@/components/AppShell'
import FilterChip from '@/components/FilterChip'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
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
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [stageGroup, setStageGroup] = useState('all')

  const mine = useMemo(
    () => projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user?.id)),
    [projects, user?.id],
  )

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
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Projelerim</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {rows.length} proje listeleniyor · {mine.length} toplam atama
          </p>
        </header>

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
    </AppShell>
  )
}
