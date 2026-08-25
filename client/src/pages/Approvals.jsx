import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { ThumbsUp, ThumbsDown, Inbox, Send, ShoppingCart, CheckCircle2, PackageCheck } from 'lucide-react'

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
import ConfirmDialog from '@/components/ConfirmDialog'
import TalepSignDialog from '@/components/TalepSignDialog'
import EkranDemoRejectDialog from '@/components/EkranDemoRejectDialog'
import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import {
  canRejectAtStage, isDemoApprover, isOzalitApprover, ozalitLeaderApproved,
  canRequestEkranDemo, canRespondEkranDemo, canRespondDemoChange, canRespondOzalitChange,
  canMarkDemoStarted, canMarkOzalitStarted,
} from '@/domain'
import { formatTargetDate, formatNumber } from '@/lib/utils'

/**
 * Approval queue — demo/ozalit tabs for the design pipeline, plus a sipariş
 * tab for the printer (matbaa) showing orders that need their sign-off.
 */
export default function Approvals({ tab = 'demo' }) {
  const { user } = useAuth()
  const { projects, loading, updateOne } = useProjects()
  const navigate = useNavigate()
  const location = useLocation()
  const [dialog, setDialog] = useState(null)
  const [demoForm, setDemoForm] = useState(null)
  const [ozalitForm, setOzalitForm] = useState(null)
  const [baskiOnayForm, setBaskiOnayForm] = useState(null)
  // Ekran Demo Onayı — the lightweight digital respond/request buttons a
  // held-at-100% demo card offers (mirrors ProjectDetail.jsx).
  const [ekranDemoRejectFor, setEkranDemoRejectFor] = useState(null) // project | null
  const [ekranBusyId, setEkranBusyId] = useState(null)
  // Matbaa "İşlemi Başlatın" — mirrors ProjectDetail's start-work gate so the
  // list and detail views enforce the same rule: Teslim Et stays hidden until
  // the matbaa has flagged the work started.
  const [startConfirm, setStartConfirm] = useState(null)
  const [startingWork, setStartingWork] = useState(false)

  // Sipariş queue (printer's sign-off step: tasarimci_onay → matbaa_onay)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [signOrder, setSignOrder] = useState(null)

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

  // A tasarimci_onay push/bell tap lands here with ?order=<id> — the printer
  // works form-first, so open TalepSignDialog straight away instead of
  // leaving them to find the right card's "Teslim Edin" button. Strip the
  // param once consumed so a later re-render (or the dialog re-opening after
  // close) doesn't fire it again.
  useEffect(() => {
    if (!isPrinter || tab !== 'siparis' || orders.length === 0) return
    const params = new URLSearchParams(location.search)
    const orderId = params.get('order')
    if (!orderId) return
    const match = orders.find((o) => o.id === orderId)
    params.delete('order')
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
    if (match) setSignOrder(match)
  }, [isPrinter, tab, orders, location.search, location.pathname, navigate])

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
        if (p.stage !== 'demo_onay' && p.stage !== 'cin_demo_onay') return false
        // A held demo below 100% progress has no pending action yet — it's
        // waiting on the designer to finish. But once progress hits 100%
        // there's something to do again (respond to a pending Ekran Demo
        // Onayı request, request one, or a manual resend) — dropping it here
        // regardless of progress silently hid it from the queue forever,
        // with no way back in short of visiting the project page directly.
        if (p.demo_held === true && (p.progress ?? 0) < 100) return false
        return true
      }
      if (sub === 'ozalit') {
        if (p.stage !== 'ozalit_onay') return false
        if (isLeader) return true
        // Designer: only their assigned projects.
        return (p.assignees ?? []).some((a) => a.id === user?.id)
      }
      // Baskı Onayı: dual-approval (prepare, then a different leader
      // approves — migration 045), team_leader only either way. Includes
      // ÇİN's mirror gate (cin_baski_onay, migration 047) — same dialog,
      // same rule, distinguished only by the row's own type badge.
      if (sub === 'baski-onay') {
        return isLeader && (p.stage === 'baski_onay' || p.stage === 'cin_baski_onay')
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

  // The printer's "İşlemi Başlatın" (and a change-request accept/decline)
  // don't move the order out of tasarimci_onay — they only flip flags the
  // dialog itself gates on: Teslim Edin stays hidden until ozalit_started.
  // Without this handler the matbaa pressed Başlatın, got the toast, and the
  // button never appeared — `signOrder` is a snapshot and this page loads its
  // list once, so nothing here ever saw the update (every other
  // TalepSignDialog mount already wires onUpdated).
  //
  // Merged, not replaced: the mutation routes return order_requests' own
  // columns only, without the list query's joined project_title /
  // requested_by_name / order_history — same contract as TeslimOnaylari's
  // handover confirm.
  function handleOrderUpdated(updated) {
    setOrders((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
    setSignOrder((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev))
  }

  async function handleEkranDemoRequest(project) {
    setEkranBusyId(project.id)
    try {
      const updated = await api.requestEkranDemoOnay(project.id)
      updateOne(updated)
      toast.success('Ekran demo onayı istendi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setEkranBusyId(null)
    }
  }

  async function handleEkranDemoApprove(project) {
    setEkranBusyId(project.id)
    try {
      const updated = await api.approveEkranDemo(project.id)
      updateOne(updated)
      toast.success('Ekran demo onaylandı.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setEkranBusyId(null)
    }
  }

  async function handleStartWork() {
    if (!startConfirm) return
    setStartingWork(true)
    try {
      const updated = startConfirm.sub === 'demo'
        ? await api.markDemoStarted(startConfirm.project.id)
        : await api.markOzalitStarted(startConfirm.project.id)
      updateOne(updated)
      toast.success(startConfirm.sub === 'demo' ? 'Demo çalışmasına başladığınız işaretlendi.' : 'Ozalit çalışmasına başladığınız işaretlendi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setStartingWork(false)
      setStartConfirm(null)
    }
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
          onUpdated={handleOrderUpdated}
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
          // Demo/ozalit both gate their sign-off behind a "Teslim Alındı" —
          // when that's still owed the button is a receipt step, not an
          // approval, so it loses the green/thumbs-up treatment too.
          const receiptFirst = awaitsReceipt(sub, p)
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
                    {/* Teslim Et stays hidden until the matbaa has pressed
                        İşlemi Başlat — same rule as the detail page
                        (canMarkDemoStarted/canMarkOzalitStarted) — and while a
                        change request is pending, since the server refuses
                        delivery until the matbaa accepts/declines it
                        (computeDemoTeslimAdvance/computeOzalitTeslimAdvance).
                        The accept/decline buttons only live on the detail
                        page, so send them there instead of failing a submit. */}
                    {(sub === 'demo' ? canRespondDemoChange(user, p) : canRespondOzalitChange(user, p)) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full sm:flex-1"
                        onClick={() => navigate(`/projects/${p.id}`)}
                      >
                        <Send className="h-4 w-4" />
                        Değişiklik talebini yanıtlayın
                      </Button>
                    ) : (sub === 'demo' ? p.demo_started : p.ozalit_started) ? (
                      <Button
                        size="sm"
                        className="w-full sm:flex-1"
                        onClick={() => {
                          if (sub === 'demo') setDemoForm({ project: p, mode: 'advance' })
                          else setOzalitForm({ project: p, mode: 'advance' })
                        }}
                      >
                        <Send className="h-4 w-4" />
                        {sub === 'demo' ? "Demo'yu Teslim Edin" : 'Ozaliti Teslim Edin'}
                      </Button>
                    ) : (sub === 'demo' ? canMarkDemoStarted(user, p) : canMarkOzalitStarted(user, p)) ? (
                      <Button
                        size="sm"
                        className="w-full sm:flex-1"
                        onClick={() => setStartConfirm({ project: p, sub })}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        İşlemi Başlatın
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" className="w-full sm:flex-1" onClick={() => navigate(`/projects/${p.id}`)}>
                      Detay
                    </Button>
                  </>
                ) : heldDemo && isLeader ? (
                  // A held demo only reaches this queue once progress hits
                  // 100% (see filterQueue) — there's always something
                  // actionable here: either respond to a pending Ekran Demo
                  // Onayı request, or offer to start one (canRequestEkranDemo
                  // covers the rest: stage/hold/progress already hold).
                  canRespondEkranDemo(user, p) ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        onClick={() => setEkranDemoRejectFor(p)}
                        disabled={ekranBusyId === p.id}
                      >
                        <ThumbsDown className="h-4 w-4" />
                        Reddet
                      </Button>
                      <Button
                        size="sm"
                        variant="success"
                        className="flex-1"
                        onClick={() => handleEkranDemoApprove(p)}
                        disabled={ekranBusyId === p.id}
                      >
                        <ThumbsUp className="h-4 w-4" />
                        Ekran Demoyu Onaylayın
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleEkranDemoRequest(p)}
                        disabled={ekranBusyId === p.id}
                      >
                        <Send className="h-4 w-4" />
                        Ekran Demo Onayı İsteyin
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => navigate(`/projects/${p.id}`)}>
                        Detay
                      </Button>
                    </>
                  )
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
                        variant={receiptFirst ? 'default' : 'success'}
                        className="w-full sm:flex-1"
                        onClick={() => {
                          if (sub === 'ozalit') setOzalitForm({ project: p, mode: 'approve' })
                          else if (sub === 'baski-onay') setBaskiOnayForm({ project: p, mode: 'approve' })
                          else setDialog({ project: p, mode: 'approve' })
                        }}
                      >
                        {receiptFirst ? <PackageCheck className="h-4 w-4" /> : <ThumbsUp className="h-4 w-4" />}
                        {/* The card's button just opens the dialog, but the
                            label names the step the dialog will actually ask
                            for: taking delivery first (demo_received /
                            ozalit_received), or — for dual-approval baskı
                            onayı (migration 045) — Hazırla vs Onayla, decided
                            the same way the dialog does (baski_onay_prepared). */}
                        {primaryActionLabel(sub, p)}
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
                        {sub === 'ozalit' ? 'Ozaliti Reddedin' : 'Demoyu Reddedin'}
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
        advanceLabel="Onaya Gönderin"
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
      <EkranDemoRejectDialog
        open={!!ekranDemoRejectFor}
        onOpenChange={(v) => !v && setEkranDemoRejectFor(null)}
        project={ekranDemoRejectFor}
        onDone={() => setEkranDemoRejectFor(null)}
      />
      <ConfirmDialog
        open={!!startConfirm}
        onOpenChange={(v) => !v && setStartConfirm(null)}
        title={startConfirm?.sub === 'demo' ? 'Demo çalışmasına başladınız mı?' : 'Ozalit çalışmasına başladınız mı?'}
        description="Bundan sonra ekip lideri veya tasarımcının iptal ya da düzenleme yapması, sizin onayınızı gerektiren bir değişiklik talebine dönüşür."
        confirmLabel="İşlemi Başlatın"
        variant="success"
        busy={startingWork}
        onConfirm={handleStartWork}
      />
    </>
  )
}

/**
 * Is the physical proof still un-received? Both the demo dialog
 * (ApprovalDialog) and the ozalit form (SpecFormDialog) refuse to sign off
 * until it's been marked "Teslim Alındı", so the card's button leads with
 * that step instead of an "Onaylayın" that can't be honoured yet.
 */
function awaitsReceipt(sub, p) {
  if (sub === 'demo') return p.demo_received !== true
  if (sub === 'ozalit') return p.ozalit_received !== true
  return false
}

/**
 * The action the row actually owes, spelled out. Every queue card used to
 * read "Onaylayın"/"Reddedin" regardless of what the dialog would ask for
 * next — taking delivery, preparing the baskı onay form, or the sign-off
 * itself — so the label now names the step and the queue reads as a to-do
 * list. Mirrors ProjectDetail's approveActionLabel plus the receipt gates.
 */
function primaryActionLabel(sub, p) {
  if (sub === 'baski-onay') return p.baski_onay_prepared ? 'Baskı Onayı Verin' : 'Baskı Onayı Hazırlayın'
  if (sub === 'ozalit') return awaitsReceipt(sub, p) ? 'Ozaliti Teslim Alın' : 'Ozaliti Onaylayın'
  return awaitsReceipt(sub, p) ? 'Demoyu Teslim Alın' : 'Demoyu Onaylayın'
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function SiparisOrderCard({ order, onSign }) {
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
          <Button size="sm" className="flex-1" onClick={onSign}>
            Teslim Edin
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
