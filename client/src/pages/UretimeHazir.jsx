import { useEffect, useState } from 'react'
import { Factory, ArrowRight, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'

import api, { TYPE_LABELS, STAGE_LABELS } from '@/api'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ConfirmDialog'

const cleanTitle = (t) => String(t ?? '').replace(/ \/ /g, ' ')

/**
 * Matbaa (printer) page: projects whose ozalit is fully approved and are now
 * resting at "Üretime Hazır". The printer takes each one into production
 * ("Üretime Al"), which moves it to Üretimde.
 */
export default function UretimeHazir() {
  const { updateOne } = useProjectsStore()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  // Project awaiting the "Üretime alınsın mı?" confirmation (null = dialog closed).
  const [confirmProject, setConfirmProject] = useState(null)

  useEffect(() => {
    api.listProjects()
      .then((projs) => setProjects(projs.filter((p) => p.stage === 'uretime_hazir')))
      .finally(() => setLoading(false))
  }, [])

  async function takeToProduction(project) {
    setSavingId(project.id)
    try {
      const updated = await api.advanceProject(project.id)
      updateOne(updated)
      setProjects((prev) => prev.filter((p) => p.id !== project.id))
      setConfirmProject(null)
      toast.success(`${cleanTitle(project.title)} üretime alındı.`)
    } catch (err) {
      toast.error(err?.message || 'Üretime alınamadı.')
    } finally {
      setSavingId(null)
    }
  }

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
            <Factory className="h-4 w-4" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Üretime Hazır</h1>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Bekleyen, {projects.length} proje
        </h2>
        {projects.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <PackageCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Üretime alınmayı bekleyen proje yok.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {projects.map((p) => (
              <Card key={p.id} className="transition-colors hover:border-primary/30">
                {/* Phones: full title + full-width action stacked; ≥sm one line. */}
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Factory className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug sm:truncate">{cleanTitle(p.title)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {STAGE_LABELS[p.stage] ?? p.stage} · ozalit onaylandı
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 self-start text-[10px] sm:self-auto">{TYPE_LABELS[p.type] ?? p.type}</Badge>
                  <Button size="sm" className="w-full sm:w-auto" onClick={() => setConfirmProject(p)} disabled={savingId === p.id}>
                    <ArrowRight className="h-3.5 w-3.5" />
                    {savingId === p.id ? 'Alınıyor…' : 'Üretime Al'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirmProject}
        onOpenChange={(v) => !v && setConfirmProject(null)}
        title="Projeyi üretime almak istediğinize emin misiniz?"
        description={
          confirmProject
            ? `"${cleanTitle(confirmProject.title)}" adlı proje üretime alınacak ve "Üretimde" aşamasına geçirilecektir. İşlemi onaylıyor musunuz?`
            : undefined
        }
        confirmLabel="Üretime Al"
        busyLabel="Alınıyor…"
        busy={!!confirmProject && savingId === confirmProject.id}
        onConfirm={() => confirmProject && takeToProduction(confirmProject)}
      />
    </div>
  )
}
