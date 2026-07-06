import { useEffect, useState } from 'react'
import { PackageCheck, Truck, CheckCircle2, Clock, Send } from 'lucide-react'
import { toast } from 'sonner'

import api, { TYPE_LABELS, STAGE_LABELS, canRequestHandover } from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { cn } from '@/lib/utils'

const cleanTitle = (t) => String(t ?? '').replace(/ \/ /g, ' ')
const fmtDate = (iso) =>
  iso ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '—'

/**
 * Matbaa (printer) page: raise a handover ("teslim") request for a project whose
 * production is finished (TR: Üretimde, ÇİN: Gümrük). Sales confirms receipt to
 * push the project to Satışta.
 */
export default function TeslimTalepleri() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [handovers, setHandovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  // Project awaiting the "Teslim talebi oluşturulsun mu?" confirmation.
  const [confirmProject, setConfirmProject] = useState(null)

  useEffect(() => {
    Promise.all([api.listProjects(), api.listHandovers()])
      .then(([projs, hs]) => {
        setProjects(projs)
        setHandovers(hs)
      })
      .finally(() => setLoading(false))
  }, [])

  const pendingByProject = new Set(handovers.filter((h) => h.status === 'pending').map((h) => h.project_id))
  const eligible = projects.filter((p) => canRequestHandover(p) && !pendingByProject.has(p.id))

  async function requestHandover(project) {
    setSavingId(project.id)
    try {
      const created = await api.createHandover({
        projectId: project.id,
        creator: user ? { id: user.id, name: user.name, role: user.role } : null,
      })
      setHandovers((prev) => [created, ...prev])
      setConfirmProject(null)
      toast.success('Teslim talebi oluşturuldu — satış ekibi onayını bekliyor.')
    } catch (err) {
      toast.error(err?.message || 'Teslim talebi oluşturulamadı.')
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
    <div className="mx-auto max-w-7xl space-y-8">
      <header>
        <div className="mb-2 inline-flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Truck className="h-4 w-4" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Teslim Talepleri</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Üretimi tamamlanan ürünler için satış ekibine teslim talebi oluşturun. Satış "Alındı" dediğinde ürün otomatik olarak satışa çıkar.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Eligible for handover */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Teslim Edilebilir — {eligible.length} ürün
          </h2>
          {eligible.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                Teslim talebi oluşturulabilecek ürün yok.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {eligible.map((p) => (
                <Card key={p.id} className="transition-colors hover:border-primary/30">
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pink-50 text-pink-600">
                      <PackageCheck className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-snug">{cleanTitle(p.title)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {STAGE_LABELS[p.stage] ?? p.stage} · üretim tamamlandı
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{TYPE_LABELS[p.type] ?? p.type}</Badge>
                    <Button size="sm" onClick={() => setConfirmProject(p)} disabled={savingId === p.id}>
                      <Send className="h-3.5 w-3.5" />
                      {savingId === p.id ? 'Gönderiliyor…' : 'Teslim Talebi Oluştur'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* My handover requests */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Gönderilen Talepler</h2>
          {handovers.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                Henüz teslim talebi göndermediniz.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-2.5">
              {handovers.map((h) => (
                <HandoverRow key={h.id} handover={h} />
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={!!confirmProject}
        onOpenChange={(v) => !v && setConfirmProject(null)}
        title="Teslim talebi oluşturulsun mu?"
        description={
          confirmProject
            ? `"${cleanTitle(confirmProject.title)}" için satış ekibine teslim talebi gönderilecek. Devam edilsin mi?`
            : undefined
        }
        confirmLabel="Teslim Talebi Oluştur"
        busyLabel="Gönderiliyor…"
        busy={!!confirmProject && savingId === confirmProject.id}
        onConfirm={() => confirmProject && requestHandover(confirmProject)}
      />
    </div>
  )
}

function HandoverRow({ handover: h }) {
  const received = h.status === 'received'
  return (
    <Card className={cn(received && 'border-emerald-200')}>
      <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full',
            received ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
          )}
        >
          {received ? <CheckCircle2 className="h-4.5 w-4.5" /> : <Clock className="h-4.5 w-4.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{cleanTitle(h.project_title)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {received
              ? `${h.received_by_name} teslim aldı · ${fmtDate(h.received_at)}`
              : `Oluşturuldu · ${fmtDate(h.created_at)}`}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 text-[11px]',
            received ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
          )}
        >
          {received ? 'Teslim Alındı' : 'Onay Bekliyor'}
        </Badge>
      </CardContent>
    </Card>
  )
}
