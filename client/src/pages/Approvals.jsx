import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ThumbsUp, ThumbsDown, Inbox, Send, ShoppingCart, CheckCircle2, PackageCheck,
  ClipboardCheck, Hourglass, Eye, ArrowRight, RotateCcw,
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
import ParcaApprovalGrid from '@/components/ParcaApprovalGrid'
import ParcaJobBoard from '@/components/ParcaJobBoard'
import ParcaRejectDialog from '@/components/ParcaRejectDialog'
import { ledgerKindForStage, parcaRoundDecidable } from '@/hooks/useParcaSnapshot'
import { parcaPanelDecider } from '@/domain/services/project-detail'
import { useParcaQueue } from '@/hooks/useParcaQueue'
import { STAGE_LABELS, TYPE_LABELS } from '@/api'
import {
  canRejectAtStage, isDemoApprover, isOzalitApprover, ozalitLeaderApproved,
  awaitsOzalitReceipt, ozalitDecidable, needsOzalitRouteChoice,
  canRequestEkranDemo, canRespondEkranDemo, canRespondDemoChange, canRespondOzalitChange,
  canMarkDemoStarted, canMarkOzalitStarted,
  bulkApproveAvailable, parcaNames,
  orderMatbaaAction, orderMatbaaStatusLabel,
} from '@/domain'
import { cn, formatTargetDate, formatNumber } from '@/lib/utils'

// Shared empty list. `useParcaQueue` answers one role at a time, and the other
// role's slice feeds a useMemo dependency — a fresh [] each render would
// invalidate it every time.
const EMPTY_ROWS = []

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

  // Sipariş queue (printer's sign-off step: matbaa_ozalit_yapiyor → imza_bekleniyor)
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [signOrder, setSignOrder] = useState(null)

  // Per-parça approval (migrations 068/069/070): the queue needs the latest
  // snapshot's `_selectedComponents` for every project that hits demo/ozalit/
  // baski_onay, so the per-parça grid can render. Pulled once on mount +
  // when projects change; the map keys by `${projectId}|${kind}` so demo /
  // ozalit / baski_onay each have their own latest snapshot.
  const [snapshots, setSnapshots] = useState(new Map())
  // Per-parça action loading — disables the whole grid while a leader click
  // is in flight, so the same parça can't get double-clicked by the bulk
  // shortcut and the per-row button.
  const [parcaBusyId, setParcaBusyId] = useState(null)
  // { project, parcalar } while the per-parça reject dialog is open; null = closed.
  const [parcaReject, setParcaReject] = useState(null)

  const isPrinter = user?.role === 'printer'
  const isLeader = user?.role === 'team_leader'
  const isDesigner = user?.role === 'designer'
  // Demo approvals: leader OR printer. Ozalit approvals are multi-party:
  // every leader AND every assigned designer must approve. Baskı Onayı is
  // team_leader only — the same person who may edit the form itself.
  const canActOnDemo = isLeader || isPrinter
  const canActOnOzalit = isLeader || isDesigner

  /* ── Parçalar back from a round that is still out (migration 076) ────────
   * The matbaa delivers a multi-parça round one parça at a time and the project
   * waits at its *_teslim stage for the last one, so the approval gate this page
   * is built around never opens. Those parçalar used to land in nobody's queue:
   * the leader got a "KUTU teslim edildi" notification and had nowhere to act on
   * it. `/parca-queue` answers for the leader too now — these are the parçalar
   * waiting to be received or decided.
   *
   * The same endpoint answers for the MATBAA, and that answer is what this page
   * used to get wrong. A round split into parçalar leaves the project sitting
   * at `demo_teslim`, so the printer's stage filter below matched it and drew a
   * whole-sheet "İşlemi Başlatın" — which stamps `demo_started` and unlocks a
   * whole-sheet "Teslim Edin" that advances the round past parçalar nobody
   * produced (`computeDemoTeslimAdvance` has no parça check; only
   * `deliverParca` gates on `allParcalarDelivered`). Matbaa İşleri already
   * excluded those projects; now this page runs the same rule off the same
   * rows, and renders ParcaJobBoard for them instead. */
  const { rows: myParcaRows, refetch: refetchParcaQueue } = useParcaQueue(isLeader || isPrinter)
  const earlyParcaRows = isLeader ? myParcaRows : EMPTY_ROWS
  const earlyParcaGroups = useMemo(() => {
    const byProject = new Map()
    for (const row of earlyParcaRows) {
      // The full project carries the ledgers and the stage the grid reads; the
      // queue row only knows its own parça.
      const project = projects.find((p) => p.id === row.project_id)
      if (!project) continue
      const group = byProject.get(row.project_id) ?? { project, rows: [] }
      group.rows.push(row)
      byProject.set(row.project_id, group)
    }
    return [...byProject.values()]
  }, [earlyParcaRows, projects])
  const earlyGroupsFor = (sub) => earlyParcaGroups.filter(
    (g) => (g.rows[0]?.gate === 'ozalit') === (sub === 'ozalit'),
  )

  /* The matbaa's own parça jobs — rendered as ParcaJobBoard, the same component
   * Matbaa İşleri and the project page use, so all three offer one set of
   * buttons acting at one scope. */
  const printerParcaRows = isPrinter ? myParcaRows : EMPTY_ROWS
  const printerParcaFor = (sub) => printerParcaRows.filter(
    (r) => (r.gate === 'ozalit') === (sub === 'ozalit'),
  )
  // A split round would otherwise be listed twice — once as a whole sheet by
  // the stage filter, once as its parçalar — with two sets of buttons acting on
  // the same work. The parça cards win: they are strictly more precise. Same
  // exclusion MatbaaIsleri.jsx makes.
  const printerParcaProjectIds = useMemo(
    () => new Set(printerParcaRows.map((r) => r.project_id)),
    [printerParcaRows],
  )

  /** Per-parça "Teslim Alındı" — the receipt that opens this parça's decision. */
  async function handleReceiveParca(project, parca) {
    setParcaBusyId(project.id)
    try {
      await api.receiveParca(project.id, parca)
      toast.success(`${parca} teslim alındı.`)
      refetchParcaQueue()
    } catch (err) {
      toast.error(err.message || 'Teslim alma tamamlanamadı.')
    } finally {
      setParcaBusyId(null)
    }
  }

  // Refresh the snapshot map whenever the projects list changes (a new
  // project may have appeared in the queue) or the user lands on the
  // page. GET /demos returns the full list; we project it down to the
  // (project, kind) pairs we care about and keep only the most recent row
  // per pair (server-side ordering is created_at DESC, but we re-sort
  // defensively to handle ties).
  useEffect(() => {
    let cancelled = false
    api.listDemos()
      .then((rows) => {
        if (cancelled) return
        const latest = new Map()
        for (const row of rows ?? []) {
          if (!row?.project_id) continue
          const key = `${row.project_id}|${row.kind}`
          const at = row.created_at ? new Date(row.created_at).getTime() : 0
          const existing = latest.get(key)
          if (!existing || at > existing.at) {
            latest.set(key, {
              at,
              selectedComponents: parcaNames(row?.payload?._selectedComponents),
            })
          }
        }
        setSnapshots(latest)
      })
      .catch(() => { /* listDemos is optional for the queue */ })
    return () => { cancelled = true }
  }, [projects])

  // Lookup helpers — used by the per-parça grid below to resolve the
  // current snapshot's parça list for a given (project, kind) pair.
  function snapshotFor(projectId, kind) {
    return snapshots.get(`${projectId}|${kind}`)?.selectedComponents ?? []
  }

  useEffect(() => {
    if (!isPrinter || tab !== 'siparis') return
    setOrdersLoading(true)
    api.listOrderRequests()
      .then((reqs) => setOrders(reqs.filter((r) => r.status === 'matbaa_ozalit_yapiyor')))
      .finally(() => setOrdersLoading(false))
  }, [isPrinter, tab])

  // A matbaa_ozalit_yapiyor push/bell tap lands here with ?order=<id> — the printer
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
        if (printerParcaProjectIds.has(p.id)) return false
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

  const demoQueue = useMemo(() => filterQueue('demo'), [projects, isPrinter, printerParcaProjectIds])
  const ozalitQueue = useMemo(() => filterQueue('ozalit'), [projects, isPrinter, printerParcaProjectIds])
  // The tab badges count what the tab actually holds, and since migration 076
  // that includes the parçalar sitting above the queue on an unfinished round.
  // A leader whose only pending work was one early parça saw a bare tab.
  const demoTabCount = demoQueue.length + earlyGroupsFor('demo').length + printerParcaFor('demo').length
  const ozalitTabCount = ozalitQueue.length + earlyGroupsFor('ozalit').length + printerParcaFor('ozalit').length
  const baskiOnayQueue = useMemo(() => filterQueue('baski-onay'), [projects, isPrinter, isLeader])

  function onDone() {}

  function handleOrderSigned(updated) {
    setOrders((prev) => prev.filter((r) => r.id !== updated.id))
    setSignOrder(null)
  }

  // The printer's "İşlemi Başlatın" (and a change-request accept/decline)
  // don't move the order out of matbaa_ozalit_yapiyor — they only flip flags the
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

  // Per-parça handlers (migrations 068/069/070): the grid passes either a
  // subset (single-row click) or `null` (bulk shortcut). Server-side, null
  // defaults to "all still-pending parçalar on this round". The route
  // forwards the snapshot's `_selectedComponents` via its prepare hook,
  // so we only need to forward the leader's selection here.
  async function handleApproveParcalar(project, parcalar, sub) {
    if (!project) return
    setParcaBusyId(project.id)
    try {
      // `sub` is the queue tab ('demo' | 'ozalit' | 'baski-onay'); map it
      // onto the snapshotKind the route's prepare hook reads.
      const snapshotKind = sub === 'demo'
        ? 'demo'
        : sub === 'ozalit' ? 'ozalit' : 'baski_onay'
      const updated = await api.approveProject(project.id, parcalar, { snapshotKind })
      updateOne(updated)
      // The toast matches what ProjectDetail surfaces for a partial
      // approve — "kaydedildi" while still collecting, "geçti" on advance.
      const advanced = updated?.stage !== project.stage
      toast.success(advanced
        ? sub === 'demo' ? 'Demo onaylandı, proje ilerledi.'
          : sub === 'ozalit' ? 'Ozalit onaylandı, proje ilerledi.'
            : 'Baskı onaylandı, proje ilerledi.'
        : 'Onayınız kaydedildi, bekleyen parçalar var.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setParcaBusyId(null)
    }
  }

  /**
   * Per-parça reject (migration 074).
   *
   * This used to fire straight off the grid's thumbs-down with a hard-coded
   * reason ("Parça bazlı red") and a hard-coded target ('designer'). Both were
   * wrong: the leader could not route a printing fault to the matbaa, and the
   * timeline recorded a reason nobody wrote. The dialog now asks for the
   * responsible party — the whole point of per-parça routing — and the reason
   * the reject schema requires anyway.
   */
  async function handleRejectParcalar(project, parcalar, reason, target) {
    if (!project) return null
    setParcaBusyId(project.id)
    try {
      const updated = await api.rejectProject(project.id, reason, [], target, parcalar)
      updateOne(updated)
      toast.success(target === 'matbaa' ? 'Parça matbaaya gönderildi.' : 'Parça tasarımcıya gönderildi.')
      return updated
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
      return null
    } finally {
      setParcaBusyId(null)
    }
  }

  /**
   * Sheet-first for per-parça decisions (migration 074).
   *
   * Same rule the rest of the app follows: you read the sheet before you commit
   * to it. The matbaa's İşlemi Başlatın has never been a bare confirm, and the
   * project-level Onayla at ozalit_onay opens the form to sign — so the
   * per-parça thumbs-up must not be the one place a leader signs blind.
   *
   * { project, action: 'approve' | 'reject', parcalar, sub }
   */
  function openParcaSheet(project, action, parcalar, sub) {
    const form = { project, mode: 'view', parcaAction: { action, parcalar, sub } }
    if (sub === 'ozalit') setOzalitForm(form)
    else setDemoForm(form)
  }

  /** Run the decision from the sheet's footer, once it has been read. */
  async function commitParcaSheet(form, close) {
    const pending = form?.parcaAction
    if (!pending) return
    close()
    if (pending.action === 'approve') {
      await handleApproveParcalar(form.project, pending.parcalar, pending.sub)
    } else {
      // Reject needs a reason and a responsible party — neither lives on the
      // sheet, so it hands off to the dialog that carries them.
      setParcaReject({ project: form.project, parcalar: pending.parcalar })
    }
  }

  /** What the footer button promises, naming every parça it covers. */
  function parcaSheetLabel(form) {
    const p = form?.parcaAction
    if (!p) return null
    const names = (p.parcalar ?? []).join(', ') || 'Tüm parçalar'
    return `${names} · ${p.action === 'approve' ? 'Onaylayın' : 'Reddedin'}`
  }

  async function handlePrepareBaskiParcalar(project, parcalar) {
    if (!project) return
    setParcaBusyId(project.id)
    try {
      const updated = await api.prepareBaskiOnay(project.id, parcalar)
      updateOne(updated)
      toast.success('Baskı onay formu hazırlandı.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setParcaBusyId(null)
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
            subtitle="Tasarımcının istediği ozalitleri başlatın ve teslim edin."
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
              {orders.map((order) => {
                // null = the printer owes nothing on this round right now (an
                // accepted change request is waiting on the leader's spec fix).
                // Same contract MatbaaIsleri's pendingAction uses: no action,
                // no row.
                const action = orderMatbaaAction(user, order)
                if (!action) return null
                return (
                  <SiparisOrderCard
                    key={order.id}
                    order={order}
                    action={action}
                    onSign={() => setSignOrder(order)}
                  />
                )
              })}
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

  /**
   * Parçalar that came back before their round did (migration 076).
   *
   * Rendered above the gate queue rather than inside it: these projects are NOT
   * at an approval gate — the matbaa is still printing the rest of the round —
   * so the whole-round Onayla/Reddet buttons an ApprovalRow carries would every
   * one of them be refused. What is real here is the parça grid, so that is all
   * this shows, with the project title as the way through to the full page.
   */
  function renderEarlyParcaSection(sub) {
    const groups = earlyGroupsFor(sub)
    if (groups.length === 0) return null
    return (
      <div className="mb-4 space-y-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Turu tamamlanmadan gelen parçalar
        </p>
        {groups.map(({ project, rows }) => (
          <Card key={project.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Wraps, never truncates — this is the book they are deciding on. */}
                <button
                  type="button"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="min-w-0 text-left text-sm font-semibold leading-snug text-foreground hover:underline"
                >
                  {project.title}
                </button>
                <Badge variant="outline" className="text-[10px]">
                  {STAGE_LABELS[project.stage] ?? project.stage}
                </Badge>
              </div>
              <ParcaApprovalGrid
                project={project}
                kind={sub === 'ozalit' ? 'ozalit' : 'demo'}
                snapshotParcalar={snapshotFor(project.id, sub === 'ozalit' ? 'ozalit' : 'demo')}
                parcaRows={rows}
                busy={parcaBusyId === project.id}
                showHeader={false}
                onReceiveParca={(parca) => handleReceiveParca(project, parca)}
                // Sheet-first, exactly as at the gate: the decision is taken
                // from the spec form's footer, and reject then hands off to the
                // reason/party dialog.
                onApproveParcalar={(parcalar) => openParcaSheet(project, 'approve', parcalar, sub)}
                onRejectParcalar={(parcalar) => openParcaSheet(project, 'reject', parcalar, sub)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  /**
   * The matbaa's per-parça jobs (migration 074).
   *
   * Above the stage queue, like the leader's early-parça section and for the
   * same reason: these projects have not reached a gate — the round is split
   * across desks — so the whole-sheet row the queue would draw is the wrong
   * unit of work. ParcaJobBoard carries its own spec-sheet dialogs, so the
   * printer starts and delivers a parça without leaving this page.
   */
  function renderPrinterParcaSection(sub) {
    const rows = printerParcaFor(sub)
    if (rows.length === 0) return null
    return (
      <div className="mb-4 space-y-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Parça bazlı işleriniz
        </p>
        <ParcaJobBoard rows={rows} onChanged={refetchParcaQueue} />
      </div>
    )
  }

  function renderQueue(queue, sub) {
    // Role-exclusive: the early section is the leader's, the parça board is the
    // matbaa's, and `useParcaQueue` only ever fills one of them.
    const preamble = renderEarlyParcaSection(sub) ?? renderPrinterParcaSection(sub)
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
      return preamble ?? (
        <EmptyState
          icon={Inbox}
          title="Şu an bekleyen iş yok."
          hint="Yeni bir teslim geldiğinde burada görünecek."
        />
      )
    }
    return (
      <>
      {preamble}
      <div className="stagger-children space-y-2.5">
        {queue.map((p) => {
          // Per-parça gate (migrations 068/069/070): pick the matching
          // snapshot kind for the queue tab, then decide whether to render
          // the per-parça grid (≥2 parçalar on the snapshot) or fall through
          // to the single-parça button row.
          const snapshotKind = sub === 'demo'
            ? 'demo'
            : sub === 'ozalit' ? 'ozalit' : 'baski_onay'
          const snap = snapshotFor(p.id, snapshotKind)
          // Same receipt gate the single Onayla button answers to: the row
          // leads with "Teslim Alın" while a proof is undelivered, so the
          // grid must not offer a sign-off the server would refuse.
          const showParcaGrid = snap.length >= 2 && parcaRoundDecidable(p) && (
            sub === 'demo'
              ? canActOnDemo
              : sub === 'ozalit'
                // Every button in the grid is an approve or a reject, and both
                // ride the same gates as the whole-round pair below it: no
                // sign-off before the proof is received, and none at all while
                // a rejected round waits on the designer's revision. Without
                // this the grid kept offering per-parça Onayla on rounds the
                // server refuses (computeApproval's "Teslim Alındı" gate).
                ? canActOnOzalit && ozalitDecidable(p)
                : isLeader
          )
          return (
            <ApprovalRow
              key={p.id}
              project={p}
              sub={sub}
              user={user}
              isLeader={isLeader}
              isDesigner={isDesigner}
              isPrinter={isPrinter}
              ekranBusy={ekranBusyId === p.id}
              showParcaGrid={showParcaGrid}
              snapshotParcalar={snap}
              parcaBusy={parcaBusyId === p.id}
              onApproveParcalar={(parcalar) => openParcaSheet(p, 'approve', parcalar, sub)}
              // Reject is demo/ozalit only. Baskı Onayı is a leader-to-leader
              // maker-checker (migration 070) with no designer or matbaa leg —
              // there is no desk to send a parça back to, and computeRejection
              // refuses a per-parça reject outside the demo/ozalit onay stages
              // ("Parça bazlı red yalnızca demo ve ozalit onay aşamalarında
              // yapılabilir"). Offering the button here is a guaranteed 400.
              onRejectParcalar={sub === 'baski-onay'
                ? undefined
                : (parcalar) => openParcaSheet(p, 'reject', parcalar, sub)}
              onPrepareBaskiParcalar={(parcalar) => handlePrepareBaskiParcalar(p, parcalar)}
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
          )
        })}
      </div>
      </>
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
                {demoTabCount > 0 && <CountBadge count={demoTabCount} />}
              </TabsTrigger>
            )}
            <TabsTrigger value="ozalit">
              Ozalit Onayı
              {ozalitTabCount > 0 && <CountBadge count={ozalitTabCount} />}
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
        onStartWork={
          demoForm?.parcaAction
            ? () => commitParcaSheet(demoForm, () => setDemoForm(null))
            : demoForm?.startWork
              ? () => handleStartWork(demoForm.project, 'demo')
              : undefined
        }
        // The sheet opens as the parça the leader is deciding on — the same
        // one the footer button names. A bulk "Tüm parçaları onaylayın" scopes
        // to all of them, which is the whole sheet anyway.
        parcaScope={demoForm?.parcaAction?.parcalar ?? null}
        // A sheet opened to DECIDE on is read-only: it is the record being
        // signed, not a draft. See isDecisionReview in lib/spec-form-variants.js.
        decisionContext={demoForm?.parcaAction ?? null}
        startWorkLabel={parcaSheetLabel(demoForm)}
        startingWork={startingWork || parcaBusyId === demoForm?.project?.id}
        onDone={onDone}
      />
      <OzalitFormDialog
        open={!!ozalitForm}
        onOpenChange={(v) => setOzalitForm(v ? ozalitForm : null)}
        project={ozalitForm?.project}
        mode={ozalitForm?.mode ?? 'approve'}
        onStartWork={
          ozalitForm?.parcaAction
            ? () => commitParcaSheet(ozalitForm, () => setOzalitForm(null))
            : ozalitForm?.startWork
              ? () => handleStartWork(ozalitForm.project, 'ozalit')
              : undefined
        }
        parcaScope={ozalitForm?.parcaAction?.parcalar ?? null}
        // A sheet opened to DECIDE on is read-only: it is the record being
        // signed, not a draft. See isDecisionReview in lib/spec-form-variants.js.
        decisionContext={ozalitForm?.parcaAction ?? null}
        startWorkLabel={parcaSheetLabel(ozalitForm)}
        startingWork={startingWork || parcaBusyId === ozalitForm?.project?.id}
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

      {/* Per-parça reject (migration 074) — same dialog the project page uses,
          so the leader answers the same two questions wherever they are. */}
      <ParcaRejectDialog
        open={!!parcaReject}
        onOpenChange={(v) => !v && setParcaReject(null)}
        project={parcaReject?.project}
        parcalar={parcaReject?.parcalar ?? []}
        busy={parcaBusyId === parcaReject?.project?.id}
        onConfirm={async (parcalar, reason, target) => {
          const updated = await handleRejectParcalar(parcaReject.project, parcalar, reason, target)
          if (updated) setParcaReject(null)
        }}
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
  // Not every un-received ozalit owes a receipt: a screen round has no proof
  // to take delivery of, and a rejected one is parked on the stage while the
  // designer revizes. Both used to read "Ozaliti Teslim Alın" — an action the
  // server refuses outright.
  if (sub === 'ozalit') return awaitsOzalitReceipt(p)
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
  showParcaGrid,
  snapshotParcalar,
  parcaBusy,
  onApproveParcalar,
  onRejectParcalar,
  onPrepareBaskiParcalar,
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
  // Ozalit redo leg: the round was rejected back to the designer and the
  // project stays on ozalit_onay while they revize (needsOzalitRouteChoice).
  // There is nothing to approve, receive or reject until it's resubmitted, so
  // the row reports the wait instead of offering a sign-off that would 400.
  const inOzalitRevision = sub === 'ozalit' && needsOzalitRouteChoice(p)
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
  } else if (inOzalitRevision) {
    state = {
      tone: 'bg-amber-50 text-amber-700 ring-amber-200', Icon: RotateCcw,
      status: isAssignedDesigner ? 'Revize sizde' : 'Tasarımcı revizesi bekleniyor',
    }
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
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
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
              inOzalitRevision={inOzalitRevision}
              canApprove={canApprove}
              ekranBusy={ekranBusy}
              showParcaGrid={showParcaGrid}
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
        </div>

        {/* Per-parça approval grid (migrations 068/069/070): rendered below
            the row's existing horizontal strip when the project has a
            multi-parça snapshot. stopPropagation keeps grid clicks from
            bubbling into the row-level navigate. */}
        {showParcaGrid && (
          <div
            className="border-t border-border/60 pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <ParcaApprovalGrid
              project={p}
              // Ledger key, NOT the snapshot kind: TR and ÇİN both store the
              // baskı sheet under kind `baski_onay` but keep separate ledgers
              // (`baski_parca_*` vs `cin_baski_parca_*`), so a ÇİN project read
              // through the TR key showed every parça unsigned.
              kind={ledgerKindForStage(p.stage)}
              // See ProjectDetail's note: the ozalit ledger is per-party.
              user={user}
              snapshotParcalar={snapshotParcalar}
              // Deliberately no `neverSentParcalar` here, unlike ProjectDetail.
              // Answering "never sent" needs the project's routing rows as well
              // as its catalog — a parça out for rework is off the round too,
              // and is not the same thing as one nobody ever sent. This queue
              // loads rows only for the early-parça section above, so computing
              // it here would over-report and draw phantom rows. The leader can
              // still sign off each parça individually; the round then holds at
              // the gate rather than advancing, and the project page is one
              // click away with the `Gönderilmedi` row that explains why.
              busy={parcaBusy}
              // Same gate as the project page's panel, from the same helper —
              // the ozalit leg is not a role question. A designer needs to be
              // ASSIGNED, needs a team leader to have signed first, and gets
              // nothing at all on an ekran round (a flat single-leader sign-off).
              // Passed unconditionally, this handed them thumbs-up buttons that
              // `computeOzalitOnayApproval` answers with a 400.
              onApproveParcalar={parcaPanelDecider(user, ledgerKindForStage(p.stage), { project: p })
                ? onApproveParcalar
                : undefined}
              onRejectParcalar={isLeader ? onRejectParcalar : undefined}
              // The row's own Reddet is suppressed while this grid draws — same
              // gates as that button carried, re-stated here because this queue
              // does not go through `availableActions`.
              onBulkReject={
                isLeader && !alreadyApproved && sub !== 'baski-onay'
                  && !receiptFirst && !inOzalitRevision
                  ? onReject
                  : undefined
              }
              // Baskı's maker half, opening the same form the row's button did.
              // `onApprove` already routes baskı to setBaskiOnayForm.
              onPrepareSheet={isLeader && sub === 'baski-onay' ? onApprove : undefined}
            />
          </div>
        )}
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
  inOzalitRevision, canApprove, ekranBusy, showParcaGrid,
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
    // Revision in flight — the work is the designer's revize plus the route
    // picker (physical ozalit vs Ekran Ozalit), and both live on the project
    // page: the queue row can't see the subtasks the server gates that
    // resubmit on, so it sends them there rather than opening a form that
    // would refuse to submit.
    if (inOzalitRevision) {
      return isAssignedDesigner ? (
        <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={onNavigate}>
          <RotateCcw className="h-4 w-4" />
          Revizeyi tamamlayın
        </Button>
      ) : (
        <Button size="sm" variant="ghost" className="w-full justify-start gap-1.5 text-muted-foreground sm:w-auto" disabled>
          <Hourglass className="h-4 w-4" />
          Tasarımcı revizesi bekleniyor
        </Button>
      )
    }
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
    // The grid below this row is the approval surface on a multi-parça round —
    // the same rule availableActions applies on the project page, and it has to
    // be applied here too because this strip has its own gating and never asked
    // that function. One press signing off every parça at once is a way around
    // the per-parça decision, not a shortcut for it; the grid's own
    // "Tüm parçaları onaylayın" is the shortcut that counts what it signs.
    //
    // `receiptFirst` is exempt: there the primary button is "Teslim Alın", the
    // receipt the whole round shares, not an approval at all.
    //
    // Baskı onayı is covered too, but only because the panel below now carries
    // BOTH of its steps. Its primary button is the one place they were folded
    // together — "Baskı Onayı Hazırlayın" before the sheet exists, "Baskı Onayı
    // Verin" after (primaryActionLabel) — so suppressing it before the panel had
    // a prepare affordance stranded the maker half entirely.
    if (showParcaGrid && !receiptFirst) {
      return (
        <Button size="sm" variant="ghost" className="w-full justify-start gap-1.5 text-muted-foreground sm:w-auto" disabled>
          <Hourglass className="h-4 w-4" />
          Parçaları aşağıdan onaylayın
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
  // A round already rejected back to the designer can't be rejected again —
  // the server's reject gate needs a received proof or a screen round, and
  // this one is neither while the revision is in flight.
  // …and on a multi-parça round it lives in the grid below as "Tümünü
  // Reddedin", beside the bulk approve, so every decision on the round is taken
  // in one place. Same gates, same action — only the home changes.
  const reject =
    isLeader && !alreadyApproved && sub !== 'baski-onay' && !receiptFirst
      && !inOzalitRevision && !showParcaGrid ? (
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

/**
 * `action` is orderMatbaaAction's result — the printer's real next beat on this
 * round ("İşlemi Başlatın" → "Ozaliti Teslim Edin", or answering a change
 * request). The card used to hard-code "Teslim Edin" over every state, which
 * offered delivery of a proof whose production had not been started; its twin
 * in MatbaaIsleri hard-coded "İmzala ve Onayla" over the same states. Both now
 * read the one shared rule.
 */
function SiparisOrderCard({ order, action, onSign }) {
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
            {orderMatbaaStatusLabel(order)}
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
            {action.label}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
