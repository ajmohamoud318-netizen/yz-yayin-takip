import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectModal } from '@/hooks/useProjectModal'
import { ThumbsUp, ThumbsDown, Inbox, Send, ShoppingCart, Eye, PenLine } from 'lucide-react'

import api, { ORDER_STEP_LABELS } from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import ApprovalDialog from '@/components/ApprovalDialog'
import DemoFormDialog from '@/components/DemoFormDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import TalepSignDialog, { TalepHistoryViewer } from '@/components/TalepSignDialog'
import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import { cn, formatMonthYear } from '@/lib/utils'

/**
 * Approval queue — demo/ozalit tabs for the design pipeline, plus a sipariş
 * tab for the printer (matbaa) showing orders that need their sign-off.
 */
export default function Approvals({ tab = 'demo' }) {
  const { user } = useAuth()
  const { projects, loading } = useProjects()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState(null)
  const [demoForm, setDemoForm] = useState(null)
  const [ozalitForm, setOzalitForm] = useState(null)
  const { openProject } = useProjectModal()

  // Sipariş queue (printer's sign-off step: tasarimci_onay → matbaa_onay)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [signOrder, setSignOrder] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)

  const isPrinter = user?.role === 'printer'

  useEffect(() => {
    if (!isPrinter || tab !== 'siparis') return
    setOrdersLoading(true)
    api.listOrderRequests()
      .then((reqs) => setOrders(reqs.filter((r) => r.status === 'tasarimci_onay')))
      .finally(() => setOrdersLoading(false))
  }, [isPrinter, tab])

  const filterQueue = (sub) =>
    projects.filter((p) => {
      if (isPrinter) {
        if (p.type !== 'TR') return false
        if (sub === 'demo') return p.stage === 'demo_teslim'
        // Ozalit reaches the matbaa's queue only once it's been requested by the
        // leader/designer (or on a re-delivery after a reject-to-matbaa).
        if (sub === 'ozalit') return p.stage === 'ozalit_teslim' && (!!p.ozalit_requested || p.reject_target === 'matbaa')
        return false
      }
      if (sub === 'demo') return p.stage === 'demo_onay' || p.stage === 'cin_demo_onay'
      if (sub === 'ozalit') return p.stage === 'ozalit_onay'
      return false
    })

  const demoQueue = useMemo(() => filterQueue('demo'), [projects, isPrinter])
  const ozalitQueue = useMemo(() => filterQueue('ozalit'), [projects, isPrinter])

  function onDone() {}

  function handleOrderSigned(updated) {
    setOrders((prev) => prev.filter((r) => r.id !== updated.id))
    setSignOrder(null)
  }

  const activeTab = tab === 'ozalit' ? 'ozalit' : 'demo'

  // Sipariş tab is printer-only
  if (tab === 'siparis' && isPrinter) {
    return (
      <>
        <div className="space-y-5">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Sipariş Teslimi</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tasarımcı onayından geçen siparişleri alın ve matbaa adına teslim edin.
            </p>
          </header>

          {ordersLoading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : orders.length === 0 ? (
            <Card>
              <CardContent className="grid place-items-center gap-2 p-10 text-center">
                <ShoppingCart className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Onay bekleyen sipariş yok.</p>
                <p className="text-xs text-muted-foreground">Tasarımcı onayladığında burada görünecek.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <SiparisOrderCard
                  key={order.id}
                  order={order}
                  onSign={() => setSignOrder(order)}
                  onView={() => setViewOrder(order)}
                />
              ))}
            </div>
          )}
        </div>

        <TalepSignDialog
          order={signOrder}
          open={!!signOrder}
          onOpenChange={(v) => !v && setSignOrder(null)}
          onSigned={handleOrderSigned}
        />
        <TalepHistoryViewer
          order={viewOrder}
          open={!!viewOrder}
          onOpenChange={(v) => !v && setViewOrder(null)}
        />
      </>
    )
  }

  function renderQueue(queue, sub) {
    if (loading) {
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )
    }
    if (queue.length === 0) {
      return (
        <Card>
          <CardContent className="grid place-items-center gap-2 p-10 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Şu an bekleyen iş yok.</p>
            <p className="text-xs text-muted-foreground">Yeni bir teslim geldiğinde burada görünecek.</p>
          </CardContent>
        </Card>
      )
    }
    return (
      <div className="stagger-children grid gap-3 md:grid-cols-2">
        {queue.map((p) => (
          <Card key={p.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {p.assigned_name} · {formatMonthYear(p.target_month)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline">{TYPE_LABELS[p.type]}</Badge>
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
                <span className="font-medium">Aşama:</span> {STAGE_LABELS[p.stage]}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => openProject(p.id)}
                >
                  Detay
                </Button>
                {isPrinter ? (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (sub === 'demo') setDemoForm({ project: p, mode: 'advance' })
                      else setOzalitForm({ project: p, mode: 'advance' })
                    }}
                  >
                    <Send className="h-4 w-4" />
                    Onaya Gönder
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1"
                      onClick={() => setDialog({ project: p, mode: 'reject' })}
                    >
                      <ThumbsDown className="h-4 w-4" />
                      Reddet
                    </Button>
                    <Button
                      size="sm"
                      variant="success"
                      className="flex-1"
                      onClick={() => {
                        if (sub === 'ozalit') setOzalitForm({ project: p, mode: 'approve' })
                        else setDialog({ project: p, mode: 'approve' })
                      }}
                    >
                      <ThumbsUp className="h-4 w-4" />
                      Onayla
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Onaylar</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isPrinter
              ? 'Demo ve Ozalit teslimlerini alıp lider onayına gönderin.'
              : 'Matbaadan gelen demo ve Ozalit onaylarını tek ekranda değerlendirin.'}
          </p>
        </header>

        <Tabs value={activeTab} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <TabsList>
            <TabsTrigger value="demo" className="gap-1.5">
              Demo Onayı
              {demoQueue.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                  {demoQueue.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ozalit" className="gap-1.5">
              Ozalit Onayı
              {ozalitQueue.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                  {ozalitQueue.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="demo" className="mt-4">
            {renderQueue(demoQueue, 'demo')}
          </TabsContent>
          <TabsContent value="ozalit" className="mt-4">
            {renderQueue(ozalitQueue, 'ozalit')}
          </TabsContent>
        </Tabs>
      </div>

      <ApprovalDialog
        open={!!dialog}
        onOpenChange={(v) => setDialog(v ? dialog : null)}
        project={dialog?.project}
        mode={dialog?.mode ?? 'approve'}
        advanceLabel="Onaya Gönder"
        onDone={onDone}
      />
      <DemoFormDialog
        open={!!demoForm}
        onOpenChange={(v) => setDemoForm(v ? demoForm : null)}
        project={demoForm?.project}
        mode={demoForm?.mode ?? 'advance'}
        onDone={onDone}
      />
      <OzalitFormDialog
        open={!!ozalitForm}
        onOpenChange={(v) => setOzalitForm(v ? ozalitForm : null)}
        project={ozalitForm?.project}
        mode={ozalitForm?.mode ?? 'approve'}
        onDone={onDone}
      />
    </>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function SiparisOrderCard({ order, onSign, onView }) {
  const items = normalizeItems(order.items, order.quantity)
  const date = order.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(order.created_at))
    : '—'

  return (
    <Card className="border-violet-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {order.project_title?.replace(/ \/ /g, ' ')}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Talep eden: {order.requested_by_name} · {date}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">
            Sipariş Ozalit İsteniyor
          </Badge>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span key={item.name} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                {item.name}
                <span className="font-normal text-primary/70">· {item.quantity.toLocaleString('tr-TR')}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm">{order.quantity?.toLocaleString('tr-TR')} adet</p>
        )}

        {order.notes && (
          <p className="text-xs text-muted-foreground">Not: {order.notes}</p>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="flex-1" onClick={onView}>
            <Eye className="h-3.5 w-3.5" />
            Formu Görüntüle
          </Button>
          <Button size="sm" className="flex-1" onClick={onSign}>
            <PenLine className="h-3.5 w-3.5" />
            Teslim Et
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
