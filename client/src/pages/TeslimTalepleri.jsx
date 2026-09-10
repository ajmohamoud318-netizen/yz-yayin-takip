import { useEffect, useMemo, useState } from 'react'
import { Package, PackageCheck, Truck, CheckCircle2, Clock, Send } from 'lucide-react'
import { toast } from 'sonner'

import api, {
  TYPE_LABELS, STAGE_LABELS, canRequestHandover, canRequestOrderHandover,
} from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import OrderNoBadge from '@/components/OrderNoBadge'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { cn, formatNumber } from '@/lib/utils'

const cleanTitle = (t) => String(t ?? '').replace(/ \/ /g, ' ')
const fmtDate = (iso) =>
  iso ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '—'

/**
 * Matbaa (printer) page: raise a handover ("teslim") request.
 *
 * Two lists, because there are two kinds of teslim (migration 081):
 *
 *   • PROJECTS whose own production is finished (TR: Baskıda, ÇİN: Gümrük).
 *     Sales confirming one pushes the project to Satışta.
 *   • SİPARİŞLER — reprints — whose run cleared baskı onayı while the title
 *     was already at or past baskıda. Their approval deliberately did not move
 *     the project's stage, so the project list above can never show them, and
 *     before this page listed them the copies had no way to reach satış at
 *     all. Sales confirming one closes the ORDER and leaves the stage alone.
 *
 * The two lists never describe the same copies: an order is always an
 * ADDITIONAL print run, so a title can legitimately appear in both — its own
 * first run, and a reprint — as two cards for two deliveries.
 */
export default function TeslimTalepleri() {
  const [projects, setProjects] = useState([])
  const [orders, setOrders] = useState([])
  const [handovers, setHandovers] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  // The card awaiting the "Teslim talebi oluşturulsun mu?" confirmation.
  // `{ id, title, kind: 'project'|'order', ... }` — see `eligible` / `reprints`.
  const [confirmTarget, setConfirmTarget] = useState(null)

  useEffect(() => {
    Promise.all([api.listProjects(), api.listOrderRequests(), api.listHandovers()])
      .then(([projs, ords, hs]) => {
        setProjects(projs)
        setOrders(ords)
        setHandovers(hs)
      })
      .finally(() => setLoading(false))
  }, [])

  // Scoped to the PROJECT's own teslim rows (order_id null). A reprint's
  // pending teslim must not hide the project's, and vice versa — they are
  // different deliveries, which is exactly why migration 081 split the
  // uniqueness guard in two.
  const pendingByProject = useMemo(
    () => new Set(
      handovers.filter((h) => h.status === 'pending' && !h.order_id).map((h) => h.project_id),
    ),
    [handovers],
  )
  const handledOrderIds = useMemo(
    // Any row at all, pending or received: a run is handed over once.
    () => new Set(handovers.map((h) => h.order_id).filter(Boolean)),
    [handovers],
  )
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const eligible = projects.filter((p) => canRequestHandover(p) && !pendingByProject.has(p.id))
  const reprints = useMemo(
    () => orders
      .filter((o) => !handledOrderIds.has(o.id))
      .filter((o) => canRequestOrderHandover(o))
      .map((o) => ({ ...o, project: projectById.get(o.project_id) }))
      // A soft-deleted project (migration 020's `deleted_at`) is filtered out
      // of listProjects but its orders survive, so this join can miss. Drop
      // those rather than render a card with no title on it — the matbaa
      // cannot deliver a book the page cannot name, and the server would
      // refuse the raise anyway (`Proje bulunamadı.`).
      .filter((o) => !!o.project),
    [orders, handledOrderIds, projectById],
  )

  async function requestHandover(target) {
    setSavingId(target.id)
    try {
      const created = await api.createHandover(
        target.kind === 'order' ? { orderId: target.id } : { projectId: target.id },
      )
      setHandovers((prev) => [created, ...prev])
      setConfirmTarget(null)
      toast.success('Teslim talebi oluşturuldu, satış ekibi onayını bekliyor.')
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
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Eligible for handover */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Teslim Edilebilir, {eligible.length} ürün
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
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pink-50 text-pink-600">
                      <PackageCheck className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug sm:truncate">{cleanTitle(p.title)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {STAGE_LABELS[p.stage] ?? p.stage} · üretim tamamlandı
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 self-start text-[10px] sm:self-auto">{TYPE_LABELS[p.type] ?? p.type}</Badge>
                    <Button
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => setConfirmTarget({ ...p, kind: 'project' })}
                      disabled={savingId === p.id}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {savingId === p.id ? 'Gönderiliyor…' : 'Teslim Talebi Oluşturun'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Reprints (migration 081). Their project is already at or past
              baskıda, so it can never appear in the list above — this is the
              only place their teslim can be raised. Rendered inside the same
              column, under its own heading, because it is the same job. */}
          {reprints.length > 0 && (
            <div className="space-y-3 pt-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Yeni Baskılar, {reprints.length} sipariş
              </h2>
              <div className="grid gap-3">
                {reprints.map((o) => (
                  <Card key={o.id} className="border-violet-200 transition-colors hover:border-primary/30">
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
                        <Package className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug sm:truncate">
                          {cleanTitle(o.project?.title)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <OrderNoBadge order={o} className="mr-1.5" />
                          Baskı tamamlandı
                          {o.quantity ? ` · ${formatNumber(o.quantity)} adet` : ''}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 self-start border-violet-200 bg-violet-50 text-[10px] text-violet-700 sm:self-auto"
                      >
                        Yeni Baskı
                      </Badge>
                      <Button
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => setConfirmTarget({
                          id: o.id, kind: 'order', title: o.project?.title,
                        })}
                        disabled={savingId === o.id}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {savingId === o.id ? 'Gönderiliyor…' : 'Teslim Talebi Oluşturun'}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
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
        open={!!confirmTarget}
        onOpenChange={(v) => !v && setConfirmTarget(null)}
        title="Teslim talebi oluşturulsun mu?"
        description={
          confirmTarget
            // The two say different things on confirmation, so they say
            // different things here: a project teslim puts the book on sale, a
            // reprint's hands over extra copies of a book already selling.
            ? confirmTarget.kind === 'order'
              ? `"${cleanTitle(confirmTarget.title)}" yeni baskısı için satış ekibine teslim talebi gönderilecek. Devam edilsin mi?`
              : `"${cleanTitle(confirmTarget.title)}" için satış ekibine teslim talebi gönderilecek. Devam edilsin mi?`
            : undefined
        }
        confirmLabel="Teslim Talebi Oluşturun"
        busyLabel="Gönderiliyor…"
        busy={!!confirmTarget && savingId === confirmTarget.id}
        onConfirm={() => confirmTarget && requestHandover(confirmTarget)}
      />
    </div>
  )
}

function HandoverRow({ handover: h }) {
  const received = h.status === 'received'
  const isReprint = !!h.order_id
  return (
    <Card className={cn(received && 'border-emerald-200')}>
      <CardContent className="flex flex-col gap-3 p-3.5 sm:flex-row sm:flex-wrap sm:items-center">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full',
            received ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
          )}
        >
          {received ? <CheckCircle2 className="h-4.5 w-4.5" /> : <Clock className="h-4.5 w-4.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium sm:truncate">
            {cleanTitle(h.project_title)}
            {isReprint && (
              <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                yeni baskı
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {/* `confirmed_by_name` / `confirmed_at` are what GET /handovers
                actually returns — the old `received_*` names matched no column,
                so every completed row read "undefined teslim aldı · —". */}
            {isReprint && <OrderNoBadge order={h} className="mr-1.5" />}
            {received
              ? `${h.confirmed_by_name ?? '—'} teslim aldı · ${fmtDate(h.confirmed_at)}`
              : `Oluşturuldu · ${fmtDate(h.created_at)}`}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'self-start text-[11px] sm:self-auto',
            received ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
          )}
        >
          {received ? 'Teslim Alındı' : 'Onay Bekliyor'}
        </Badge>
      </CardContent>
    </Card>
  )
}
