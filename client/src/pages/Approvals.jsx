import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ThumbsUp, ThumbsDown, Inbox, Send, ShoppingCart, CheckCircle2, PackageCheck,
  ClipboardCheck, Hourglass, Eye, ArrowRight,
} from 'lucide-react'

import api from '@/api'
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
import TalepSignDialog from '@/components/TalepSignDialog'
import EkranDemoRejectDialog from '@/components/EkranDemoRejectDialog'
import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import {
  canRejectAtStage, isDemoApprover, isOzalitApprover, ozalitLeaderApproved,
  canRequestEkranDemo, canRespondEkranDemo, canRespondDemoChange, canRespondOzalitChange,
  canMarkDemoStarted, canMarkOzalitStarted,
} from '@/domain'
import { cn, formatTargetDate, formatNumber } from '@/lib/utils'

/**
 * Approval queue — demo/ozalit/baskı-onay tabs for the design pipeline, plus
 * a sipariş tab for the printer (matbaa) showing orders that need sign-off.
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
  // the matbaa has flagged the work started. The flag is stamped from inside
  // the spec form (opened read-only for the printer), never from a bare
  // confirm — the printer has to see the sheet they're committing to.
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

  async function handleStartWork(project, sub) {
    if (!project) return
    setStartingWork(true)
    try {
      const updated = sub === 'demo'
        ? await api.markDemoStarted(project.id)
        : await api.markOzalitStarted(project.id)
      updateOne(updated)
      toast.success(sub === 'demo' ? 'Demo çalışmasına başladığınız işaretlendi.' : 'Ozalit çalışmasına başladığınız işaretlendi.')
      // Close the sheet they started from — the row behind it flips to
      // "Teslim Edin", which reopens the same form to deliver.
      if (sub === 'demo') setDemoForm(null)
      else setOzalitForm(null)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setStartingWork(false)
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
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader
            icon={ClipboardCheck}
            title="Baskı Teslimi"
            subtitle="Tasarımcının onayladığı siparişleri matbaa olarak imzalayın."
          />

          {ordersLoading ? (
            <div className="space-y-2.5">
              {[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="Onay bekleyen baskı yok."
              hint="Tasarımcı onayladığında burada görünecek."
            />
          ) : (
            <div className="space-y-2.5">
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
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )
    }
    if (queue.length === 0) {
      return (
        <EmptyState
          icon={Inbox}
          title="Şu an bekleyen iş yok."
          hint="Yeni bir teslim geldiğinde burada görünecek."
        />
      )
    }
    return (
      <div className="stagger-children space-y-2.5">
        {queue.map((p) => (
          <ApprovalRow
            key={p.id}
            project={p}
            sub={sub}
            user={user}
            isLeader={isLeader}
            isDesigner={isDesigner}
            isPrinter={isPrinter}
            ekranBusy={ekranBusyId === p.id}
            onApprove={() => {
              if (sub === 'ozalit') setOzalitForm({ project: p, mode: 'approve' })
              else if (sub === 'baski-onay') setBaskiOnayForm({ project: p, mode: 'approve' })
              else setDialog({ project: p, mode: 'approve' })
            }}
            onReject={() => setDialog({ project: p, mode: 'reject' })}
            onAdvance={() => {
              if (sub === 'demo') setDemoForm({ project: p, mode: 'advance' })
              else setOzalitForm({ project: p, mode: 'advance' })
            }}
            onStartWork={() => {
              // Review-then-start: the spec form opens (read-only for the
              // printer) with "İşlemi Başlatın" in its footer.
              if (sub === 'demo') setDemoForm({ project: p, mode: 'view', startWork: true })
              else setOzalitForm({ project: p, mode: 'view', startWork: true })
            }}
            onEkranRequest={() => handleEkranDemoRequest(p)}
            onEkranApprove={() => handleEkranDemoApprove(p)}
            onEkranReject={() => setEkranDemoRejectFor(p)}
            onNavigate={() => navigate(`/projects/${p.id}`)}
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto max-w-5xl 2xl:max-w-6xl space-y-6 2xl:space-y-8">
        <PageHeader
          icon={ClipboardCheck}
          title={isPrinter ? 'Matbaa Teslimleri' : 'Onaylar'}
          subtitle={
            isPrinter
              ? 'Demo ve ozalit teslim adımlarını yönetin.'
              : 'Demo, ozalit ve baskı onaylarını tek yerden yönetin.'
          }
        />

        <Tabs value={activeTab} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <TabsList>
            {/* Designers only approve ozalit — no demo tab for them. */}
            {!isDesigner && (
              <TabsTrigger value="demo">
                Demo Onayı
                {demoQueue.length > 0 && <CountBadge count={demoQueue.length} />}
              </TabsTrigger>
            )}
            <TabsTrigger value="ozalit">
              Ozalit Onayı
              {ozalitQueue.length > 0 && <CountBadge count={ozalitQueue.length} />}
            </TabsTrigger>
            {/* Baskı Onayı: team_leader only — the final sign-off after ozalit. */}
            {isLeader && (
              <TabsTrigger value="baski-onay">
                Baskı Onayı
                {baskiOnayQueue.length > 0 && <CountBadge count={baskiOnayQueue.length} />}
              </TabsTrigger>
            )}
          </TabsList>
          {!isDesigner && (
            <TabsContent value="demo" className="mt-5">
              {renderQueue(demoQueue, 'demo')}
            </TabsContent>
          )}
          <TabsContent value="ozalit" className="mt-5">
            {renderQueue(ozalitQueue, 'ozalit')}
          </TabsContent>
          {isLeader && (
            <TabsContent value="baski-onay" className="mt-5">
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
        onStartWork={demoForm?.startWork ? () => handleStartWork(demoForm.project, 'demo') : undefined}
        startingWork={startingWork}
        onDone={onDone}
      />
      <OzalitFormDialog
        open={!!ozalitForm}
        onOpenChange={(v) => setOzalitForm(v ? ozalitForm : null)}
        project={ozalitForm?.project}
        mode={ozalitForm?.mode ?? 'approve'}
        onStartWork={ozalitForm?.startWork ? () => handleStartWork(ozalitForm.project, 'ozalit') : undefined}
        startingWork={startingWork}
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
    </>
  )
}

/* ───────────────────────── shared bits ───────────────────────── */

/**
 * Is the physical proof still un-received? Both the demo dialog
 * (ApprovalDialog) and the ozalit form (SpecFormDialog) refuse to sign off
 * until it's been marked "Teslim Alındı", so the row leads with that step
 * instead of an "Onaylayın" that can't be honoured yet.
 */
function awaitsReceipt(sub, p) {
  if (sub === 'demo') return p.demo_received !== true
  if (sub === 'ozalit') return p.ozalit_received !== true
  return false
}

/**
 * The action the row actually owes, spelled out. Every queue row used to read
 * "Onaylayın"/"Reddedin" regardless of what the dialog would ask for next —
 * taking delivery, preparing the baskı onay form, or the sign-off itself — so
 * the label now names the step and the queue reads as a to-do list. Mirrors
 * ProjectDetail's approveActionLabel plus the receipt gates.
 */
function primaryActionLabel(sub, p) {
  if (sub === 'baski-onay') return p.baski_onay_prepared ? 'Baskı Onayı Verin' : 'Baskı Onayı Hazırlayın'
  if (sub === 'ozalit') return awaitsReceipt(sub, p) ? 'Ozaliti Teslim Alın' : 'Ozaliti Onaylayın'
  return awaitsReceipt(sub, p) ? 'Demoyu Teslim Alın' : 'Demoyu Onaylayın'
}

/**
 * Compact icon-disc header — colour codes the row at a glance so the user
 * reads the queue as "what does this one need from me" rather than scanning
 * button labels. Kept narrow (40px) so the meta column keeps its room.
 */
function StateDisc({ tone, Icon }) {
  return (
    <span
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-inset',
        tone,
      )}
    >
      <Icon className="h-4.5 w-4.5" strokeWidth={2} />
    </span>
  )
}

function CountBadge({ count }) {
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
      {count}
    </span>
  )
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <Card>
      <CardContent className="grid place-items-center gap-1.5 p-12 text-center">
        <Icon className="h-8 w-8 text-muted-foreground/40" strokeWidth={1.75} />
        <p className="text-sm font-medium text-foreground">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function PageHeader({ icon: Icon, title, subtitle }) {
  return (
    <header>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
    </header>
  )
}

/**
 * Status chip pair — type badge + stage badge. Compact pill pair so the meta
 * line reads cleanly even on phone widths.
 */
function ProjectMeta({ project }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
        {TYPE_LABELS[project.type]}
      </span>
      <span className="text-[11px] font-medium text-muted-foreground">
        {STAGE_LABELS[project.stage]}
      </span>
    </div>
  )
}

/* ───────────────────────── queue row ───────────────────────── */

/**
 * Single approval row. Disc + meta + actions. The disc tone does the visual
 * heavy lifting (receipt-pending amber, awaiting-leader gray, already-signed
 * emerald) so the action area only needs to spell out the next step.
 *
 * `stopPropagation` on the action cluster keeps button clicks from also
 * firing the row's navigate-to-detail handler.
 */
function ApprovalRow({
  project: p,
  sub,
  user,
  isLeader,
  isDesigner,
  isPrinter,
  ekranBusy,
  onApprove, onReject, onAdvance, onStartWork,
  onEkranRequest, onEkranApprove, onEkranReject,
  onNavigate,
}) {
  const isAssignedDesigner = (p.assignees ?? []).some((a) => a.id === user?.id)
  const alreadyApproved = sub === 'ozalit' && (p.ozalit_approvals ?? []).some((a) => a.id === user?.id)
  const canApprove = sub === 'demo' ? isLeader : (isLeader || isAssignedDesigner)
  // Ozalit is leader-first: an assigned designer's Onayla only opens once a
  // team leader has signed off. The row stays in their queue so they can
  // watch it move.
  const awaitingLeader =
    sub === 'ozalit' && isDesigner && !alreadyApproved && !ozalitLeaderApproved(p)
  const heldDemo = sub === 'demo' && p.demo_held === true
  // Demo/ozalit both gate their sign-off behind a "Teslim Alındı" — when
  // that's still owed the action is a receipt step, not an approval.
  const receiptFirst = awaitsReceipt(sub, p)

  // Build the state for the disc + status chip + primary action.
  let state
  if (isPrinter) {
    const awaitingChange = (sub === 'demo' ? canRespondDemoChange(user, p) : canRespondOzalitChange(user, p))
    const started = sub === 'demo' ? p.demo_started : p.ozalit_started
    if (awaitingChange) state = { tone: 'bg-amber-50 text-amber-700 ring-amber-200', Icon: Send, status: 'Değişiklik talebi yanıtlanmadı' }
    else if (started) state = { tone: 'bg-primary/10 text-primary ring-primary/20', Icon: Send, status: 'Matbaada · teslime hazır' }
    else if (sub === 'demo' ? canMarkDemoStarted(user, p) : canMarkOzalitStarted(user, p)) state = { tone: 'bg-amber-50 text-amber-700 ring-amber-200', Icon: Hourglass, status: 'Matbaa çalışması başlamadı' }
    else state = { tone: 'bg-muted text-muted-foreground ring-border', Icon: Inbox, status: 'Beklemede' }
  } else if (heldDemo && isLeader) {
    if (canRespondEkranDemo(user, p)) state = { tone: 'bg-violet-50 text-violet-700 ring-violet-200', Icon: Send, status: 'Ekran demo onayı istendi' }
    else state = { tone: 'bg-violet-50 text-violet-700 ring-violet-200', Icon: Hourglass, status: 'Ekran demo onayı bekleniyor' }
  } else if (receiptFirst) {
    state = { tone: 'bg-amber-50 text-amber-700 ring-amber-200', Icon: PackageCheck, status: 'Teslim alınmadı' }
  } else if (alreadyApproved) {
    state = { tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', Icon: ThumbsUp, status: 'Onayınız kaydedildi' }
  } else if (awaitingLeader) {
    state = { tone: 'bg-muted text-muted-foreground ring-border', Icon: Hourglass, status: 'Ekip lideri onayı bekleniyor' }
  } else if (canApprove) {
    state = { tone: 'bg-primary/10 text-primary ring-primary/20', Icon: ArrowRight, status: 'Onayınız bekleniyor' }
  } else {
    state = { tone: 'bg-muted text-muted-foreground ring-border', Icon: Hourglass, status: 'Onay sırası' }
  }

  // Border accent matches the disc tone so the row reads as a unified state
  // strip rather than a generic card.
  const borderAccent = {
    'bg-amber-50 text-amber-700 ring-amber-200': 'before:bg-amber-400',
    'bg-emerald-50 text-emerald-700 ring-emerald-200': 'before:bg-emerald-500',
    'bg-primary/10 text-primary ring-primary/20': 'before:bg-primary',
    'bg-violet-50 text-violet-700 ring-violet-200': 'before:bg-violet-500',
    'bg-muted text-muted-foreground ring-border': 'before:bg-border',
  }[state.tone]

  return (
    <Card
      className={cn(
        'relative cursor-pointer overflow-hidden transition-colors hover:bg-muted/30',
        borderAccent && 'before:absolute before:inset-y-0 before:left-0 before:w-1',
        borderAccent,
      )}
      onClick={onNavigate}
    >
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        <StateDisc tone={state.tone} Icon={state.Icon} />

        {/* Title + meta — flex-1 keeps the action area flush-right on sm+,
            stacked below on phones. */}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground sm:line-clamp-1">
            {p.title}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="truncate">{p.assigned_name}</span>
            <span aria-hidden className="h-0.5 w-0.5 rounded-full bg-muted-foreground/40" />
            <span>{formatTargetDate(p.target_month)}</span>
            <span aria-hidden className="h-0.5 w-0.5 rounded-full bg-muted-foreground/40" />
            <ProjectMeta project={p} />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusChip tone={state.tone}>{state.status}</StatusChip>
            {receiptFirst && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                <PackageCheck className="h-3 w-3" />
                Teslim alınmadı
              </span>
            )}
          </div>
        </div>

        {/* Action area — full-width on mobile (stacks below meta), inline on
            sm+. stopPropagation keeps button clicks from bubbling to the row
            onClick (which would also navigate to detail). */}
        <div
          className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Actions
            sub={sub}
            p={p}
            user={user}
            isLeader={isLeader}
            isDesigner={isDesigner}
            isPrinter={isPrinter}
            isAssignedDesigner={isAssignedDesigner}
            alreadyApproved={alreadyApproved}
            awaitingLeader={awaitingLeader}
            heldDemo={heldDemo}
            receiptFirst={receiptFirst}
            canApprove={canApprove}
            ekranBusy={ekranBusy}
            onApprove={onApprove}
            onReject={onReject}
            onAdvance={onAdvance}
            onStartWork={onStartWork}
            onEkranRequest={onEkranRequest}
            onEkranApprove={onEkranApprove}
            onEkranReject={onEkranReject}
            onNavigate={onNavigate}
          />
          <Button
            size="sm"
            variant="ghost"
            className="w-full gap-1.5 text-muted-foreground sm:w-auto"
            onClick={onNavigate}
          >
            <Eye className="h-3.5 w-3.5" />
            Detay
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * State-matching chip that mirrors the disc tone (same color, ring, label)
 * so users see the same status on both sides of the row.
 */
function StatusChip({ tone, children }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
      tone,
    )}>
      {children}
    </span>
  )
}

/**
 * Action cluster — all the role/queue/state permutations collapse here so
 * the row JSX above stays a single linear layout. Each branch mirrors a
 * rule from the old inline renderQueue; see that block's comments for the
 * why behind each gate.
 */
function Actions({
  sub, p, user, isLeader, isDesigner, isPrinter,
  isAssignedDesigner, alreadyApproved, awaitingLeader, heldDemo, receiptFirst,
  canApprove, ekranBusy,
  onApprove, onReject, onAdvance, onStartWork,
  onEkranRequest, onEkranApprove, onEkranReject,
  onNavigate,
}) {
  // Printer (matbaa) — change request → teslim et → işlemi başlatın ladder.
  if (isPrinter) {
    const awaitingChange = (sub === 'demo' ? canRespondDemoChange(user, p) : canRespondOzalitChange(user, p))
    const started = sub === 'demo' ? p.demo_started : p.ozalit_started
    if (awaitingChange) {
      return (
        <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={onNavigate}>
          <Send className="h-4 w-4" />
          Değişiklik talebini yanıtlayın
        </Button>
      )
    }
    if (started) {
      return (
        <Button size="sm" className="w-full sm:w-auto" onClick={onAdvance}>
          <Send className="h-4 w-4" />
          {sub === 'demo' ? "Demo'yu Teslim Edin" : 'Ozaliti Teslim Edin'}
        </Button>
      )
    }
    if (sub === 'demo' ? canMarkDemoStarted(user, p) : canMarkOzalitStarted(user, p)) {
      return (
        <Button size="sm" className="w-full sm:w-auto" onClick={onStartWork}>
          <CheckCircle2 className="h-4 w-4" />
          İşlemi Başlatın
        </Button>
      )
    }
    return null
  }

  // Held demo: either respond to an ekran demo request, or request one.
  if (heldDemo && isLeader) {
    if (canRespondEkranDemo(user, p)) {
      return (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={onEkranReject}
            disabled={ekranBusy}
          >
            <ThumbsDown className="h-4 w-4" />
            Reddet
          </Button>
          <Button
            size="sm"
            variant="success"
            className="w-full sm:w-auto"
            onClick={onEkranApprove}
            disabled={ekranBusy}
          >
            <ThumbsUp className="h-4 w-4" />
            Ekran Demoyu Onaylayın
          </Button>
        </div>
      )
    }
    return (
      <Button size="sm" className="w-full sm:w-auto" onClick={onEkranRequest} disabled={ekranBusy}>
        <Send className="h-4 w-4" />
        Ekran Demo Onayı İsteyin
      </Button>
    )
  }

  // Standard approval lane.
  const primary = (() => {
    if (alreadyApproved) {
      return (
        <Button size="sm" variant="ghost" className="w-full justify-start gap-1.5 text-emerald-700 sm:w-auto" disabled>
          <ThumbsUp className="h-4 w-4" />
          Onayınız kaydedildi
        </Button>
      )
    }
    if (awaitingLeader) {
      return (
        <Button size="sm" variant="ghost" className="w-full justify-start gap-1.5 text-muted-foreground sm:w-auto" disabled>
          <Hourglass className="h-4 w-4" />
          Ekip lideri onayı bekleniyor
        </Button>
      )
    }
    if (canApprove) {
      return (
        <Button size="sm" variant={receiptFirst ? 'default' : 'success'} className="w-full sm:w-auto" onClick={onApprove}>
          {receiptFirst ? <PackageCheck className="h-4 w-4" /> : <ThumbsUp className="h-4 w-4" />}
          {primaryActionLabel(sub, p)}
        </Button>
      )
    }
    return (
      <Button size="sm" variant="ghost" className="w-full justify-start gap-1.5 text-muted-foreground sm:w-auto" disabled>
        <Hourglass className="h-4 w-4" />
        Onay bekleniyor
      </Button>
    )
  })()

  // Only a team leader who hasn't approved yet can reject — approving
  // commits them, so Reddet disappears afterward. Baskı Onayı has no reject
  // flow: edit the form itself. Receipt gate: a leader shouldn't be able to
  // reject a demo/ozalit proof they haven't acknowledged receiving yet — the
  // primary button leads with "Teslim Alın" in that case, so the matching
  // Reddet has to wait too.
  const reject =
    isLeader && !alreadyApproved && sub !== 'baski-onay' && !receiptFirst ? (
      <Button size="sm" variant="destructive" className="w-full sm:w-auto" onClick={onReject}>
        <ThumbsDown className="h-4 w-4" />
        {sub === 'ozalit' ? 'Ozaliti Reddedin' : 'Demoyu Reddedin'}
      </Button>
    ) : null

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {primary}
      {reject}
    </div>
  )
}

/* ───────────────────────── sipariş card ───────────────────────── */

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
