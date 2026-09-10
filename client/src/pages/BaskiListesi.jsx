import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, Factory, Ship, PackageCheck } from 'lucide-react'

import api, { STAGE_LABELS, TYPE_LABELS } from '@/api'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { Card, CardContent } from '@/components/ui/card'
import OrderNoBadge from '@/components/OrderNoBadge'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTargetDate } from '@/lib/utils'

const cleanTitle = (t) => String(t ?? '').replace(/ \/ /g, ' ')

/**
 * Baskı Listesi — the print queue.
 *
 * Scope is deliberately identical to the sidebar's `counts.production` badge
 * (AppShell: `p.stage === 'baskida' || p.stage === 'gumruk'`). Both read the
 * same ProjectsProvider array, so the number on the nav and the number of rows
 * here cannot drift apart. If you widen one, widen the other.
 *
 * Gümrük is CIN-only — the TR pipeline runs baskida → satista with no customs
 * leg — so that section simply stays empty on a TR-only board.
 */
const QUEUE_STAGES = ['baskida', 'gumruk']

const SECTIONS = [
  {
    stage: 'baskida',
    icon: Factory,
    blurb: 'Matbaada basılıyor.',
  },
  {
    stage: 'gumruk',
    icon: Ship,
    blurb: 'Çin baskısı yolda, gümrük sürecinde.',
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
      {/* Phones: the title/status wrap freely and the date + type move under
          them — truncating the book name to fit a date on one line is the
          wrong trade on a 390px screen. ≥sm keeps the single-line row. */}
      <CardContent className="flex items-start gap-3 p-4 sm:items-center">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <button
          type="button"
          onClick={() => onOpen(project.id)}
          className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <p className="text-sm font-semibold leading-snug sm:truncate">{cleanTitle(project.title)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground sm:truncate">
            {STAGE_LABELS[project.stage] ?? project.stage}
            {names && ` · ${names}`}
          </p>
          <p className="mt-1.5 flex items-center gap-2 sm:hidden">
            <Badge variant="outline" className="text-[10px]">
              {TYPE_LABELS[project.type] ?? project.type}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {formatTargetDate(project.target_month)}
            </span>
          </p>
        </button>
        <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">
          {formatTargetDate(project.target_month)}
        </span>
        <Badge variant="outline" className="hidden shrink-0 text-[10px] sm:inline-flex">
          {TYPE_LABELS[project.type] ?? project.type}
        </Badge>
      </CardContent>
    </Card>
  )
}

export default function BaskiListesi() {
  const { projects, loading } = useProjectsStore()
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])

  useEffect(() => {
    let cancelled = false
    api.listOrderRequests()
      .then((rows) => { if (!cancelled) setOrders(Array.isArray(rows) ? rows : []) })
      // Transient: reprints are additive to the stage-driven queue below, so a
      // failed load hides that section rather than breaking the page.
      .catch(() => { if (!cancelled) setOrders([]) })
    return () => { cancelled = true }
  }, [])

  const queue = useMemo(
    () => projects.filter((p) => QUEUE_STAGES.includes(p.stage)).sort(byTargetDate),
    [projects],
  )

  /**
   * Reprints in production on a title this list cannot otherwise show.
   *
   * The stage-driven queue above cannot see them, and no amount of widening it
   * would help: the flip to `baskida` is forward-only, so re-ordering a book
   * that is already `satista` leaves the project exactly where it is. That is
   * correct — the book really is on sale — but it meant a sipariş could run the
   * entire pipeline and reach the matbaa as silence, printed by nobody because
   * it appeared on no queue anywhere.
   *
   * Scoped to orders whose PROJECT is not already listed above: when a first
   * print run flips its project to `baskida`, the order and the project are the
   * same job, and showing both would have the matbaa printing it twice.
   */
  const queuedProjectIds = useMemo(() => new Set(queue.map((p) => p.id)), [queue])
  const reprints = useMemo(
    () => orders.filter((o) => o.status === 'baskida' && !queuedProjectIds.has(o.project_id)),
    [orders, queuedProjectIds],
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
      </header>

      {reprints.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Yeni Baskılar, {reprints.length} sipariş
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground/80">
              Satıştaki veya baskısı süren kitapların yeni baskı talepleri.
            </p>
          </div>
          <div className="space-y-2.5">
            {reprints.map((o) => (
              <Card key={o.id} className="border-violet-200 transition-colors hover:border-primary/30">
                <CardContent className="flex items-start gap-3 p-4 sm:items-center">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700">
                    <Factory className="h-5 w-5" />
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${o.project_id}`)}
                    className="min-w-0 flex-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="text-sm font-semibold leading-snug sm:truncate">
                      {cleanTitle(o.project_title)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground sm:truncate">
                      <OrderNoBadge order={o} className="mr-1.5" />
                      Yeni baskı · Talep eden: {o.requested_by_name ?? '—'}
                    </p>
                  </button>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-violet-200 bg-violet-50 text-[10px] text-violet-700"
                  >
                    Sipariş
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {queue.length === 0 && reprints.length === 0 ? (
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
                  {STAGE_LABELS[stage]}, {rows.length} proje
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
