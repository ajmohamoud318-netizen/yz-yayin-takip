import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThumbsUp, ThumbsDown, Inbox, Send, ShoppingCart, Eye } from 'lucide-react'

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
import BaskiOnayFormDialog from '@/components/BaskiOnayFormDialog'
import TalepSignDialog, { TalepHistoryViewer } from '@/components/TalepSignDialog'
import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import { canRejectAtStage, isDemoApprover, isOzalitApprover, ozalitLeaderApproved } from '@/domain'
import { formatTargetDate, formatNumber } from '@/lib/utils'

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
  const [baskiOnayForm, setBaskiOnayForm] = useState(null)

  // Sipariş queue (printer's sign-off step: tasarimci_onay → matbaa_onay)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [signOrder, setSignOrder] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)

  const isPrinter = user?.role === 'printer'
  const isLeader = user?.role === 'team_leader'
  const isDesigner = user?.role === 'designer'
  // Demo approvals: leader OR printer. Ozalit approvals are multi-party:
  // every leader AND every assigned designer must approve. Baskı Onayı is
  // team_leader only — the same person who may edit the form itself.
  const canActOnDemo = isLeader || isPrinter
  const canActOnOzalit = isLeader || isDesigner

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
      // Designers only act on ozalit (multi-party), never demo.
      if (sub === 'demo') {
        if (!isLeader) return false
        // A held demo has no pending action — it's waiting on the designer to
        // finish and re-send — so it doesn't belong in the approval queue.
        if (p.demo_held === true) return false
        return p.stage === 'demo_onay' || p.stage === 'cin_demo_onay'
      }
      if (sub === 'ozalit') {
        if (p.stage !== 'ozalit_onay') return false
        if (isLeader) return true
        // Designer: only their assigned projects.
        return (p.assignees ?? []).some((a) => a.id === user?.id)
      }
      // Baskı Onayı: dual-approval (prepare, then a different leader
      // approves — migration 045), team_leader only either way.
      if (sub === 'baski-onay') {
        return isLeader && p.stage === 'baski_onay'
      }
      return false
    })

  const demoQueue = useMemo(() => filterQueue('demo'), [projects, isPrinter])
  const ozalitQueue = useMemo(() => filterQueue('ozalit'), [projects, isPrinter])
  const baskiOnayQueue = useMemo(() => filterQueue('baski-onay'), [projects, isPrinter, isLeader])

  function onDone() {}

  function handleOrderSigned(updated) {
    setOrders((prev) => prev.filter((r) => r.id !== updated.id))
    setSignOrder(null)
  }

  // Designers only have the ozalit queue — force them onto it. Baskı Onayı
  // is team_leader only, so it's never a printer/designer's active tab.
  const activeTab = isDesigner
    ? 'ozalit'
    : (tab === 'ozalit' || (tab === 'baski-onay' && isLeader)) ? tab : 'demo'

  // Sipariş tab is printer-only
  if (tab === 'siparis' && isPrinter) {
    return (
      <>
        <div className="space-y-5">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Baskı Teslimi</h1>
          </header>

          {ordersLoading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : orders.length === 0 ? (
            <Card>
              <CardContent className="grid place-items-center gap-2 p-10 text-center">
                <ShoppingCart className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Onay bekleyen baskı yok.</p>
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
      <div className="stagger-children grid grid-cols-1 gap-3 md:grid-cols-2">
        {queue.map((p) => {
          const isAssignedDesigner = (p.assignees ?? []).some((a) => a.id === user?.id)
          const alreadyApproved = sub === 'ozalit' && (p.ozalit_approvals ?? []).some((a) => a.id === user?.id)
          const canApprove = sub === 'demo' ? isLeader : (isLeader || isAssignedDesigner)
          // Ozalit is leader-first: an assigned designer's Onayla only opens
          // once a team leader has signed off (the server refuses it before
          // that). The card stays in their queue so they can watch it move.
          const awaitingLeader =
            sub === 'ozalit' && isDesigner && !alreadyApproved && !ozalitLeaderApproved(p)
          const heldDemo = sub === 'demo' && p.demo_held === true
          return (
          <Card
            key={p.id}
            className="cursor-pointer transition-colors hover:bg-muted/40"
            onClick={() => navigate(`/projects/${p.id}`)}
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold sm:line-clamp-1">{p.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {p.assigned_name} · {formatTargetDate(p.target_month)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline">{TYPE_LABELS[p.type]}</Badge>
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
                <span className="font-medium">Aşama:</span> {STAGE_LABELS[p.stage]}
              </div>
              {/* Action row — stacks below sm on mobile, row on tablet+.
                  stopPropagation keeps action clicks from also triggering the
                  card's own navigate-to-detail handler. */}
              <div
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                onClick={(e) => e.stopPropagation()}
              >
                {isPrinter ? (
                  <>
                    <Button
                      size="sm"
                      className="w-full sm:flex-1"
                      onClick={() => {
                        if (sub === 'demo') setDemoForm({ project: p, mode: 'advance' })
                        else setOzalitForm({ project: p, mode: 'advance' })
                      }}
                    >
                      <Send className="h-4 w-4" />
                      {sub === 'demo' ? "Demo'yu Teslim Et" : 'Ozaliti Teslim Et'}
                    </Button>
                    <Button size="sm" variant="ghost" className="w-full sm:flex-1" onClick={() => navigate(`/projects/${p.id}`)}>
                      Detay
                    </Button>
                  </>
                ) : heldDemo && isLeader ? (
                  <>
                    {/* Held demo: nothing to approve/reject until the designer
                        re-sends. Kept in the queue for visibility. */}
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 sm:flex-1">
                      Tasarım tamamlanmadı, tasarımcı yeni demo gönderecek
                    </span>
                    <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => navigate(`/projects/${p.id}`)}>
                      Detay
                    </Button>
                  </>
                ) : (
                  <>
                    {alreadyApproved ? (
                      // This user already signed off — waiting on the others.
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 sm:flex-1">
                        <ThumbsUp className="h-3.5 w-3.5" />
                        Onayınız kaydedildi, diğer onaylar bekleniyor
                      </span>
                    ) : awaitingLeader ? (
                      // Designer, leader hasn't approved yet — not their turn.
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 sm:flex-1">
                        Ekip lideri onayı bekleniyor, sonra sizin onayınız
                      </span>
                    ) : canApprove ? (
                      <Button
                        size="sm"
                        variant="success"
                        className="w-full sm:flex-1"
                        onClick={() => {
                          if (sub === 'ozalit') setOzalitForm({ project: p, mode: 'approve' })
                          else if (sub === 'baski-onay') setBaskiOnayForm({ project: p, mode: 'approve' })
                          else setDialog({ project: p, mode: 'approve' })
                        }}
                      >
                        <ThumbsUp className="h-4 w-4" />
                        {/* Dual-approval (migration 045): the card's button
                            just opens the dialog, but the label should say
                            which half is owed — the dialog itself decides
                            Hazırla vs Onayla the same way (baski_onay_prepared). */}
                        {sub === 'baski-onay' ? (p.baski_onay_prepared ? 'Onayla' : 'Formu Hazırla') : 'Onayla'}
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs font-medium text-muted-foreground sm:flex-1">
                        Onay bekleniyor
                      </span>
                    )}
                    {/* Only a team leader who hasn't approved yet can reject —
                        approving commits them, so Reddet disappears afterward.
                        Baskı Onayı has no reject flow: edit the form itself. */}
                    {isLeader && !alreadyApproved && sub !== 'baski-onay' && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full sm:flex-1"
                        onClick={() => setDialog({ project: p, mode: 'reject' })}
                      >
                        <ThumbsDown className="h-4 w-4" />
                        Reddet
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => navigate(`/projects/${p.id}`)}>
                      Detay
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{isPrinter ? 'Matbaa Teslimleri' : 'Onaylar'}</h1>
        </header>

        <Tabs value={activeTab} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <TabsList>
            {/* Designers only approve ozalit — no demo tab for them. */}
            {!isDesigner && (
              <TabsTrigger value="demo" className="gap-1.5">
                Demo Onayı
                {demoQueue.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                    {demoQueue.length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="ozalit" className="gap-1.5">
              Ozalit Onayı
              {ozalitQueue.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                  {ozalitQueue.length}
                </Badge>
              )}
            </TabsTrigger>
            {/* Baskı Onayı: team_leader only — the final sign-off after ozalit. */}
            {isLeader && (
              <TabsTrigger value="baski-onay" className="gap-1.5">
                Baskı Onayı
                {baskiOnayQueue.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                    {baskiOnayQueue.length}
                  </Badge>
                )}
              </TabsTrigger>
            )}
          </TabsList>
          {!isDesigner && (
            <TabsContent value="demo" className="mt-4">
              {renderQueue(demoQueue, 'demo')}
            </TabsContent>
          )}
          <TabsContent value="ozalit" className="mt-4">
            {renderQueue(ozalitQueue, 'ozalit')}
          </TabsContent>
          {isLeader && (
            <TabsContent value="baski-onay" className="mt-4">
              {renderQueue(baskiOnayQueue, 'baski-onay')}
            </TabsContent>
          )}
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
      <BaskiOnayFormDialog
        open={!!baskiOnayForm}
        onOpenChange={(v) => setBaskiOnayForm(v ? baskiOnayForm : null)}
        project={baskiOnayForm?.project}
        mode={baskiOnayForm?.mode ?? 'approve'}
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
            <p className="line-clamp-2 text-sm font-semibold sm:line-clamp-1">
              {order.project_title?.replace(/ \/ /g, ' ')}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Talep eden: {order.requested_by_name} · {date}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">
            Baskı Ozalit İsteniyor
          </Badge>
        </div>

        {items.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span key={item.name} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                {item.name}
                <span className="font-normal text-primary/70">· {formatNumber(item.quantity)}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm">{formatNumber(order.quantity)} adet</p>
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
            Teslim Et
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
