import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, Package, Eye, Inbox, FileText } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import TalepSignDialog, { TalepHistoryViewer } from '@/components/TalepSignDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import { canApproveMatbaaOnayNow, isOrderAssignedToDesigner } from '@/domain/constants/orders'
import { cn, formatNumber } from '@/lib/utils'

export default function SiparisOnay() {
  const { user } = useAuth()
  const { projects } = useProjects()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [signOrder, setSignOrder] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)
  const [ozalitProject, setOzalitProject] = useState(null) // real Ozalit Üretim Formu

  // Open the real Ozalit Üretim Formu for the order's project.
  async function openOzalit(order) {
    try {
      const project = await api.getProject(order.project_id)
      setOzalitProject(project)
    } catch {
      toast.error('Ozalit formu açılamadı.')
    }
  }

  // Fallback only — see isOrderAssignedToDesigner. Orders carry their own
  // assignee list; this covers legacy rows written before that was populated.
  const myProjectIds = useMemo(
    () => new Set(projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user?.id)).map((p) => p.id)),
    [projects, user?.id],
  )

  useEffect(() => {
    api.listOrderRequests()
      .then((reqs) => {
        setOrders(reqs.filter((r) => {
          if (!isOrderAssignedToDesigner(r, user?.id, myProjectIds)) return false
          if (r.status === 'goruldu') return true
          // matbaa_onay is multi-party — stay in the queue until THIS
          // designer has approved, even if a leader already has.
          if (r.status === 'matbaa_onay') {
            return !(r.matbaa_approvals ?? []).some((a) => a.id === user?.id)
          }
          return false
        }))
      })
      .finally(() => setLoading(false))
  }, [myProjectIds, user?.id])

  function handleSigned(updated) {
    setOrders((prev) => prev.filter((r) => r.id !== updated.id))
    setSignOrder(null)
  }

  // "Teslim Alındı" doesn't remove the order from the queue — it just
  // updates the held order in place so the card's button flips to "Onayla"
  // (see TalepSignDialog's onUpdated contract; the dialog itself closes).
  function handleUpdated(updated) {
    setOrders((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    setSignOrder(updated)
  }

  return (
    <>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Baskı Onayı</h1>
        </header>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="grid place-items-center gap-2 p-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Onay bekleyen baskı yok.</p>
              <p className="text-xs text-muted-foreground">
                Ekip lideri bir talebi onayına gönderdiğinde burada görünecek.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <DesignerOrderCard
                key={order.id}
                order={order}
                onSign={() => setSignOrder(order)}
                onView={() => setViewOrder(order)}
                onOzalit={() => openOzalit(order)}
              />
            ))}
          </div>
        )}
      </div>

      <TalepSignDialog
        order={signOrder}
        open={!!signOrder}
        onOpenChange={(v) => !v && setSignOrder(null)}
        onSigned={handleSigned}
        onUpdated={handleUpdated}
      />
      <TalepHistoryViewer
        order={viewOrder}
        open={!!viewOrder}
        onOpenChange={(v) => !v && setViewOrder(null)}
      />
      <OzalitFormDialog
        open={!!ozalitProject}
        onOpenChange={(v) => !v && setOzalitProject(null)}
        project={ozalitProject}
        mode="view"
      />
    </>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function DesignerOrderCard({ order, onSign, onView, onOzalit }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const items = normalizeItems(order.items, order.quantity)
  const date = order.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(order.created_at))
    : '—'

  // Find the görüldü step to show who signed it
  const gorulduStep = (order.order_history ?? []).find((h) => h.step === 'goruldu')
  // matbaa_onay is a different action from goruldu's "review and forward" —
  // this designer is here to approve a delivered ozalit, not edit the spec.
  const isMatbaaOnay = order.status === 'matbaa_onay'
  // Leader-first: once the ozalit is received, a designer can't approve
  // until a team leader already has (see canApproveMatbaaOnayNow). Hide
  // "Onayla" rather than show a button that just bounces off the dialog's
  // own gate.
  const signLabel = !isMatbaaOnay ? 'İncele ve Gönder' : !order.matbaa_received ? 'Teslim Al' : 'Onayla'
  const canAct = !isMatbaaOnay || !order.matbaa_received || canApproveMatbaaOnayNow(user, order)

  return (
    <Card
      tabIndex={0}
      aria-label={`${order.project_title} – proje detaylarını aç`}
      className="cursor-pointer border-amber-200 transition-colors hover:border-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => navigate(`/projects/${order.project_id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/projects/${order.project_id}`)
        }
      }}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <Package className="h-5 w-5 text-amber-600" />
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="font-semibold leading-snug">
              {order.project_title?.replace(/ \/ /g, ' ')}
            </p>
            <p className="text-sm text-muted-foreground">
              Talep eden: {order.requested_by_name} · {date}
            </p>

            {items.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {items.map((item) => (
                  <span
                    key={item.name}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
                  >
                    {item.name}
                    <span className="font-normal text-primary/70">
                      · {formatNumber(item.quantity)}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">{formatNumber(order.quantity)} adet</p>
            )}

            {order.notes && (
              <p className="text-xs text-muted-foreground">Not: {order.notes}</p>
            )}

            {gorulduStep && (
              <p className="text-xs text-blue-600">
                ✓ {gorulduStep.signed_by_name} tarafından görüldü
                {gorulduStep.notes ? `, "${gorulduStep.notes}"` : ''}
              </p>
            )}
          </div>

          <div className="flex w-full flex-col items-end gap-2 sm:w-auto sm:shrink-0">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[11px]">
              {isMatbaaOnay ? 'Matbaa Onayı Bekliyor' : 'Onay Bekliyor'}
            </Badge>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onView() }}>
                <Eye className="h-3.5 w-3.5" />
                Talep
              </Button>
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onOzalit() }}>
                <FileText className="h-3.5 w-3.5" />
                Ozalit Formu
              </Button>
              {canAct ? (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); onSign() }}>
                  {signLabel}
                </Button>
              ) : (
                <span className="flex items-center px-2.5 text-xs text-muted-foreground">
                  Lider onayı bekleniyor
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
