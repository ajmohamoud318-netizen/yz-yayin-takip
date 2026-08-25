import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Package,
  PackageX,
  Pencil,
  Save,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users as UsersIcon,
  User as UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProjects'
import api, {
  STAGE_LABELS, TYPE_LABELS, IN_FLIGHT_DEMO_OZALIT_STAGES, isLegacyProject,
  ORDER_STEP_LABELS, orderStepPath,
} from '@/api'
import StageBar from '@/components/StageBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import UserAvatar from '@/components/UserAvatar.jsx'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import ApprovalDialog from '@/components/ApprovalDialog'
import ConfirmDialog from '@/components/ConfirmDialog'
import NewProjectDialog from '@/components/NewProjectDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import BaskiOnayFormDialog from '@/components/BaskiOnayFormDialog'
import DemoFormDialog from '@/components/DemoFormDialog'
import ProjectHistory from '@/components/ProjectHistory'
import TalepSignDialog from '@/components/TalepSignDialog'
import SiparisBaskiOnayFormDialog from '@/components/SiparisBaskiOnayFormDialog'
import EkranDemoRejectDialog from '@/components/EkranDemoRejectDialog'
import { cn, formatDateTr, initials } from '@/lib/utils'
import { useDesignerCelebration } from '@/hooks/useCelebration'
import { isSubtaskDone, countsTowardProgress } from '@/domain/services/progress'
import {
  canApproveOzalitNow, ozalitLeaderApproved,
  canMarkDemoStarted, canMarkOzalitStarted,
  canCancelDemoRequest, canCancelOzalitRequest,
  canEditSentDemoRequest, canEditSentOzalitRequest,
  canRequestDemoChange, canRequestOzalitChange,
  canRespondDemoChange, canRespondOzalitChange,
  canRequestEkranDemo, canRespondEkranDemo,
} from '@/domain'
import { canActOnOrder } from '@/domain/constants/orders'

// "Open" mirrors useOpenOrdersByProject/findOpenByProject — not yet at a
// terminal step. A project can have more than one of these in flight at
// once (concurrent sipariş orders on the same product are allowed), so this
// page shows one stepper per active order rather than assuming there's only
// ever one.
const isActiveOrder = (o) => o.status !== 'onaylandi' && o.status !== 'rejected'

// The order's own status only ever reaches 'onaylandi' (Üretimde) — what
// happens after that (Matbaa requesting handover, Satış confirming it) is
// real project/handover state, not a status this order will ever carry.
// Appending it here as two derived steps is what lets the tracker keep
// filling in for real after approval instead of freezing dead on Üretimde
// forever.
const DISPLAY_ORDER_STEP_LABELS = {
  ...ORDER_STEP_LABELS,
  teslim_bekleniyor: 'Teslim Bekleniyor',
  satista: 'Satışta',
}

// Mirrors the per-page action labels in MyProjects/SiparisOnay/SiparisTalepleri
// (each only ever renders one of these for its own role's queue) — collected
// here since this page shows a project's orders to whichever role opens it.
const ORDER_ACTION_LABELS = {
  pending: 'Tasarımcıya Aktarın',
  goruldu: 'İnceleyin ve Gönderin',
  tasarimci_onay: 'Teslim Edin',
  ekran_onay: 'Onaylayın',
  siparis_baski_onay: 'Baskı Onay Formu',
}
function orderActionLabel(order) {
  if (order.status === 'matbaa_onay') return order.matbaa_received ? 'Onaylayın' : 'Teslim Alın'
  return ORDER_ACTION_LABELS[order.status] ?? 'Onaylayın'
}

/**
 * Compact stepper for a single sipariş order's own steps (Talep →
 * Satışta) — separate from the project's main design/production pipeline
 * (StageBar), which doesn't move while an order is in flight and says
 * nothing about it. `sold` (project.stage === 'satista') and
 * `handoverPending` (Matbaa raised a teslim request Satış hasn't confirmed
 * yet) advance the two derived final steps as those real events actually
 * happen.
 */
function OrderProgressStepper({ order, sold, handoverPending, canAct, onAct }) {
  // The pipeline branches at goruldu (tasarimci_onay vs ekran_onay) — each
  // order's own displayed sequence comes from the path it actually took,
  // not a fixed list. See orderStepPath in domain/constants/orders.js.
  const displaySteps = [...orderStepPath(order), 'teslim_bekleniyor', 'satista']
  const currentIndex = sold
    ? displaySteps.length - 1
    : handoverPending
      ? displaySteps.length - 2
      : Math.max(0, displaySteps.indexOf(order.status))
  return (
    <div
      className={cn(
        'w-full rounded-lg border bg-background px-3 py-2.5 transition',
        canAct && 'border-amber-300 bg-amber-50/40',
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Package className="h-3.5 w-3.5" />
        Baskı Talebi
      </div>
      <ol className="flex items-center">
        {displaySteps.map((step, i) => {
          const done = i < currentIndex
          const current = i === currentIndex
          return (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                    done
                      ? 'bg-brand-500 text-white'
                      : current
                        ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span
                  className={cn(
                    'mt-1 max-w-[60px] text-center text-[9px] leading-tight',
                    current ? 'font-semibold text-brand-700' : 'text-muted-foreground',
                  )}
                >
                  {DISPLAY_ORDER_STEP_LABELS[step]}
                </span>
              </div>
              {i < displaySteps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn('mx-1.5 mb-4 h-0.5 flex-1', i < currentIndex ? 'bg-brand-500' : 'bg-muted')}
                />
              )}
            </li>
          )
        })}
      </ol>
      {canAct && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-[11px] font-medium text-amber-700">Aksiyon bekliyor</span>
          <Button
            size="sm"
            className="h-7 px-2.5"
            onClick={(e) => { e.stopPropagation(); onAct() }}
          >
            {orderActionLabel(order)}
          </Button>
        </div>
      )}
    </div>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => {
    if (location.key !== 'default') {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  const { user } = useAuth()
  const celebrate = useDesignerCelebration()
  const { project, loading, refetch, setProject } = useProject(id)
  const [dialog, setDialog] = useState(null) // 'approve' | 'reject' | 'advance'
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [ozalitFormOpen, setOzalitFormOpen] = useState(false)
  const [ozalitFormMode, setOzalitFormMode] = useState('approve') // 'approve' | 'view'
  const [demoFormOpen, setDemoFormOpen] = useState(false)
  const [demoFormMode, setDemoFormMode] = useState('advance') // 'advance' | 'view' | 'history'
  const [demoFormAttempt, setDemoFormAttempt] = useState(null)
  const [ozalitFormAttempt, setOzalitFormAttempt] = useState(null)
  // Set true only when the new "Formu Düzenleyin" button opens the dialog —
  // makes mode='view' Kaydet notify the matbaa instead of saving silently.
  const [demoFormNotify, setDemoFormNotify] = useState(false)
  const [ozalitFormNotify, setOzalitFormNotify] = useState(false)
  const [baskiOnayFormOpen, setBaskiOnayFormOpen] = useState(false)
  const [baskiOnayFormMode, setBaskiOnayFormMode] = useState('approve') // 'approve' | 'view'
  const [toggling, setToggling] = useState(null)
  const [localDone, setLocalDone] = useState({})
  const [saving, setSaving] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [reportingNotReceived, setReportingNotReceived] = useState(false)
  // Which teslim decision is awaiting an "emin misiniz?" — all four are
  // single-click, irreversible-ish, and sit right next to each other in the
  // action row, so none of them fires straight from the button.
  // 'demo-received' | 'demo-not-received' | 'ozalit-received' | 'ozalit-not-received'
  const [teslimConfirm, setTeslimConfirm] = useState(null)
  // Matbaa "Başladım" gate + cancel + change-request (migration 048).
  const [startingWork, setStartingWork] = useState(false)
  const [cancellingRequest, setCancellingRequest] = useState(false)
  const [respondingChange, setRespondingChange] = useState(false)
  // 'demo' | 'ozalit' | null — which change-request note dialog is open.
  const [changeRequestOpen, setChangeRequestOpen] = useState(null)
  const [changeRequestNote, setChangeRequestNote] = useState('')
  const [requestingChange, setRequestingChange] = useState(false)
  // Ekran Demo Onayı — lightweight digital alternative to a physical
  // re-demo for a held demo at 100% progress (migration 050). Covers both
  // the request and the approve step (TESLIM_CONFIRMS entries below) — only
  // one is ever in flight at a time.
  const [processingEkranDemo, setProcessingEkranDemo] = useState(false)
  const [ekranDemoRejectOpen, setEkranDemoRejectOpen] = useState(false)
  const [projectOrders, setProjectOrders] = useState([])
  const [projectHandover, setProjectHandover] = useState(null)
  const [signOrder, setSignOrder] = useState(null)
  // Distinct from baskiOnayFormOpen above — that's the final production-gate
  // "Baskı Onayı" (BaskiOnayFormDialog), unrelated to a sipariş order's own
  // "Baskı Onayı" step (siparis_baski_onay), which needs its own form dialog
  // (SiparisBaskiOnayFormDialog) before it can advance — see canActOnOrder.
  const [siparisBaskiOnayOrder, setSiparisBaskiOnayOrder] = useState(null)

  // Orders worth showing their own tracker for: any still-active one, plus
  // (until the project actually sells) the single most recently approved
  // order — otherwise its tracker would vanish the instant it hits
  // 'onaylandi', even though it hasn't reached 'Satışta' yet. Once the
  // project's stage flips to 'satista' the main StageBar above already
  // says so, so there's nothing left for a per-order tracker to add.
  const sold = project?.stage === 'satista'
  // Matbaa raises a real handover request once printing is done, and it
  // sits 'pending' until Satış confirms it — that's the actual gap between
  // "Üretimde" and "Satışta", not a made-up in-between step.
  const handoverPending = projectHandover?.status === 'pending'
  const trackedOrders = useMemo(() => {
    const active = projectOrders.filter(isActiveOrder)
    if (sold) return active
    const lastApproved = projectOrders
      .filter((o) => o.status === 'onaylandi')
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
    return lastApproved ? [...active, lastApproved] : active
  }, [projectOrders, sold])

  // isOrderAssignedToDesigner's fallback for legacy orders with no
  // assignee_ids of their own — same check MyProjects/SiparisOnay run
  // against the designer's full project list, narrowed to just this project.
  const fallbackProjectIds = useMemo(
    () => new Set((project?.assignees ?? []).some((a) => a.id === user?.id) ? [project?.id] : []),
    [project, user?.id],
  )

  function handleOrderSigned(updated) {
    setProjectOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
    setSignOrder(null)
  }

  // "Teslim Alındı" doesn't remove the order from the queue — it just
  // updates the held order in place (see TalepSignDialog's onUpdated contract).
  function handleOrderUpdated(updated) {
    setProjectOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
    setSignOrder(updated)
  }

  function handleSiparisBaskiOnayApproved(updated) {
    setProjectOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
    if (updated.status !== 'siparis_baski_onay') setSiparisBaskiOnayOrder(null)
  }

  function openOrderAction(order) {
    if (order.status === 'siparis_baski_onay') setSiparisBaskiOnayOrder(order)
    else setSignOrder(order)
  }

  useEffect(() => {
    if (!id) return
    api.listOrderRequests()
      .then((reqs) => setProjectOrders(reqs.filter((r) => r.project_id === id)))
      .catch(() => {})
    api.listHandovers()
      .then((rows) => {
        const mine = rows
          .filter((h) => h.project_id === id)
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        setProjectHandover(mine[0] ?? null)
      })
      .catch(() => {})
  }, [id])

  const isAssigned = (project?.assignees ?? []).some((a) => a.id === user?.id)

  // Distinct designers actually doing work on this project. We include:
  //   1. Anyone with at least one subtask `assigned_to` set (the people
  //      the team leader split the work across).
  //   2. The project primary (`projects.assigned_to`) — BUT only if they
  //      also have at least one subtask. If the team leader moved every
  //      subtask off the primary, the primary has no work to do here
  //      and shouldn't show up in the per-project designer list.
  // Without rule (2) the header renders a designer who isn't actually
  // responsible for any subtask (the user reported this exact issue on
  // project X1: the primary "Abdijibar" had zero subtasks but appeared
  // in the header next to Rahşan and Aylin, who each had real work).
  const allDesigners = useMemo(() => {
    const subs = project?.subtasks ?? []
    const byId = new Map()
    // 1. seed from subtask assignees — these are always real workers
    for (const s of subs) {
      if (s.assigned_to && !byId.has(s.assigned_to)) {
        byId.set(s.assigned_to, { id: s.assigned_to, name: s.assigned_name ?? null })
      }
    }
    // 2. add project primary only if they're already a subtask owner
    const primaryId = project?.assigned_to
    if (primaryId && byId.has(primaryId)) {
      const primary = project?.assignees?.find((a) => a.id === primaryId)
      if (primary) byId.set(primary.id, { ...primary, name: primary.name ?? byId.get(primary.id).name })
    }
    return Array.from(byId.values())
  }, [project?.assignees, project?.assigned_to, project?.subtasks])

  // Stages where a designer may still work on the subtasks after submitting an
  // early demo. The demo can be sent before the design is finished, so as long
  // as the project hasn't hit 100% the assigned designer keeps editing — once
  // it's complete the project can move on to Ozalit (which requires 100%).
  const DEMO_STAGES = ['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay']

  // Base condition: the assigned designer can edit during tasarım, or during a
  // demo stage while the project is still under 100%.
  const canEditBase =
    !project?.deleted_at &&
    user?.role === 'designer' &&
    isAssigned &&
    (project?.stage === 'tasarim' ||
      (DEMO_STAGES.includes(project?.stage) && (project?.progress ?? 0) < 100))

  // The "Güncelle" (what-changed) log is an additive record, so the assigned
  // designer may add updates at any stage — not only during tasarım. Still
  // blocked once the project is deleted — a deleted project is fully
  // frozen/view-only (see `isDeleted` below).
  const canLogUpdate = !project?.deleted_at && user?.role === 'designer' && isAssigned

  // Revision mode: the project is back in tasarım after a rejection and the
  // leader has flagged specific subtasks to revise. Flagged subtasks are
  // editable (rework); subtasks that are done-and-not-flagged are locked
  // (leave them); subtasks that were never done stay editable so the designer
  // can still finish them — they were never "revision", just unfinished work.
  const inRevision =
    project?.stage === 'tasarim' && (project?.subtasks ?? []).some((s) => s.needs_revize)

  // Per-subtask: if the subtask has a specific assigned_to, only that designer can edit it.
  // Exception: 'pages' (İç Sayfalar) is often split across several designers working the
  // same project, so any project-assignee can log pages toward it, not just its assigned_to.
  // During a revision cycle, lock only the done-and-unflagged subtasks.
  function canEditSubtask(sub) {
    if (!canEditBase) return false
    if (sub.kind !== 'pages' && sub.assigned_to && sub.assigned_to !== user?.id) return false
    if (inRevision && !sub.needs_revize && sub.is_done) return false
    return true
  }

  // Kept for the footer hint (true when the base condition is met).
  const canEditSubtasks = canEditBase
  const isLeader = user?.role === 'team_leader'
  // A deleted project stays viewable (see the server's getProjectIncludingDeleted)
  // so anyone who had it open — or clicked the "project deleted" notification —
  // still has context, but every mutation route 404s while it's deleted. Gate
  // the action buttons on this instead of letting each one fail individually.
  const isDeleted = !!project?.deleted_at

  // Demo "Teslim Alındı" gate: at demo_onay / cin_demo_onay, an assigned
  // designer or the team leader marks the delivered demo received; the Onay is
  // blocked until then. Shown only while a demo is delivered and not yet acked.
  const isDemoOnayStage = project?.stage === 'demo_onay' || project?.stage === 'cin_demo_onay'
  const canReceiveDemo =
    isDemoOnayStage && !project?.demo_received && (isLeader || (user?.role === 'designer' && isAssigned))

  // The same pair one leg later: the physical ozalit proof is acknowledged at
  // ozalit_onay before anyone can sign off on it (migration 035). One
  // acknowledgment covers the whole multi-party round.
  const isOzalitOnayStage = project?.stage === 'ozalit_onay'
  const canReceiveOzalit =
    isOzalitOnayStage && !project?.ozalit_received && (isLeader || (user?.role === 'designer' && isAssigned))

  async function handleReceiveDemo() {
    if (!project) return
    setReceiving(true)
    try {
      await api.receiveDemo(project.id)
      await refetch()
      toast.success('Demo teslim alındı.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReceiving(false)
      setTeslimConfirm(null)
    }
  }

  async function handleReceiveOzalit() {
    if (!project) return
    setReceiving(true)
    try {
      await api.receiveOzalit(project.id)
      await refetch()
      toast.success('Ozalit teslim alındı.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReceiving(false)
      setTeslimConfirm(null)
    }
  }

  async function confirmDeleteProject() {
    if (!project) return
    setDeleting(true)
    try {
      await api.deleteProject(project.id)
      toast.success('Proje silindi.')
      navigate('/')
    } catch (err) {
      toast.error(err.message || 'Proje silinemedi.')
      setDeleting(false)
    }
  }

  async function handleRestore() {
    if (!project) return
    setRestoring(true)
    try {
      await api.restoreProject(project.id)
      await refetch()
      toast.success('Proje geri yüklendi.')
    } catch (err) {
      toast.error(err.message || 'Proje geri yüklenemedi.')
    } finally {
      setRestoring(false)
    }
  }

  // The delivered demo never actually reached the leader/designer — send it
  // back to the matbaa so it can be redelivered, instead of leaving the
  // project stuck at demo_onay with no way forward.
  async function handleDemoNotReceived() {
    if (!project) return
    setReportingNotReceived(true)
    try {
      await api.reportDemoNotReceived(project.id)
      await refetch()
      toast.success('Demo teslim alınamadı olarak işaretlendi, matbaaya geri gönderildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReportingNotReceived(false)
      setTeslimConfirm(null)
    }
  }

  // Same escape hatch for a delivered ozalit that never reached the leader/
  // designer — sends it back to the matbaa for redelivery.
  async function handleOzalitNotReceived() {
    if (!project) return
    setReportingNotReceived(true)
    try {
      await api.reportOzalitNotReceived(project.id)
      await refetch()
      toast.success('Ozalit teslim alınamadı olarak işaretlendi, matbaaya geri gönderildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReportingNotReceived(false)
      setTeslimConfirm(null)
    }
  }

  // Matbaa marks they've begun physical work — flag only, no stage change.
  async function handleDemoStart() {
    if (!project) return
    setStartingWork(true)
    try {
      await api.markDemoStarted(project.id)
      await refetch()
      toast.success('Demoya başladığınız işaretlendi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setStartingWork(false)
      setTeslimConfirm(null)
    }
  }
  async function handleOzalitStart() {
    if (!project) return
    setStartingWork(true)
    try {
      await api.markOzalitStarted(project.id)
      await refetch()
      toast.success('Ozalite başladığınız işaretlendi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setStartingWork(false)
      setTeslimConfirm(null)
    }
  }

  // Ekran Demo Onayı — request the lightweight digital alternative to a
  // physical re-demo (migration 050). Only offered on a held demo at 100%.
  async function handleEkranDemoRequest() {
    if (!project) return
    setProcessingEkranDemo(true)
    try {
      await api.requestEkranDemoOnay(project.id)
      await refetch()
      toast.success('Ekran demo onayı istendi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setProcessingEkranDemo(false)
      setTeslimConfirm(null)
    }
  }
  async function handleEkranDemoApprove() {
    if (!project) return
    setProcessingEkranDemo(true)
    try {
      await api.approveEkranDemo(project.id)
      await refetch()
      toast.success('Ekran demo onaylandı.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setProcessingEkranDemo(false)
      setTeslimConfirm(null)
    }
  }

  // Cancel a mistaken demo/ozalit request outright — back to tasarim, no
  // attempt bump. Only offered before the matbaa has started.
  async function handleDemoCancel() {
    if (!project) return
    setCancellingRequest(true)
    try {
      await api.cancelDemoRequest(project.id)
      await refetch()
      toast.success('Demo talebi iptal edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setCancellingRequest(false)
      setTeslimConfirm(null)
    }
  }
  async function handleOzalitCancel() {
    if (!project) return
    setCancellingRequest(true)
    try {
      await api.cancelOzalitRequest(project.id)
      await refetch()
      toast.success('Ozalit talebi iptal edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setCancellingRequest(false)
      setTeslimConfirm(null)
    }
  }

  // Once the matbaa has started, a cancel/edit becomes a request they must
  // accept or decline.
  async function handleRequestChange(kind) {
    if (!project) return
    setRequestingChange(true)
    try {
      if (kind === 'demo') await api.requestDemoChange(project.id, changeRequestNote.trim() || undefined)
      else await api.requestOzalitChange(project.id, changeRequestNote.trim() || undefined)
      await refetch()
      toast.success('Değişiklik talebiniz matbaaya iletildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRequestingChange(false)
      setChangeRequestOpen(null)
      setChangeRequestNote('')
    }
  }

  async function handleDemoChangeAccept() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.acceptDemoChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi kabul edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }
  async function handleDemoChangeDecline() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.declineDemoChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi reddedildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }
  async function handleOzalitChangeAccept() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.acceptOzalitChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi kabul edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }
  async function handleOzalitChangeDecline() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.declineOzalitChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi reddedildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }

  // Copy + handler for each teslim decision, keyed by the pending confirm.
  // Both "Teslim Alınamadı" variants send the project back to the matbaa and
  // bump the attempt counter, so the description says so plainly — that's the
  // one people will regret clicking by accident.
  const TESLIM_CONFIRMS = {
    'demo-received': {
      title: 'Demoyu teslim aldınız mı?',
      description:
        'Demo "Teslim Alındı" olarak işaretlenecek ve onay adımı açılacak. Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Aldım',
      variant: 'success',
      onConfirm: handleReceiveDemo,
    },
    'demo-not-received': {
      title: 'Demo size ulaşmadı mı?',
      description:
        'Proje matbaanın demo teslim aşamasına geri döner ve yeni bir demo turu başlar (Demo sayacı +1). Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Alınamadı',
      variant: 'destructive',
      onConfirm: handleDemoNotReceived,
    },
    'ozalit-received': {
      title: 'Ozaliti teslim aldınız mı?',
      description:
        'Ozalit "Teslim Alındı" olarak işaretlenecek ve onay adımı açılacak. Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Aldım',
      variant: 'success',
      onConfirm: handleReceiveOzalit,
    },
    'ozalit-not-received': {
      title: 'Ozalit size ulaşmadı mı?',
      description:
        'Proje ozalit teslim aşamasına geri döner, matbaa yeniden teslim eder ve verilmiş onaylar sıfırlanır (Ozalit sayacı +1). Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Alınamadı',
      variant: 'destructive',
      onConfirm: handleOzalitNotReceived,
    },
    'demo-cancel': {
      title: 'Demo talebini iptal edin mi?',
      description:
        'Proje doğrudan tasarıma geri döner. Demo sayacı artmaz — hiçbir şey teslim edilmediği için sayılmaz. Bu işlem geri alınamaz.',
      confirmLabel: 'İptal Edin',
      variant: 'destructive',
      onConfirm: handleDemoCancel,
    },
    'ozalit-cancel': {
      title: 'Ozalit talebini iptal edin mi?',
      description:
        'Proje doğrudan tasarıma geri döner. Ozalit sayacı artmaz — hiçbir şey teslim edilmediği için sayılmaz. Bu işlem geri alınamaz.',
      confirmLabel: 'İptal Edin',
      variant: 'destructive',
      onConfirm: handleOzalitCancel,
    },
    'demo-change-accept': {
      title: 'Değişiklik talebini kabul edin mi?',
      description: 'Ekip lideri veya tasarımcı artık demoyu iptal edebilir ya da düzenleyebilir.',
      confirmLabel: 'Kabul Edin',
      variant: 'success',
      onConfirm: handleDemoChangeAccept,
    },
    'demo-change-decline': {
      title: 'Değişiklik talebini reddedin mi?',
      description: 'Süreç normal teslim akışıyla devam eder, talep eden kişi bilgilendirilir.',
      confirmLabel: 'Reddedin',
      variant: 'destructive',
      onConfirm: handleDemoChangeDecline,
    },
    'ozalit-change-accept': {
      title: 'Değişiklik talebini kabul edin mi?',
      description: 'Ekip lideri veya tasarımcı artık ozaliti iptal edebilir ya da düzenleyebilir.',
      confirmLabel: 'Kabul Edin',
      variant: 'success',
      onConfirm: handleOzalitChangeAccept,
    },
    'ozalit-change-decline': {
      title: 'Değişiklik talebini reddedin mi?',
      description: 'Süreç normal teslim akışıyla devam eder, talep eden kişi bilgilendirilir.',
      confirmLabel: 'Reddedin',
      variant: 'destructive',
      onConfirm: handleOzalitChangeDecline,
    },
    'ekran-demo-request': {
      title: 'Ekran demo onayı istensin mi?',
      description:
        'Matbaaya fiziksel demo göndermeden, ekip liderinin ekrandan tek tıkla onaylamasını isteyeceksiniz.',
      confirmLabel: 'İsteyin',
      variant: 'default',
      onConfirm: handleEkranDemoRequest,
    },
    'ekran-demo-approve': {
      title: 'Ekran demo onaylansın mı?',
      description: 'Onayınızla proje bir sonraki aşamaya geçecek. Bu işlem geri alınamaz.',
      confirmLabel: 'Onaylayın',
      variant: 'success',
      onConfirm: handleEkranDemoApprove,
    },
  }
  const pendingTeslim = teslimConfirm ? TESLIM_CONFIRMS[teslimConfirm] : null

  // Available actions depend on the role + stage
  const actions = availableActions({ project, user })
  const advanceLabel = project ? advanceActionLabel(project, user?.role) : 'İlerletin'
  const approveLabel = project ? approveActionLabel(project) : 'Onaylayın'
  // Suppress the "İstendi"/"Gönderildi" pill for anyone who instead has an
  // action button at this stage (the printer, and now the leader/designer at
  // Ozalit Teslim).
  const sentStatus =
    project && user?.role !== 'printer' && !actions.includes('advance')
      ? demoOzalitStatusLabel(project)
      : null

  // Pre-compute demo/ozalit attempt numbers for each history entry so the
  // Görüntüle button can open the correct snapshot.
  const historyWithAttempts = useMemo(() => {
    // Expand each order into one timeline entry per signed stage (like the
    // demo / ozalit attempts), sourced from the order's full signed history.
    // Each of these carries a real order_id + step, so its "Baskı Formu"
    // button in ProjectHistory can jump straight to the actual signed form
    // for that stage instead of a generic stage picker.
    const orderEntries = []
    for (const ord of projectOrders) {
      for (const h of (ord.order_history ?? [])) {
        orderEntries.push({
          id: `ord-${ord.id}-${h.step}`,
          action: 'order',
          order_id: ord.id,
          order_step: h.step,
          order_step_label: h.step.startsWith('reject') ? 'Reddedildi' : (ORDER_STEP_LABELS[h.step] ?? h.step),
          done_by_name: h.signed_by_name,
          created_at: h.signed_at,
        })
      }
    }
    // Drop the raw order_* events (order_request/transfer/advance/final/reject):
    // they're written with no order_id or step (see server/src/routes/orders.js),
    // so their "Baskı Formu" button couldn't route to a specific signed form —
    // the per-stage entries above replace them one-for-one with a working link.
    const base = (project?.history ?? []).filter(
      (h) => h.action !== 'order' && !String(h.event ?? '').startsWith('order_'),
    )
    const merged = [...base, ...orderEntries].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at),
    )

    let demoN = 0
    let ozalitN = 0
    const DEMO_HISTORY_STAGES = ['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay']
    return merged.map((h) => {
      // A re-send (advance from a demo stage back to the teslim stage)
      // STARTS the next demo round, so its own entry — and everything
      // after it — must carry the new number. Rejections close a round
      // instead: the reject entry itself still belongs to the round it
      // rejected, so those increment after stamping.
      const isDemoResend =
        h.action === 'advance' &&
        (h.to_stage === 'demo_teslim' || h.to_stage === 'cin_demo_teslim') &&
        DEMO_HISTORY_STAGES.includes(h.from_stage)
      if (isDemoResend) demoN++
      const entry = { ...h, demoAttemptAt: demoN + 1, ozalitAttemptAt: ozalitN + 1 }
      if (h.action === 'reject' && (h.from_stage === 'demo_onay' || h.from_stage === 'cin_demo_onay')) demoN++
      if (h.action === 'reject' && h.from_stage === 'ozalit_onay') ozalitN++
      return entry
    })
  }, [project?.history, projectOrders])

  // Last rejection reason for the designer's revision banner
  const lastRejectReason =
    project?.last_reject_reason ??
    project?.history?.filter((h) => h.action === 'reject').pop()?.reason

  // Toggle local state only — changes are saved with the "Değişiklikleri Kaydet" button.
  function toggleSubtask(sub) {
    setLocalDone((prev) => {
      const current = prev[sub.id] !== undefined ? prev[sub.id] : sub.is_done
      return { ...prev, [sub.id]: !current }
    })
  }

  // Returns the effective checked state for a subtask — local pending
  // changes (not yet saved via "Değişiklikleri Kaydedin") win over the
  // server value.
  function subtaskChecked(sub) {
    if (!sub) return false
    return localDone[sub.id] !== undefined ? localDone[sub.id] : isSubtaskDone(sub)
  }

  // True if there's at least one unsaved change.
  // IMPORTANT: every `.some` / `.every` / `.filter` here AND below
  // (rendering, hitFullProgress, saveSubtaskChanges) must be safe against
  // `project.subtasks === undefined`. The list-overlay merge in useProjects.js
  // can briefly leave `project.subtasks` undefined (the /api/projects list
  // endpoint only returns scalar columns, never subtasks/history/assignees).
  // The optional chain on `project?.` alone is NOT enough — `?.subtasks` only
  // short-circuits when project itself is undefined. Use `?? []` here, and
  // `project?.subtasks ?? []` for readability.
  const subtasksSafe = project?.subtasks ?? []
  // "Yazılım" never gates progress (see domain/services/progress.js) — the
  // header "X / Y tamamlandı" count and the 100%-completion celebration
  // below both need to agree with that, or the leader sees "2/3 tamamlandı"
  // next to a 100% bar.
  const progressCountedSubtasks = subtasksSafe.filter(countsTowardProgress)
  const hasSubtaskChanges =
    subtasksSafe.some(
      (s) => localDone[s.id] !== undefined && localDone[s.id] !== s.is_done,
    ) ?? false
  // Any subtask still flagged for revision. Blocks the resubmit button until
  // the designer has revized them all (the server enforces the same gate).
  const pendingRevize = subtasksSafe.some((s) => s.needs_revize)

  // Which form the "advance" action opens for the project's current stage.
  // Pulled out of the button's onClick so a ?action=teslim deep link (see
  // below) can trigger the exact same thing a tap on the button would.
  function handleAdvanceAction() {
    // An ozalit-revision redesign resubmits straight to the ozalit flow —
    // open the ozalit form so the resubmit gets the same review step as the
    // very first request.
    if (project.stage === 'tasarim' && project.last_reject_type === 'ozalit') {
      setOzalitFormMode('advance')
      setOzalitFormAttempt(null)
      setOzalitFormOpen(true)
      return
    }
    // Demo stages open the demo form: the designer requests it at Tasarım,
    // the matbaa forwards it at Demo Teslim, and a re-send ("Demo İste") at
    // any demo stage fills a fresh form for the new attempt — all through
    // the same form (read-only for the matbaa), matching the Onaylar page.
    if (
      project.stage === 'tasarim' ||
      project.stage === 'demo_teslim' ||
      project.stage === 'demo_onay' ||
      project.stage === 'cin_demo_teslim' ||
      project.stage === 'cin_demo_onay'
    ) {
      setDemoFormMode('advance')
      setDemoFormAttempt(null)
      setDemoFormOpen(true)
    } else if (project.stage === 'ozalit_teslim') {
      // ozalit teslim → onay: submit the ozalit spec form.
      setOzalitFormMode('advance')
      setOzalitFormAttempt(null)
      setOzalitFormOpen(true)
    } else {
      setDialog('advance')
    }
  }

  // notifyProjectTransition tags the printer's delivery-pending pushes with
  // ?action=teslim (demo_teslim/ozalit_teslim) so the matbaa's tap opens the
  // delivery form directly — their whole job at that stage IS the form, and
  // making them find the "Teslim Edin" button first was the extra tap this
  // removes. Only fires the exact button action, and only when it's actually
  // available (role/stage/gate all still line up) — e.g. if İşlemi Başlatın
  // hasn't been pressed yet, 'advance' isn't offered and this waits for
  // demo_started/ozalit_started to flip before opening the form.
  useEffect(() => {
    if (!project || pendingRevize) return
    const params = new URLSearchParams(location.search)
    if (params.get('action') !== 'teslim') return
    if (!actions.includes('advance')) return
    handleAdvanceAction()
    params.delete('action')
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.stage, project?.demo_started, project?.ozalit_started, pendingRevize, location.search])

  async function saveSubtaskChanges() {
    if (!hasSubtaskChanges) return
    setSaving(true)
    const wasInRevision = inRevision
    const revizeSubs = subtasksSafe.filter((s) => s.needs_revize)
    const revizeJustCompleted =
      wasInRevision &&
      revizeSubs.length > 0 &&
      revizeSubs.every((s) => {
        const done = localDone[s.id] !== undefined ? localDone[s.id] : s.is_done
        return done
      })
    const hitFullProgress =
      user?.role === 'designer' &&
      isAssigned &&
      !wasInRevision &&
      (project?.progress ?? 0) < 100 &&
      progressCountedSubtasks.every((s) =>
        localDone[s.id] !== undefined ? localDone[s.id] : s.is_done,
      )
    try {
      const changed = subtasksSafe.filter(
        (s) => localDone[s.id] !== undefined && localDone[s.id] !== s.is_done,
      )
      for (const sub of changed) {
        await api.setSubtaskDone(sub.id, localDone[sub.id])
      }
      setLocalDone({})
      await refetch()
      toast.success('Değişiklikler kaydedildi.')
      if (revizeJustCompleted || hitFullProgress) celebrate()
    } catch (err) {
      toast.error(err.message || 'Kayıt sırasında hata oluştu.')
    } finally {
      setSaving(false)
    }
  }

  // A completed subtask can be worked on again without unchecking it (e.g.
  // a designer redoes a page after a verbal note from the leader, with no
  // formal rejection/revize flag involved) — this just logs a timeline
  // entry via the same "subtask note" endpoint the designer's notes use,
  // it doesn't touch is_done.
  async function handleRedo(sub) {
    setToggling(sub.id)
    try {
      const { project: updated } = await api.addSubtaskUpdate(sub.id, {
        note: 'Yeniden çalışıldı.',
      })
      setProject((prev) => ({ ...prev, subtasks: updated.subtasks, history: updated.history }))
      toast.success(`${sub.title}, yeniden çalışıldı olarak kaydedildi.`)
    } catch (err) {
      toast.error(err.message || 'Kaydedilemedi.')
    } finally {
      setToggling(null)
    }
  }

  // Designer clears a subtask's revision flag once reworked. The subtask stays
  // complete (progress unchanged); this just logs a "revize edildi" entry and
  // drops the flag. Once none remain, the resubmit button unlocks.
  async function handleRevize(sub) {
    setToggling(sub.id)
    try {
      await api.reviseSubtask(sub.id)
      await refetch()
      toast.success(`${sub.title}, revize edildi.`)
    } catch (err) {
      toast.error(err.message || 'Revize kaydedilemedi.')
    } finally {
      setToggling(null)
    }
  }

  function onActionDone(updated) {
    setProject((prev) => ({ ...prev, ...updated }))
    refetch()
  }

  if (loading) {
    return (
      <>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full rounded-xl" />
          {/* 1-col on mobile/tablet, 3-col only on lg+ — subtasks + history
              stack vertically below desktop. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Skeleton className="h-64 lg:col-span-2" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </>
    )
  }

  if (!project) {
    return (
      <>
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <p className="text-sm font-medium text-foreground">Proje bulunamadı.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={goBack}>
            Geri dön
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={goBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Geri dön
          </Button>
        </div>

        {isDeleted && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
            <div className="flex items-start gap-2">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm">
                Bu proje silindi{project.deleted_by_name ? `, ${project.deleted_by_name} tarafından` : ''}
                {project.deleted_at ? `, ${formatDateTr(project.deleted_at)}` : ''}
              </p>
            </div>
            {isLeader && (
              <Button size="sm" variant="outline" onClick={handleRestore} disabled={restoring} loading={restoring}>
                {restoring ? 'Geri yükleniyor…' : 'Geri Yükleyin'}
              </Button>
            )}
          </div>
        )}

        {/* Header */}
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-mono">
                    {TYPE_LABELS[project.type]}
                  </Badge>
                  <Badge variant="outline" className="font-medium">
                    {/* A demo/ozalit in process reads "…İstendi"/"…Gönderildi"
                        instead of the raw pipeline stage name — see
                        demoOzalitStatusLabel for the demo_started/ozalit_started
                        split (still cancelable vs. actually with the matbaa). */}
                    {demoOzalitStatusLabel(project) ?? STAGE_LABELS[project.stage]}
                  </Badge>
                  {project.demo_attempt > 0 && (
                    <Badge variant="outline" className="font-medium text-muted-foreground">
                      Demo {project.demo_attempt + 1}
                    </Badge>
                  )}
                  {project.ozalit_attempt > 0 && (
                    <Badge variant="outline" className="font-medium text-blue-600">
                      Ozalit {project.ozalit_attempt + 1}
                    </Badge>
                  )}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <UserIcon className="h-3.5 w-3.5" />
                    {project.assigned_name}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Hedef: {formatDateTr(project.target_month, { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
              </div>

              {!isDeleted && isLeader && (
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Projeyi Düzenleyin
                </Button>
              )}
              </div>

              {!isDeleted && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Demo formu görüntüle — demo gönderildikten sonra. Also open to
                    the assigned designer, not just the leader: demo's own
                    isReadOnly already permits designer edits in mode='view'
                    (migration 048 closed this button-visibility gap). */}
                {(isLeader || (user?.role === 'designer' && isAssigned)) && ['demo_teslim', 'cin_demo_teslim', 'demo_onay', 'cin_demo_onay', 'ozalit_teslim', 'ozalit_onay', 'baskida', 'gumruk', 'satista'].includes(project.stage) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setDemoFormMode('view'); setDemoFormAttempt(null); setDemoFormNotify(false); setDemoFormOpen(true) }}
                  >
                    <FileText className="h-4 w-4" />
                    Demo Formu
                  </Button>
                )}
                {/* Ozalit formu görüntüle — now also while it's in flight with the
                    matbaa (ozalit_teslim/ozalit_onay), not just from baski_onay
                    onward, so the leader can reach "Değişiklik İste" from the
                    same place they'd normally edit (migration 048). Visibility
                    only — ozalit's isReadOnly still restricts saving to
                    team_leader, so the designer's button here is view-only.
                    TR only — ÇİN has no ozalit leg. */}
                {(isLeader || (user?.role === 'designer' && isAssigned)) && ['ozalit_teslim', 'ozalit_onay', 'baski_onay', 'baskida', 'gumruk', 'satista'].includes(project.stage) && project.type === 'TR' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setOzalitFormMode('view'); setOzalitFormAttempt(null); setOzalitFormNotify(false); setOzalitFormOpen(true) }}
                  >
                    <FileText className="h-4 w-4" />
                    Ozalit Formu
                  </Button>
                )}
                {/* Baskı Onay Formu görüntüle — baski_onay/cin_baski_onay aşaması
                    geçildikten sonra da erişilebilir kalsın, her iki pipeline için. */}
                {isLeader && ['baskida', 'gumruk', 'satista'].includes(project.stage) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setBaskiOnayFormMode('view'); setBaskiOnayFormOpen(true) }}
                  >
                    <FileText className="h-4 w-4" />
                    Baskı Onay Formu
                  </Button>
                )}
                {actions.includes('advance') && (
                  <Button
                    size="sm"
                    disabled={pendingRevize}
                    title={pendingRevize ? 'Önce revize bekleyen alt görevleri revize edin.' : undefined}
                    onClick={handleAdvanceAction}
                  >
                    <Send className="h-4 w-4" />
                    {advanceLabel}
                  </Button>
                )}
                {/* Matbaa "Başladım" — flag-only, marks physical work begun.
                    Once set, a cancel/edit from the leader/designer needs
                    the matbaa's OK (migration 048). Opens the spec form first
                    so the matbaa reviews what they're about to produce —
                    İşlemi Başlatın itself lives in the form's footer. */}
                {canMarkDemoStarted(user, project) && (
                  <Button
                    size="sm"
                    onClick={() => { setDemoFormMode('view'); setDemoFormAttempt(null); setDemoFormNotify(false); setDemoFormOpen(true) }}
                    disabled={startingWork}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {startingWork ? 'İşleniyor…' : 'İşlemi Başlatın'}
                  </Button>
                )}
                {canMarkOzalitStarted(user, project) && (
                  <Button
                    size="sm"
                    onClick={() => { setOzalitFormMode('view'); setOzalitFormAttempt(null); setOzalitFormNotify(false); setOzalitFormOpen(true) }}
                    disabled={startingWork}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {startingWork ? 'İşleniyor…' : 'İşlemi Başlatın'}
                  </Button>
                )}
                {/* Fix owed, printer's turn to wait — canMarkDemoStarted/
                    canMarkOzalitStarted above already hides İşlemi Başlatın
                    for this, so without this the printer's action row goes
                    silently empty with no clue why. */}
                {user?.role === 'printer' &&
                  (project.stage === 'demo_teslim' || project.stage === 'cin_demo_teslim') &&
                  project.demo_fix_pending && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
                    <Clock className="h-4 w-4" />
                    Değişiklik talebini kabul ettiniz, ekip liderinin düzeltmeyi göndermesi bekleniyor
                  </span>
                )}
                {user?.role === 'printer' && project.stage === 'ozalit_teslim' && project.ozalit_fix_pending && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
                    <Clock className="h-4 w-4" />
                    Değişiklik talebini kabul ettiniz, ekip liderinin düzeltmeyi göndermesi bekleniyor
                  </span>
                )}
                {/* Undo a mistaken request outright — only while the matbaa
                    hasn't started yet, so nothing was actually delivered. */}
                {canEditSentDemoRequest(user, project) && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => { setDemoFormMode('view'); setDemoFormAttempt(null); setDemoFormNotify(true); setDemoFormOpen(true) }}
                  >
                    <Pencil className="h-4 w-4" />
                    Gönderilen Demoyu Düzenleyin
                  </Button>
                )}
                {canCancelDemoRequest(user, project) && (
                  <Button
                    size="sm" variant="destructive"
                    onClick={() => setTeslimConfirm('demo-cancel')}
                    disabled={cancellingRequest}
                  >
                    <Trash2 className="h-4 w-4" />
                    {cancellingRequest ? 'İşleniyor…' : 'Demo İsteğini İptal Edin'}
                  </Button>
                )}
                {canEditSentOzalitRequest(user, project) && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => { setOzalitFormMode('view'); setOzalitFormAttempt(null); setOzalitFormNotify(true); setOzalitFormOpen(true) }}
                  >
                    <Pencil className="h-4 w-4" />
                    Gönderilen Ozaliti Düzenleyin
                  </Button>
                )}
                {canCancelOzalitRequest(user, project) && (
                  <Button
                    size="sm" variant="destructive"
                    onClick={() => setTeslimConfirm('ozalit-cancel')}
                    disabled={cancellingRequest}
                  >
                    <Trash2 className="h-4 w-4" />
                    {cancellingRequest ? 'İşleniyor…' : 'Ozalit İsteğini İptal Edin'}
                  </Button>
                )}
                {/* Once started, a cancel/edit is a request the matbaa must
                    accept or decline. */}
                {canRequestDemoChange(user, project) && (
                  <Button size="sm" variant="outline" onClick={() => setChangeRequestOpen('demo')}>
                    <AlertTriangle className="h-4 w-4" />
                    Değişiklik İste
                  </Button>
                )}
                {canRequestOzalitChange(user, project) && (
                  <Button size="sm" variant="outline" onClick={() => setChangeRequestOpen('ozalit')}>
                    <AlertTriangle className="h-4 w-4" />
                    Değişiklik İste
                  </Button>
                )}
                {!canRequestDemoChange(user, project) && project?.demo_change_requested_at &&
                  (isLeader || (user?.role === 'designer' && isAssigned)) &&
                  ['demo_teslim', 'cin_demo_teslim'].includes(project.stage) && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
                    <Clock className="h-4 w-4" />
                    Değişiklik talebi gönderildi, matbaa yanıtı bekleniyor
                  </span>
                )}
                {!canRequestOzalitChange(user, project) && project?.ozalit_change_requested_at &&
                  (isLeader || (user?.role === 'designer' && isAssigned)) &&
                  project.stage === 'ozalit_teslim' && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
                    <Clock className="h-4 w-4" />
                    Değişiklik talebi gönderildi, matbaa yanıtı bekleniyor
                  </span>
                )}
                {/* The matbaa's answer to a pending change-request. */}
                {canRespondDemoChange(user, project) && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {project.demo_change_requested_by_name ?? 'Ekipten biri'}
                      {project.demo_change_requested_note ? `: ${project.demo_change_requested_note}` : ' değişiklik istiyor'}
                    </span>
                    <Button size="sm" variant="success" onClick={() => setTeslimConfirm('demo-change-accept')} disabled={respondingChange}>
                      <ThumbsUp className="h-4 w-4" />
                      Kabul Et
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTeslimConfirm('demo-change-decline')} disabled={respondingChange}>
                      <ThumbsDown className="h-4 w-4" />
                      Reddet
                    </Button>
                  </div>
                )}
                {canRespondOzalitChange(user, project) && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {project.ozalit_change_requested_by_name ?? 'Ekipten biri'}
                      {project.ozalit_change_requested_note ? `: ${project.ozalit_change_requested_note}` : ' değişiklik istiyor'}
                    </span>
                    <Button size="sm" variant="success" onClick={() => setTeslimConfirm('ozalit-change-accept')} disabled={respondingChange}>
                      <ThumbsUp className="h-4 w-4" />
                      Kabul Et
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTeslimConfirm('ozalit-change-decline')} disabled={respondingChange}>
                      <ThumbsDown className="h-4 w-4" />
                      Reddet
                    </Button>
                  </div>
                )}
                {/* Demo "Teslim Alındı" gate — before the Onay. */}
                {canReceiveDemo && (
                  <Button size="sm" onClick={() => setTeslimConfirm('demo-received')} disabled={receiving || reportingNotReceived}>
                    <CheckCircle2 className="h-4 w-4" />
                    {receiving ? 'İşleniyor…' : 'Teslim Alındı'}
                  </Button>
                )}
                {/* Escape hatch: the demo was delivered but never actually
                    reached anyone — send it back to the matbaa instead of
                    leaving the project stuck here. */}
                {canReceiveDemo && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTeslimConfirm('demo-not-received')}
                    disabled={receiving || reportingNotReceived}
                  >
                    <PackageX className="h-4 w-4" />
                    {reportingNotReceived ? 'İşleniyor…' : 'Teslim Alınamadı'}
                  </Button>
                )}
                {/* Ozalit "Teslim Alındı" gate — the same pair before Ozalit
                    Onayı. Onayla/Reddet stay hidden until this is clicked
                    (see availableActions). */}
                {canReceiveOzalit && (
                  <Button size="sm" onClick={() => setTeslimConfirm('ozalit-received')} disabled={receiving || reportingNotReceived}>
                    <CheckCircle2 className="h-4 w-4" />
                    {receiving ? 'İşleniyor…' : 'Teslim Alındı'}
                  </Button>
                )}
                {canReceiveOzalit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTeslimConfirm('ozalit-not-received')}
                    disabled={receiving || reportingNotReceived}
                  >
                    <PackageX className="h-4 w-4" />
                    {reportingNotReceived ? 'İşleniyor…' : 'Teslim Alınamadı'}
                  </Button>
                )}
                {isOzalitOnayStage && project.ozalit_received && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {project.ozalit_received_by ? `${project.ozalit_received_by} ozaliti teslim aldı` : 'Ozalit teslim alındı'}
                  </span>
                )}
                {isDemoOnayStage && project.demo_received && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {project.demo_received_by ? `${project.demo_received_by} demoyu teslim aldı` : 'Demo teslim alındı'}
                  </span>
                )}
                {actions.includes('approve') && (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => {
                      if (project.stage === 'ozalit_onay') {
                        setOzalitFormMode('approve')
                        setOzalitFormOpen(true)
                      } else if (project.stage === 'baski_onay' || project.stage === 'cin_baski_onay') {
                        setBaskiOnayFormMode('approve')
                        setBaskiOnayFormOpen(true)
                      } else {
                        setDialog('approve')
                      }
                    }}
                  >
                    <ThumbsUp className="h-4 w-4" />
                    {approveLabel}
                  </Button>
                )}
                {/* Demo-hold hint: the leader has already approved the first
                    demo but the design wasn't 100%, so the project sits at
                    demo_onay waiting for the designer to finish and re-send.
                    This replaces the approve/reject buttons (which are
                    hidden in this state — see availableActions). */}
                {(project.stage === 'demo_onay' || project.stage === 'cin_demo_onay') &&
                  project.demo_held === true &&
                  (project.progress ?? 0) < 100 && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800"
                      title="Tasarımcı kalan görevleri bitirip yeni demo gönderdiğinde ilerleyecek"
                    >
                      <Clock className="h-3.5 w-3.5" />
                      Tasarım tamamlanmadı, tasarımcı yeni demo gönderdiğinde ilerleyecek
                    </span>
                  )}
                {/* Ekran Demo Onayı (migration 050) — a held demo (approved
                    at <100%) that's since reached 100% can either send a
                    normal physical demo (the "Demo İste" advance button
                    above) OR ask for a lightweight digital approval instead.
                    Both are offered side by side; the designer/leader picks
                    one. */}
                {canRequestEkranDemo(user, project) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTeslimConfirm('ekran-demo-request')}
                    disabled={processingEkranDemo}
                  >
                    <Send className="h-4 w-4" />
                    Ekran Demo Onayı İsteyin
                  </Button>
                )}
                {project.ekran_demo_requested_at != null && !canRespondEkranDemo(user, project) && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800"
                    title="Ekip lideri ekrandan onayladığında proje ilerleyecek"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Ekran demo onayı istendi, ekip lideri onayı bekleniyor
                  </span>
                )}
                {canRespondEkranDemo(user, project) && (
                  <>
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => setTeslimConfirm('ekran-demo-approve')}
                      disabled={processingEkranDemo}
                    >
                      <ThumbsUp className="h-4 w-4" />
                      Ekran Demoyu Onaylayın
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setEkranDemoRejectOpen(true)}
                      disabled={processingEkranDemo}
                    >
                      <ThumbsDown className="h-4 w-4" />
                      Reddet
                    </Button>
                  </>
                )}
                {actions.includes('reject') && (
                  <Button size="sm" variant="destructive" onClick={() => setDialog('reject')}>
                    <ThumbsDown className="h-4 w-4" />
                    Reddet
                  </Button>
                )}
                {sentStatus && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                    <Send className="h-4 w-4" />
                    {sentStatus}
                  </span>
                )}
              </div>
              )}

            {/* Ozalit requested — handed to the matbaa, waiting for delivery */}
            {project.stage === 'ozalit_teslim' && project.ozalit_requested && (
              <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-blue-800">
                    Ozalit istendi, matbaa teslimi bekleniyor
                  </p>
                  <p className="mt-0.5 text-xs text-blue-600">
                    {user?.role === 'printer'
                      ? 'Ozaliti teslim ettiğinizde ekip lideri ve tasarımcı onayına gönderilecek.'
                      : 'Matbaa ozaliti teslim ettiğinde onay aşamasına geçecek.'}
                  </p>
                </div>
              </div>
            )}

            {/* Ozalit delivered but not yet acknowledged — the receipt step
                comes before any sign-off, so the approval progress panel below
                would be misleading here (nobody can approve yet). */}
            {isOzalitOnayStage && !project.ozalit_received && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-800">
                    Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor
                  </p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    {canReceiveOzalit
                      ? 'Ozalit elinize ulaştıysa "Teslim Alındı"ya basın; onay adımı ondan sonra açılır. Ulaşmadıysa "Teslim Alınamadı" ile matbaaya geri gönderin.'
                      : 'Ekip lideri veya atanmış tasarımcı ozaliti teslim aldı olarak işaretleyene kadar onay verilemez.'}
                  </p>
                </div>
              </div>
            )}

            {/* Ozalit onay — multi-party approval progress. Every team leader
                AND every assigned designer must approve before it advances. */}
            {isOzalitOnayStage && project.ozalit_received && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-sm font-semibold text-emerald-800">
                  Ozalit onayı, tüm ekip liderleri ve atanmış tasarımcılar onaylamalı
                </p>
                {/* Leader-first: designers counter-sign after a leader has
                    approved, so say whose move it is instead of leaving them
                    hunting for a button they don't have yet. */}
                {!ozalitLeaderApproved(project) && (
                  <p className="mt-1 text-xs text-emerald-700">
                    {user?.role === 'designer'
                      ? 'Önce ekip lideri onaylayacak, ardından onayınız açılır.'
                      : 'Onay sırası ekip liderinde, tasarımcı onayı ondan sonra verilebilir.'}
                  </p>
                )}
                {(project.ozalit_approvals ?? []).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(project.ozalit_approvals ?? []).map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"
                      >
                        <CheckCircle2 className="h-3 w-3" /> {a.name}
                        <span className="text-emerald-500">· {a.role === 'team_leader' ? 'Lider' : 'Tasarımcı'}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-emerald-600">Henüz onay verilmedi.</p>
                )}
              </div>
            )}

            {/* Rejection banner — shown whenever the project is back in tasarım after a rejection */}
            {isAssigned && project.stage === 'tasarim' && ((project.demo_attempt ?? 0) > 0 || (project.ozalit_attempt ?? 0) > 0) && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-800">
                    {project.last_reject_type === 'ozalit'
                      ? `Ozalit reddedildi, revizyon gerekiyor (${(project.ozalit_attempt ?? 0) + 1}. deneme)`
                      : `Demo reddedildi, revizyon gerekiyor (${(project.demo_attempt ?? 0) + 1}. deneme)`}
                  </p>
                  {lastRejectReason && (
                    <p className="mt-0.5 text-sm text-amber-700">"{lastRejectReason}"</p>
                  )}
                  <p className="mt-1 text-xs text-amber-600">
                    Aşağıdaki revize görevlerini tamamlayın, ardından değişiklikleri kaydedin ve yeniden gönderin.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>İlerleme</span>
                <span className="font-semibold text-foreground">{project.progress}%</span>
              </div>
              <Progress value={project.progress} className="h-2" />
            </div>

            {/* The main pipeline freezes while a sipariş is in flight or
                still awaiting its sale (the project's stage only moves on
                final order approval and, later, handover confirmation) —
                showing it alongside a tracker that isn't moving is just
                confusing, so it's replaced by the order's own tracker(s)
                below for as long as any are tracked. `-mx-1` lets the
                StageBar bleed to the card edge so the scroll affordance (if
                needed at narrow widths) sits flush; padding is restored on
                the scroll container itself. */}
            {trackedOrders.length === 0 && (
              <div className="-mx-1 rounded-lg bg-muted/30 py-5">
                <div className="overflow-x-auto px-1">
                  <StageBar type={project.type} stage={project.stage} />
                </div>
              </div>
            )}

            {/* More than one can be active at once now that concurrent
                orders are allowed. */}
            {trackedOrders.map((o) => (
              <OrderProgressStepper
                key={o.id}
                order={o}
                sold={sold && o.status === 'onaylandi'}
                handoverPending={handoverPending && o.status === 'onaylandi'}
                canAct={canActOnOrder(user, o, fallbackProjectIds)}
                onAct={() => openOrderAction(o)}
              />
            ))}
          </CardContent>
        </Card>

        {/* Body grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ProjectHistory
            entries={historyWithAttempts}
            projectType={project.type}
            onOpenDemoForm={(attempt) => {
              setDemoFormAttempt(attempt)
              setDemoFormMode('history')
              setDemoFormOpen(true)
            }}
            onOpenOzalitForm={(attempt) => {
              setOzalitFormAttempt(attempt)
              setOzalitFormMode('history')
              setOzalitFormOpen(true)
            }}
          />

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {allDesigners.length > 1 ? (
                    <UsersIcon className="h-4 w-4" />
                  ) : (
                    <UserIcon className="h-4 w-4" />
                  )}
                  {allDesigners.length > 1 ? 'Tasarımcılar' : 'Tasarımcı'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {allDesigners.length === 0 && (
                  <p className="text-xs text-muted-foreground">Henüz tasarımcı atanmadı.</p>
                )}
                {allDesigners.map((a) => {
                  // Surface which subtasks this designer owns so the team
                  // leader can see at a glance who is doing what — even when
                  // the project-level primary doesn't include them.
                  const owns = (project?.subtasks ?? [])
                    .filter((s) => s.assigned_to === a.id)
                    .map((s) => s.title)
                  return (
                    <div key={a.id} className="flex items-start gap-3">
                      <UserAvatar user={a} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{a.name ?? a.id}</p>
                        <p className="text-xs text-muted-foreground">Tasarımcı</p>
                        {owns.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {owns.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Alt Görevler</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {progressCountedSubtasks.filter((s) => subtaskChecked(s)).length} / {progressCountedSubtasks.length} tamamlandı
                  </span>
                  {canEditSubtasks && hasSubtaskChanges && (
                    <Button size="sm" onClick={saveSubtaskChanges} disabled={saving}>
                      <Save className="h-4 w-4" />
                      {saving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydedin'}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {(project.subtasks ?? []).length === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                    Bu proje için alt görev tanımlanmamış.
                  </p>
                ) : (
                  <>
                    {/* During a revision cycle, the leader-flagged subtasks lead the list. */}
                    {inRevision && (
                      <p className="pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                        {project.last_reject_type === 'ozalit' ? 'Ozalit Revize Görevleri' : 'Demo Revize Görevleri'}
                      </p>
                    )}

                    {(project.subtasks ?? [])
                      .filter((s) => s.kind !== 'revize')
                      .map((s) => {
                        const canEdit = canEditSubtask(s)
                        const flagged = inRevision && s.needs_revize
                        const lockedDone = inRevision && !s.needs_revize && s.is_done

                        return (
                          <div key={s.id} className="space-y-1.5">
                          <label
                            key={s.id}
                            className={cn(
                              'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-background px-3 py-2.5 text-sm transition',
                              flagged
                                ? subtaskChecked(s)
                                  ? 'border-emerald-200 bg-emerald-50/40'
                                  : 'border-amber-200 bg-amber-50/40 hover:border-amber-300'
                                : subtaskChecked(s)
                                  ? 'border-emerald-200 bg-emerald-50/40'
                                  : 'hover:border-primary/30',
                              lockedDone && 'opacity-60',
                              localDone[s.id] !== undefined && localDone[s.id] !== s.is_done &&
                                (flagged ? 'ring-2 ring-amber-300' : 'ring-2 ring-primary/30'),
                              !canEdit && 'cursor-default',
                            )}
                          >
                            <Checkbox
                              checked={subtaskChecked(s)}
                              onCheckedChange={() => canEdit && !flagged && toggleSubtask(s)}
                              disabled={!canEdit || flagged}
                            />
                            <span className={cn('min-w-0 flex-1 basis-40', subtaskChecked(s) && 'text-muted-foreground line-through')}>
                              {s.title}
                            </span>
                            <div className="flex flex-wrap items-center justify-end gap-1.5 pl-7 sm:pl-0">
                              {flagged && canEdit && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRevize(s) }}
                                  disabled={toggling === s.id}
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                                >
                                  {toggling === s.id ? 'Kaydediliyor…' : 'Revize Edin'}
                                </button>
                              )}
                              {flagged && !canEdit && (
                                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                  Revize bekliyor
                                </span>
                              )}
                              {lockedDone && (
                                <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                                  Revize gerekmiyor
                                </span>
                              )}
                              {s.assigned_to && (
                                <span
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                                  title={`Bu alt görevin tasarımcısı: ${s.assigned_name ?? s.assigned_to}`}
                                >
                                  <UserIcon className="h-2.5 w-2.5 shrink-0" />
                                  {s.assigned_name ?? initials(s.assigned_to)}
                                </span>
                              )}
                              {localDone[s.id] !== undefined && localDone[s.id] !== s.is_done && (
                                <span className={cn('whitespace-nowrap text-[11px] font-medium', flagged ? 'text-amber-600' : 'text-primary')}>
                                  kaydedilmedi
                                </span>
                              )}
                              {!flagged && !lockedDone && subtaskChecked(s) && s.is_done && s.done_at && localDone[s.id] === undefined && (
                                <span className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTr(s.done_at)}</span>
                              )}
                              {!flagged && !lockedDone && canEdit && s.is_done && localDone[s.id] === undefined && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRedo(s) }}
                                  disabled={toggling === s.id}
                                  title="Bu görev üzerinde tekrar çalıştığınızı kaydedin"
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
                                >
                                  {toggling === s.id ? 'Kaydediliyor…' : 'Yeniden Çalıştım'}
                                </button>
                              )}
                            </div>
                          </label>
                          </div>
                        )
                      })}
                  </>
                )}
                {!canEditSubtasks && (
                  <p className="pt-2 text-[11px] text-muted-foreground">
                    {isLeader
                      ? 'Alt görevleri sadece atanmış tasarımcı işaretleyebilir.'
                      : isAssigned
                        ? 'Bu aşamada alt görev düzenlenemez.'
                        : 'Bu projeye atanmadığınız için alt görevleri düzenleyemezsiniz.'}
                  </p>
                )}
                {canEditSubtasks && (project.subtasks ?? []).some((s) => s.assigned_to && s.assigned_to !== user?.id) && (
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    Size atanmayan alt görevler (
                    <UserIcon className="inline h-2.5 w-2.5" /> ikonlu) düzenlenemez.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ApprovalDialog
        open={!!dialog}
        onOpenChange={(v) => setDialog(v ? dialog : null)}
        project={project}
        mode={dialog || 'approve'}
        advanceLabel={advanceLabel}
        onDone={onActionDone}
      />

      <EkranDemoRejectDialog
        open={ekranDemoRejectOpen}
        onOpenChange={setEkranDemoRejectOpen}
        project={project}
        onDone={onActionDone}
      />

      <NewProjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
        onUpdated={(updated) => {
          setProject((prev) => ({ ...prev, ...updated }))
          refetch()
        }}
        onDelete={() => {
          setEditOpen(false)
          setDeleteOpen(true)
        }}
      />

      <OzalitFormDialog
        open={ozalitFormOpen}
        onOpenChange={(v) => { setOzalitFormOpen(v); if (!v) { setOzalitFormAttempt(null); setOzalitFormNotify(false) } }}
        project={project}
        mode={ozalitFormMode}
        viewAttempt={ozalitFormAttempt}
        notifyOnSave={ozalitFormNotify}
        onDone={onActionDone}
        onStartWork={canMarkOzalitStarted(user, project) ? async () => { await handleOzalitStart(); setOzalitFormOpen(false) } : undefined}
        startingWork={startingWork}
      />

      <BaskiOnayFormDialog
        open={baskiOnayFormOpen}
        onOpenChange={setBaskiOnayFormOpen}
        project={project}
        mode={baskiOnayFormMode}
        onDone={onActionDone}
      />

      <DemoFormDialog
        open={demoFormOpen}
        onOpenChange={(v) => { setDemoFormOpen(v); if (!v) { setDemoFormAttempt(null); setDemoFormNotify(false) } }}
        project={project}
        mode={demoFormMode}
        viewAttempt={demoFormAttempt}
        notifyOnSave={demoFormNotify}
        onStartWork={canMarkDemoStarted(user, project) ? async () => { await handleDemoStart(); setDemoFormOpen(false) } : undefined}
        startingWork={startingWork}
        onDone={onActionDone}
      />

      <TalepSignDialog
        order={signOrder}
        open={!!signOrder}
        onOpenChange={(v) => !v && setSignOrder(null)}
        onSigned={handleOrderSigned}
        onUpdated={handleOrderUpdated}
      />

      <SiparisBaskiOnayFormDialog
        order={siparisBaskiOnayOrder}
        open={!!siparisBaskiOnayOrder}
        onOpenChange={(v) => !v && setSiparisBaskiOnayOrder(null)}
        onApproved={handleSiparisBaskiOnayApproved}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Projeyi sil"
        description={project && (
          <span className="block space-y-2.5">
            <span className="block">"{project.title}" Silinen Projeler'e taşınacak. İstediğiniz zaman geri yükleyebilirsiniz.</span>
            {IN_FLIGHT_DEMO_OZALIT_STAGES.has(project.stage) && (
              <span className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{STAGE_LABELS[project.stage]} bekleniyor, silinirse kuyruktan kaybolur.</span>
              </span>
            )}
          </span>
        )}
        confirmLabel="Sil"
        cancelLabel="Vazgeç"
        variant="destructive"
        busy={deleting}
        busyLabel="Siliniyor…"
        onConfirm={confirmDeleteProject}
      />

      {/* Second step in front of the four teslim decisions. They're one click,
          they can't be undone from the UI, and "Teslim Alındı" sits right next
          to "Teslim Alınamadı" — which sends the whole thing back to the
          matbaa. See TESLIM_CONFIRMS for the per-action copy. */}
      <ConfirmDialog
        open={!!pendingTeslim}
        onOpenChange={(v) => !v && setTeslimConfirm(null)}
        title={pendingTeslim?.title}
        description={pendingTeslim?.description}
        confirmLabel={pendingTeslim?.confirmLabel}
        cancelLabel="Vazgeç"
        variant={pendingTeslim?.variant}
        busy={receiving || reportingNotReceived || startingWork || cancellingRequest || respondingChange || processingEkranDemo}
        onConfirm={() => pendingTeslim?.onConfirm?.()}
      />

      {/* Matbaa "Başladım" gate (migration 048): once started, a cancel/edit
          from the leader/designer needs an optional note explaining what
          they want, sent to the matbaa for accept/decline. */}
      <Dialog open={!!changeRequestOpen} onOpenChange={(v) => !v && !requestingChange && setChangeRequestOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Değişiklik isteyin</DialogTitle>
            <DialogDescription>
              Matbaa {changeRequestOpen === 'demo' ? 'demoya' : 'ozalite'} zaten başladı. Ne değiştirmek
              istediğinizi kısaca yazabilirsiniz — matbaa kabul ederse iptal veya düzenleme yapabilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={changeRequestNote}
            onChange={(e) => setChangeRequestNote(e.target.value)}
            placeholder="Örn: renk yanlış, iptal etmek istiyorum…"
            maxLength={500}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setChangeRequestOpen(null)} disabled={requestingChange}>
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={() => handleRequestChange(changeRequestOpen)}
              disabled={requestingChange}
              loading={requestingChange}
            >
              {requestingChange ? 'Gönderiliyor…' : 'Talebi Gönderin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Decide which action buttons are available for the current user/stage.
 *
 * Flow: the assigned designer submits the finished design to Demo Teslim (only
 * at 100%). The printer (matbaa) forwards each *_teslim stage to the leader's
 * approval. The leader approves or rejects (reason required) at every *_onay
 * stage, and moves production / customs forward.
 */
function availableActions({ project, user }) {
  if (!project || !user) return []
  // Imported backlist products (origin='legacy', migration 031) have no design
  // phase: no subtasks, no designer, no demo/ozalit history. Every pipeline
  // route 400s on them server-side (assertNotLegacy), so offer no transition
  // buttons at all rather than buttons that fail. A new print run for one of
  // these starts as a sipariş, which is unaffected.
  if (isLegacyProject(project)) return []
  const role = user.role
  const stage = project.stage
  const set = new Set()

  // Team leader moves a project forward. TR demo/ozalit teslim are forwarded by
  // the printer (matbaa) via the approval queue, so the leader doesn't advance
  // those — instead they see an "İstendi"/"Gönderildi" status (see demoOzalitStatusLabel).
  //
  // The leader no longer pushes a project into Satışta: reaching Satışta now
  // happens only when Sales confirms Matbaa's handover ("Alındı"). So the leader
  // advances 'tasarim' and 'cin_demo_teslim', plus ÇİN 'baskida' → 'gumruk'
  // (customs). TR 'baskida' and ÇİN 'gumruk' are handled by the handover flow.
  const leaderAdvanceable = new Set(['tasarim', 'cin_demo_teslim'])
  if (
    role === 'team_leader' &&
    (leaderAdvanceable.has(stage) || (stage === 'baskida' && project.type === 'CIN'))
  ) {
    set.add('advance')
  }
  const isAssignedDesigner =
    role === 'designer' && (project.assignees ?? []).some((a) => a.id === user.id)

  if ((stage === 'demo_onay' || stage === 'cin_demo_onay') && role === 'team_leader') {
    // Hide Onayla + Reddet until the demo has been received (Teslim Alındı)
    // and while the demo is held. The leader can't approve/reject a demo
    // they haven't taken delivery of yet, and once held, the project is
    // waiting for the designer to re-send a second demo.
    if (project.demo_received === true && project.demo_held !== true) {
      set.add('approve')
      set.add('reject')
    }
  }

  // Re-send demo: only valid on a HELD demo (approved at <100% — the
  // designer has since finished and sends the next round). A demo that's
  // freshly delivered and awaiting the leader's decision (demo_held falsey)
  // is still in progress: the leader must approve or reject it, not spawn a
  // duplicate. And while a demo is in flight at demo_teslim / cin_demo_teslim
  // the header shows the "İstendi"/"Gönderildi" pill (see demoOzalitStatusLabel).
  if (
    (stage === 'demo_onay' || stage === 'cin_demo_onay') &&
    project.demo_held === true &&
    (role === 'team_leader' || isAssignedDesigner)
  ) {
    set.add('advance')
  }

  // Ozalit Onay: multi-party approval. Every team leader AND every assigned
  // designer must approve before it advances to Üretime Hazır. Each may approve
  // once (hidden after they have). Only the team leader can reject.
  //
  // Nothing is decidable until the physical proof has been marked "Teslim
  // Alındı" (migration 035) — the same rule the demo leg has: you can't sign
  // off on a proof nobody has taken delivery of. Until then the action row
  // shows the Teslim Alındı / Teslim Alınamadı pair instead.
  if (stage === 'ozalit_onay' && project.ozalit_received === true) {
    const alreadyApproved = (project.ozalit_approvals ?? []).some((a) => a.id === user.id)
    // Each leader/designer approves once. A leader who hasn't decided yet sees
    // both Onayla and Reddet; once they approve, BOTH disappear (they've
    // committed) — a different leader who hasn't approved still sees Reddet.
    // canApproveOzalitNow also carries the leader-first rule: an assigned
    // designer gets no Onayla until a team leader has signed off (the server
    // refuses it too), so the button is never offered as a dead end.
    if (canApproveOzalitNow(user, project) && !alreadyApproved) {
      set.add('approve')
    }
    if (role === 'team_leader' && !alreadyApproved) {
      set.add('reject')
    }
  }
  // Baskı Onayı: the final sign-off, team_leader only — same people (Serpil
  // Hanım / Ayşenur, …) who may edit the form itself. Dual-approval
  // (migration 045): the button opens the same dialog whether the form still
  // needs preparing or is awaiting a different leader's approval — see
  // BaskiOnayFormDialog / SpecFormDialog's isBaskiOnayApproval branch for
  // which action it actually performs.
  if ((stage === 'baski_onay' || stage === 'cin_baski_onay') && role === 'team_leader') {
    set.add('approve')
  }
  if (isAssignedDesigner && stage === 'tasarim') {
    set.add('advance')
  }
  // Ozalit Teslim two-step handoff: the leader or assigned designer requests the
  // ozalit (which hands it to the matbaa), then the matbaa delivers it to Ozalit
  // Onay. A reject-to-matbaa locks the step to the matbaa (re-delivery). TR only.
  if (stage === 'ozalit_teslim' && project.type === 'TR') {
    const ozalitRequested = !!project.ozalit_requested
    const matbaaLock = project.reject_target === 'matbaa'
    if (role === 'printer') {
      // Teslim Et stays hidden until the matbaa has pressed İşlemi Başlat —
      // they must mark the work started before they can hand it off. Also
      // hidden while a change request is pending — the server refuses to
      // deliver until the matbaa accepts/declines it (computeOzalitTeslimAdvance),
      // so offering the button here just produces a 400.
      if ((ozalitRequested || matbaaLock) && project.ozalit_started && !project.ozalit_change_requested_at) {
        set.add('advance')
      }
    } else if (!ozalitRequested && !matbaaLock && (role === 'team_leader' || isAssignedDesigner)) {
      set.add('advance')
    }
  }

  // Printer: confirms receipt of the TR demo and forwards it to the leader's
  // onay queue. There's no separate "take into production" action anymore —
  // once baski_onay/cin_baski_onay is approved the project lands directly on
  // baskida, which the printer acts on via the handover flow instead
  // (Teslim Talepleri), not an in-detail-page advance button. Teslim Et stays
  // hidden until İşlemi Başlat has been pressed (same rule as ozalit above),
  // and while a change request is pending — the server refuses delivery
  // until the matbaa accepts/declines it (computeDemoTeslimAdvance).
  if (
    role === 'printer' && project.type === 'TR' && stage === 'demo_teslim' &&
    project.demo_started && !project.demo_change_requested_at
  ) {
    set.add('advance')
  }

  return [...set]
}

/** Contextual label for the "advance" action button. */
function advanceActionLabel(project, userRole) {
  if (userRole === 'printer') {
    if (project.stage === 'demo_teslim') return "Demo'yu Teslim Edin"
    if (project.stage === 'ozalit_teslim') return 'Ozaliti Teslim Edin'
  }
  switch (project.stage) {
    case 'tasarim':
      // A design that's back in Tasarım after an ozalit rejection resubmits to
      // the ozalit flow, not the demo.
      return project.last_reject_type === 'ozalit' ? "Ozalit'e Gönderin" : "Demo'ya Gönderin"
    case 'demo_onay':
    case 'cin_demo_onay':
      // Matbaa delivered; leader can approve/reject. The leader or
      // designer can also re-trigger a new demo round.
      return 'Demo İsteyin'
    case 'ozalit_teslim':
      // Leader / assigned designer requesting the ozalit proof.
      return 'Ozalit İsteyin'
    case 'demo_teslim':
    case 'cin_demo_teslim':
      // At demo_teslim the matbaa delivers (printer). The team leader
      // or assigned designer re-triggers a new demo round.
      return userRole === 'printer' ? "Demo'yu Teslim Edin" : 'Demo İsteyin'
    case 'baskida':
      // Only ÇİN reaches here as a leader-advanceable stage (→ Gümrük). TR
      // Baskıda is closed out via the Sales handover, not this button.
      return 'Gümrüğe Gönderin'
    default:
      return 'İlerletin'
  }
}

/** Destination-aware label for the "approve" action button. */
function approveActionLabel(project) {
  switch (project.stage) {
    case 'ozalit_onay':
      // Two-step sign-off: both the leader's and the designer's approval simply
      // read "Onaylayın" (the designer's is the final one that sends to production).
      return 'Onaylayın'
    case 'cin_demo_onay':
      // Approving the demo now sends it to ÇİN's own print-approval gate
      // (cin_baski_onay), not straight to production.
      return 'Onaylayın'
    case 'baski_onay':
    case 'cin_baski_onay':
      // Dual-approval (migration 045, and ÇİN's mirror gate from migration
      // 047): the outer button just opens the dialog, but its label should
      // say which half is still owed.
      return project.baski_onay_prepared ? 'Onaylayın' : 'Baskı Onayı Hazırlayın'
    default:
      // Demo Onay and every other approval: the leader is approving the item
      // in front of them, so the button simply reads "Onaylayın".
      return 'Onaylayın'
  }
}

/**
 * Most recent stage_history event for this project, e.g. 'demo_form_edited'.
 * History is server-ordered oldest→newest, so the last element is current.
 */
function lastHistoryEvent(project) {
  const h = project?.history ?? []
  return h.length ? h[h.length - 1].event : null
}

/**
 * "İstendi"/"Gönderildi"/"Düzeltme Bekleniyor" status shown once a demo/ozalit
 * has been requested. Checked in order:
 *   - demo_fix_pending/ozalit_fix_pending — the matbaa accepted a change
 *     request (computeDemoChangeAccept un-starts the round), so it's back to
 *     demo_started=false but for a different reason than a fresh request:
 *     the team leader owes a corrected demo/ozalit before the matbaa can
 *     resume, not the matbaa picking up an untouched request.
 *   - demo_started/ozalit_started true — the matbaa has actually pressed
 *     "İşlemi Başlatın" and is producing it ("İşleme Başlandı") — not
 *     "Gönderildi", which read as already delivered.
 *   - the leader just submitted that owed fix (computeDemoEdit/
 *     computeOzalitEdit, logged as demo_form_edited/ozalit_form_edited) —
 *     back to demo_started=false like a fresh request, but this is the
 *     *updated* form going back to the matbaa, not the original ask.
 *   - otherwise — a fresh, still-cancelable request the matbaa hasn't
 *     picked up yet ("İstendi").
 */
function demoOzalitStatusLabel(project) {
  switch (project.stage) {
    case 'demo_teslim':
    case 'cin_demo_teslim':
      if (project.demo_fix_pending) return 'Düzeltme Bekleniyor'
      if (project.demo_started) return 'Demo: İşleme Başlandı'
      if (lastHistoryEvent(project) === 'demo_form_edited') return 'Güncel Demo Formu Matbaaya Gönderildi'
      return 'Demo İstendi'
    case 'ozalit_teslim':
      if (!project.ozalit_requested && project.reject_target !== 'matbaa') return null
      if (project.ozalit_fix_pending) return 'Düzeltme Bekleniyor'
      if (project.ozalit_started) return 'Ozalit: İşleme Başlandı'
      if (lastHistoryEvent(project) === 'ozalit_form_edited') return 'Güncel Ozalit Formu Matbaaya Gönderildi'
      return 'Ozalit İstendi'
    default:
      return null
  }
}
