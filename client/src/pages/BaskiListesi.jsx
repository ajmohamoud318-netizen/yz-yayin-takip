import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, Factory, Ship, PackageCheck } from 'lucide-react'

import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTargetDate } from '@/lib/utils'

const cleanTitle = (t) => String(t ?? '').replace(/ \/ /g, ' ')

/**
 * Baskı Listesi — the print queue.
 *
 * Scope is deliberately identical to the sidebar's `counts.production` badge
 * (AppShell: `p.stage === 'uretimde' || p.stage === 'gumruk'`). Both read the
 * same ProjectsProvider array, so the number on the nav and the number of rows
 * here cannot drift apart. If you widen one, widen the other.
 *
 * Gümrük is CIN-only — the TR pipeline runs uretimde → satista with no customs
 * leg — so that section simply stays empty on a TR-only board.
 */
const QUEUE_STAGES = ['uretimde', 'gumruk']

const SECTIONS = [
  {
    stage: 'uretimde',
    icon: Factory,
    blurb: 'Matbaada basılıyor.',
  },
  {
    stage: 'gumruk',
    icon: Ship,
    blurb: 'Çin baskısı yolda — gümrük sürecinde.',
  },
]

/** Earliest target date first; projects with no target date sink to the bottom. */
function byTargetDate(a, b) {
  const ta = a.target_month ? new Date(a.target_month).getTime() : Infinity
  const tb = b.target_month ? new Date(b.target_month).getTime() : Infinity
  if (ta !== tb) return ta - tb
  return cleanTitle(a.title).localeCompare(cleanTitle(b.title), 'tr')
}

function assigneeNames(p) {
  return (p.assignees ?? []).map((a) => a.name).filter(Boolean).join(', ') || p.assigned_name || ''
}

function ProjectRow({ project, icon: Icon, onOpen }) {
  const names = assigneeNames(project)
  return (
    <Card className="transition-colors hover:border-primary/30">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <button
          type="button"
          onClick={() => onOpen(project.id)}
          className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <p className="truncate text-sm font-semibold leading-snug">{cleanTitle(project.title)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {STAGE_LABELS[project.stage] ?? project.stage}
            {names && ` · ${names}`}
          </p>
        </button>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatTargetDate(project.target_month)}
        </span>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {TYPE_LABELS[project.type] ?? project.type}
        </Badge>
      </CardContent>
    </Card>
  )
}

export default function BaskiListesi() {
  const { projects, loading } = useProjectsStore()
  const navigate = useNavigate()

  const queue = useMemo(
    () => projects.filter((p) => QUEUE_STAGES.includes(p.stage)).sort(byTargetDate),
    [projects],
  )

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Skeleton className="h-9 w-64" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <div className="mb-2 inline-flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Printer className="h-4 w-4" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Baskı Listesi</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Şu anda üretimde olan ve gümrükte bekleyen projeler. Hedef tarihi en yakın olan üstte.
        </p>
      </header>

      {queue.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <PackageCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Baskıda bekleyen proje yok.</p>
          </CardContent>
        </Card>
      ) : (
        SECTIONS.map(({ stage, icon, blurb }) => {
          const rows = queue.filter((p) => p.stage === stage)
          if (rows.length === 0) return null
          return (
            <section key={stage} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {STAGE_LABELS[stage]} — {rows.length} proje
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground/80">{blurb}</p>
              </div>
              <div className="space-y-2.5">
                {rows.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    icon={icon}
                    onOpen={(id) => navigate(`/projects/${id}`)}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
