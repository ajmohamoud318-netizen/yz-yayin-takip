import { useEffect, useMemo, useState } from 'react'
import { ShoppingCart, Package, PenLine, Eye, Inbox, FileText } from 'lucide-react'
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
import { cn } from '@/lib/utils'

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

  // Projects assigned to this designer
  const myProjectIds = useMemo(
    () => new Set(projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user?.id)).map((p) => p.id)),
    [projects, user?.id],
  )

  useEffect(() => {
    api.listOrderRequests()
      .then((reqs) => {
        setOrders(reqs.filter((r) => r.status === 'goruldu' && myProjectIds.has(r.project_id)))
      })
      .finally(() => setLoading(false))
  }, [myProjectIds])

  function handleSigned(updated) {
    setOrders((prev) => prev.filter((r) => r.id !== updated.id))
    setSignOrder(null)
  }

  return (
    <>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Sipariş Onayı</h1>
        </header>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="grid place-items-center gap-2 p-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Onay bekleyen sipariş yok.</p>
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
  const items = normalizeItems(order.items, order.quantity)
  const date = order.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(order.created_at))
    : '—'

  // Find the görüldü step to show who signed it
  const gorulduStep = (order.order_history ?? []).find((h) => h.step === 'goruldu')

  return (
    <Card className="border-amber-200">
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
                      · {item.quantity.toLocaleString('tr-TR')}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium">{order.quantity?.toLocaleString('tr-TR')} adet</p>
            )}

            {order.notes && (
              <p className="text-xs text-muted-foreground">Not: {order.notes}</p>
            )}

            {gorulduStep && (
              <p className="text-xs text-blue-600">
                ✓ {gorulduStep.signed_by_name} tarafından görüldü
                {gorulduStep.notes ? ` — "${gorulduStep.notes}"` : ''}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[11px]">
              Onay Bekliyor
            </Badge>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={onView}>
                <Eye className="h-3.5 w-3.5" />
                Talep
              </Button>
              <Button size="sm" variant="outline" onClick={onOzalit}>
                <FileText className="h-3.5 w-3.5" />
                Ozalit Formu
              </Button>
              <Button size="sm" onClick={onSign}>
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
