import { useMemo, useState } from 'react'
import { Inbox } from 'lucide-react'

import { useProjects } from '@/hooks/useProjects'
import { useProjectModal } from '@/hooks/useProjectModal'
import FilterChip from '@/components/FilterChip'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { STAGE_LABELS, STAGE_PIPELINE, TYPE_LABELS } from '@/api'
import AssigneeAvatars from '@/components/AssigneeAvatars'

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
  const { openProject } = useProjectModal()
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

  return (
    <>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pano</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tüm projeleri aşamaya göre yan yana görüntüleyin.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
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

        {loading ? (
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {pipeline.map((s) => (
              <Skeleton key={s} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="scrollbar-thin -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {pipeline.map((stage, i) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                color={COLUMN_PASTELS[i % COLUMN_PASTELS.length]}
                items={grouped[stage] ?? []}
                onOpen={(p) => openProject(p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function KanbanColumn({ stage, color, items, onOpen }) {
  return (
    <section
      className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/30"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <header
        className="flex items-center justify-between border-b px-3 py-2.5"
        style={{ backgroundColor: color }}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{STAGE_LABELS[stage]}</h2>
          <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
            {items.length}
          </span>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {items.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed bg-background/60 p-6 text-center text-xs text-muted-foreground">
            <Inbox className="mx-auto mb-1 h-5 w-5" />
            Boş
          </div>
        ) : (
          items.map((p) => (
            <Card
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`${p.title} – detayları aç`}
              className="cursor-pointer transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              onClick={() => onOpen(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(p)
                }
              }}
            >
              <CardContent className="space-y-2 p-3">
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
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </section>
  )
}
