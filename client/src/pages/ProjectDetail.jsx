import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  PackageX,
  Pencil,
  Save,
  Send,
  ThumbsDown,
  ThumbsUp,
  Users as UsersIcon,
  User as UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { useProject } from '@/hooks/useProjects'
import api, { STAGE_LABELS, TYPE_LABELS } from '@/api'
import StageBar from '@/components/StageBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import UserAvatar from '@/components/UserAvatar.jsx'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import ApprovalDialog from '@/components/ApprovalDialog'
import NewProjectDialog from '@/components/NewProjectDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import DemoFormDialog from '@/components/DemoFormDialog'
import ProjectHistory from '@/components/ProjectHistory'
import { TalepHistoryViewer } from '@/components/TalepSignDialog'
import { cn, formatDateTr, initials } from '@/lib/utils'
import { useDesignerCelebration } from '@/hooks/useCelebration'
import { isSubtaskDone } from '@/domain/services/progress'

export default function ProjectDetail() {
  const { id } = useParams()

  const { user } = useAuth()
  const celebrate = useDesignerCelebration()
  const { project, loading, refetch, setProject } = useProject(id)
  const [dialog, setDialog] = useState(null) // 'approve' | 'reject' | 'advance'
  const [editOpen, setEditOpen] = useState(false)
  const [ozalitFormOpen, setOzalitFormOpen] = useState(false)
  const [ozalitFormMode, setOzalitFormMode] = useState('approve') // 'approve' | 'view'
  const [demoFormOpen, setDemoFormOpen] = useState(false)
  const [demoFormMode, setDemoFormMode] = useState('advance') // 'advance' | 'view' | 'history'
  const [demoFormAttempt, setDemoFormAttempt] = useState(null)
  const [ozalitFormAttempt, setOzalitFormAttempt] = useState(null)
  const [toggling, setToggling] = useState(null)
  const [localDone, setLocalDone] = useState({})
  const [saving, setSaving] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [reportingNotReceived, setReportingNotReceived] = useState(false)
  const [updatingSubId, setUpdatingSubId] = useState(null) // per-subtask "what changed" note
  const [updateNote, setUpdateNote] = useState('')
  const [projectOrders, setProjectOrders] = useState([])
  const [orderFormViewer, setOrderFormViewer] = useState(null)

  useEffect(() => {
    if (!id) return
    api.listOrderRequests()
      .then((reqs) => setProjectOrders(reqs.filter((r) => r.project_id === id)))
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
    user?.role === 'designer' &&
    isAssigned &&
    (project?.stage === 'tasarim' ||
      (DEMO_STAGES.includes(project?.stage) && (project?.progress ?? 0) < 100))

  // The "Güncelle" (what-changed) log is an additive record, so the assigned
  // designer may add updates at any stage — not only during tasarım.
  const canLogUpdate = user?.role === 'designer' && isAssigned

  // Revision mode: the project is back in tasarım after a rejection and the
  // leader has flagged specific subtasks to revise. Flagged subtasks are
  // editable (rework); subtasks that are done-and-not-flagged are locked
  // (leave them); subtasks that were never done stay editable so the designer
  // can still finish them — they were never "revision", just unfinished work.
  const inRevision =
    project?.stage === 'tasarim' && (project?.subtasks ?? []).some((s) => s.needs_revize)

  // Per-subtask: if the subtask has a specific assigned_to, only that designer can edit it.
  // During a revision cycle, lock only the done-and-unflagged subtasks.
  function canEditSubtask(sub) {
    if (!canEditBase) return false
    if (sub.assigned_to && sub.assigned_to !== user?.id) return false
    if (inRevision && !sub.needs_revize && sub.is_done) return false
    return true
  }

  // Kept for the footer hint (true when the base condition is met).
  const canEditSubtasks = canEditBase
  const isLeader = user?.role === 'team_leader'

  // Demo "Teslim Alındı" gate: at demo_onay / cin_demo_onay, an assigned
  // designer or the team leader marks the delivered demo received; the Onay is
  // blocked until then. Shown only while a demo is delivered and not yet acked.
  const isDemoOnayStage = project?.stage === 'demo_onay' || project?.stage === 'cin_demo_onay'
  const canReceiveDemo =
    isDemoOnayStage && !project?.demo_received && (isLeader || (user?.role === 'designer' && isAssigned))

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
      toast.success('Demo teslim alınamadı olarak işaretlendi — matbaaya geri gönderildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReportingNotReceived(false)
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
      toast.success('Ozalit teslim alınamadı olarak işaretlendi — matbaaya geri gönderildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReportingNotReceived(false)
    }
  }

  // Available actions depend on the role + stage
  const actions = availableActions({ project, user })
  const advanceLabel = project ? advanceActionLabel(project, user?.role) : 'İlerlet'
  const approveLabel = project ? approveActionLabel(project) : 'Onayla'
  // Suppress the "Gönderildi" pill for anyone who instead has an action button
  // at this stage (the printer, and now the leader/designer at Ozalit Teslim).
  const sentStatus =
    project && user?.role !== 'printer' && !actions.includes('advance')
      ? sentStatusLabel(project)
      : null

  // Pre-compute demo/ozalit attempt numbers for each history entry so the
  // Görüntüle button can open the correct snapshot.
  const historyWithAttempts = useMemo(() => {
    // Expand each order into one timeline entry per signed stage (like the
    // demo / ozalit attempts), sourced from the order's full signed history.
    const orderEntries = []
    for (const ord of projectOrders) {
      for (const h of (ord.order_history ?? [])) {
        orderEntries.push({
          id: `ord-${ord.id}-${h.step}`,
          action: 'order',
          order_id: ord.id,
          order_step: h.step,
          order_step_label: h.step_label,
          done_by_name: h.signed_by_name,
          created_at: h.signed_at,
        })
      }
    }
    // Drop any live-added 'order' entries; the per-stage entries above replace them.
    const base = (project?.history ?? []).filter((h) => h.action !== 'order')
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
  // changes win over the server value, but for `pages` /
  // `sticker-count` rows the server value is derived from
  // pages_done/total_pages and stickers_done/total_stickers, NOT from
  // `is_done`. We delegate to the kind-aware `isSubtaskDone` helper in
  // `domain/services/progress` so the "X / Y tamamlandı" header always
  // matches the server's `subtaskProgress` — and so optimistic UI can
  // show "done" the moment the last page is added, without waiting for
  // the POST /api/subtasks/:id/pages round-trip to flip `is_done`.
  function subtaskChecked(sub) {
    if (!sub) return false
    if (sub.kind === 'pages' || sub.kind === 'sticker-count') {
      return isSubtaskDone(sub)
    }
    return localDone[sub.id] !== undefined ? localDone[sub.id] : isSubtaskDone(sub)
  }

  // ── per-subtask update log: designer records WHAT changed ──────────────────
  function startUpdateSub(sub) {
    setUpdatingSubId(sub.id)
    setUpdateNote('')
  }
  function cancelUpdateSub() {
    setUpdatingSubId(null)
    setUpdateNote('')
  }
  async function saveUpdateSub(sub) {
    const note = updateNote.trim()
    if (!note) {
      toast.error('Lütfen ne değiştirdiğinizi yazın.')
      return
    }
    setToggling(sub.id)
    try {
      const { project: updated } = await api.addSubtaskUpdate(sub.id, {
        note,
        by: user?.id,
        by_name: user?.name,
      })
      setProject((prev) => ({ ...prev, subtasks: updated.subtasks }))
      setUpdatingSubId(null)
      setUpdateNote('')
      toast.success('Güncelleme kaydedildi.')
    } catch (err) {
      toast.error(err.message || 'Güncelleme kaydedilemedi.')
    } finally {
      setToggling(null)
    }
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
  const hasSubtaskChanges =
    subtasksSafe.some(
      (s) => localDone[s.id] !== undefined && localDone[s.id] !== s.is_done,
    ) ?? false
  // Any subtask still flagged for revision. Blocks the resubmit button until
  // the designer has revized them all (the server enforces the same gate).
  const pendingRevize = subtasksSafe.some((s) => s.needs_revize)

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
      subtasksSafe.every((s) => {
        const done = localDone[s.id] !== undefined ? localDone[s.id] : s.is_done
        if (s.kind === 'pages') return (s.pages_done ?? 0) >= (s.total_pages ?? 0)
        return done
      })
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

  async function addPages(sub, delta) {
    const total = sub.total_pages ?? 0
    const next = Math.max(0, Math.min(total, (sub.pages_done ?? 0) + delta))
    setToggling(sub.id)
    try {
      const { project: updated } = await api.setSubtaskPages(sub.id, next)
      setProject((prev) => ({ ...prev, subtasks: updated.subtasks, progress: updated.progress }))
    } catch (err) {
      toast.error(err.message || 'Sayfa güncellenemedi.')
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
      toast.success(`${sub.title} — revize edildi.`)
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
          <div className="grid gap-4 lg:grid-cols-3">
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
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/">Panele dön</Link>
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Panele dön
            </Link>
          </Button>
        </div>

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
                    {/* A demo/ozalit in process reads "…Gönderildi" (same wording
                        as the first send), not the raw pipeline stage name. The
                        ozalit variant only once it's actually with the matbaa —
                        ozalit_teslim also covers the "not yet requested" sub-state. */}
                    {project.stage === 'demo_teslim' || project.stage === 'cin_demo_teslim'
                      ? 'Demoya Gönderildi'
                      : project.stage === 'ozalit_teslim' &&
                          (project.ozalit_requested || project.reject_target === 'matbaa')
                        ? "Ozalit'e Gönderildi"
                        : STAGE_LABELS[project.stage]}
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

              <div className="flex flex-wrap items-center gap-2">
                {isLeader && (
                  <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" />
                    Düzenle
                  </Button>
                )}
                {/* Demo formu görüntüle — demo gönderildikten sonra */}
                {isLeader && ['demo_teslim', 'cin_demo_teslim', 'demo_onay', 'cin_demo_onay', 'ozalit_teslim', 'ozalit_onay', 'uretimde', 'gumruk', 'satista'].includes(project.stage) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setDemoFormMode('view'); setDemoFormAttempt(null); setDemoFormOpen(true) }}
                  >
                    <FileText className="h-4 w-4" />
                    Demo Formu
                  </Button>
                )}
                {/* Ozalit formu görüntüle — üretimde veya sonraki aşamalarda */}
                {isLeader && ['uretimde', 'gumruk', 'satista'].includes(project.stage) && project.type === 'TR' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setOzalitFormMode('view'); setOzalitFormAttempt(null); setOzalitFormOpen(true) }}
                  >
                    <FileText className="h-4 w-4" />
                    Ozalit Formu
                  </Button>
                )}
                {actions.includes('advance') && (
                  <Button
                    size="sm"
                    disabled={pendingRevize}
                    title={pendingRevize ? 'Önce revize bekleyen alt görevleri revize edin.' : undefined}
                    onClick={() => {
                      // An ozalit-revision redesign resubmits straight to the
                      // ozalit flow (a simple confirm), not the demo form.
                      if (project.stage === 'tasarim' && project.last_reject_type === 'ozalit') {
                        setDialog('advance')
                        return
                      }
                      // Demo stages open the demo form: the designer requests it
                      // at Tasarım, the matbaa forwards it at Demo Teslim, and a
                      // re-send ("Demo İste") at any demo stage fills a fresh form
                      // for the new attempt — all through the same form (read-only
                      // for the matbaa), matching the Onaylar page.
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
                    }}
                  >
                    <Send className="h-4 w-4" />
                    {advanceLabel}
                  </Button>
                )}
                {/* Demo "Teslim Alındı" gate — before the Onay. */}
                {canReceiveDemo && (
                  <Button size="sm" onClick={handleReceiveDemo} disabled={receiving || reportingNotReceived}>
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
                    onClick={handleDemoNotReceived}
                    disabled={receiving || reportingNotReceived}
                  >
                    <PackageX className="h-4 w-4" />
                    {reportingNotReceived ? 'İşleniyor…' : 'Teslim Alınamadı'}
                  </Button>
                )}
                {isDemoOnayStage && project.demo_received && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    Teslim alındı{project.demo_received_by ? ` — ${project.demo_received_by}` : ''}
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
                      } else {
                        setDialog('approve')
                      }
                    }}
                  >
                    <ThumbsUp className="h-4 w-4" />
                    {approveLabel}
                  </Button>
                )}
                {/* Escape hatch: the delivered ozalit never actually reached
                    this leader/designer — send it back to the matbaa instead
                    of being stuck choosing between Onayla/Reddet for a proof
                    they never saw. Shown to anyone who still has a pending
                    approve decision at this stage. */}
                {project.stage === 'ozalit_onay' && actions.includes('approve') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleOzalitNotReceived}
                    disabled={reportingNotReceived}
                  >
                    <PackageX className="h-4 w-4" />
                    {reportingNotReceived ? 'İşleniyor…' : 'Teslim Alınamadı'}
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
                      Tasarım tamamlanmadı — tasarımcı yeni demo gönderdiğinde ilerleyecek
                    </span>
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
            </div>

            {/* Ozalit requested — handed to the matbaa, waiting for delivery */}
            {project.stage === 'ozalit_teslim' && project.ozalit_requested && (
              <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-blue-800">
                    Ozalit istendi — matbaa teslimi bekleniyor
                  </p>
                  <p className="mt-0.5 text-xs text-blue-600">
                    {user?.role === 'printer'
                      ? 'Ozaliti teslim ettiğinizde ekip lideri ve tasarımcı onayına gönderilecek.'
                      : 'Matbaa ozaliti teslim ettiğinde onay aşamasına geçecek.'}
                  </p>
                </div>
              </div>
            )}

            {/* Ozalit onay — multi-party approval progress. Every team leader
                AND every assigned designer must approve before it advances. */}
            {project.stage === 'ozalit_onay' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-sm font-semibold text-emerald-800">
                  Ozalit onayı — tüm ekip liderleri ve atanmış tasarımcılar onaylamalı
                </p>
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
                      ? `Ozalit reddedildi — revizyon gerekiyor (${(project.ozalit_attempt ?? 0) + 1}. deneme)`
                      : `Demo reddedildi — revizyon gerekiyor (${(project.demo_attempt ?? 0) + 1}. deneme)`}
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

            {/* `-mx-1` lets the StageBar bleed to the card edge so the scroll
                affordance (if needed at narrow widths) sits flush; padding is
                restored on the scroll container itself. */}
            <div className="-mx-1 rounded-lg bg-muted/30 py-5">
              <div className="overflow-x-auto px-1">
                <StageBar type={project.type} stage={project.stage} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Body grid */}
        <div className="grid gap-4 lg:grid-cols-3">
          <ProjectHistory
            entries={historyWithAttempts}
            projectType={project.type}
            orders={projectOrders}
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
            onOpenOrderForm={setOrderFormViewer}
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
                    {(project.subtasks ?? []).filter((s) => subtaskChecked(s)).length} / {(project.subtasks ?? []).length} tamamlandı
                  </span>
                  {canEditSubtasks && hasSubtaskChanges && (
                    <Button size="sm" onClick={saveSubtaskChanges} disabled={saving}>
                      <Save className="h-4 w-4" />
                      {saving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}
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

                        if (s.kind === 'pages') {
                          return (
                            <PageSubtaskRow
                              key={s.id}
                              sub={s}
                              canEdit={canEdit}
                              flagged={flagged}
                              lockedDone={lockedDone}
                              busy={toggling === s.id}
                              revizing={toggling === s.id}
                              onRevize={() => handleRevize(s)}
                              onAdd={(delta) => addPages(s, delta)}
                            />
                          )
                        }

                        const updates = s.updates ?? []

                        return (
                          <div key={s.id} className="space-y-1.5">
                          <label
                            key={s.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-sm transition',
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
                            <span className={cn('flex-1', subtaskChecked(s) && 'text-muted-foreground line-through')}>
                              {s.title}
                            </span>
                            {flagged && canEdit && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRevize(s) }}
                                disabled={toggling === s.id}
                                className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                              >
                                {toggling === s.id ? 'Kaydediliyor…' : 'Revize Et'}
                              </button>
                            )}
                            {flagged && !canEdit && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                Revize bekliyor
                              </span>
                            )}
                            {lockedDone && (
                              <span className="text-[11px] font-medium text-muted-foreground">
                                Revize gerekmiyor
                              </span>
                            )}
                            {s.assigned_to && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                                title={`Bu alt görevin tasarımcısı: ${s.assigned_name ?? s.assigned_to}`}
                              >
                                <UserIcon className="h-2.5 w-2.5" />
                                {s.assigned_name ?? initials(s.assigned_to)}
                              </span>
                            )}
                            {localDone[s.id] !== undefined && localDone[s.id] !== s.is_done && (
                              <span className={cn('text-[11px] font-medium', flagged ? 'text-amber-600' : 'text-primary')}>
                                kaydedilmedi
                              </span>
                            )}
                            {!flagged && !lockedDone && subtaskChecked(s) && s.is_done && s.done_at && localDone[s.id] === undefined && (
                              <span className="text-[11px] text-muted-foreground">{formatDateTr(s.done_at)}</span>
                            )}
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

      <NewProjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
        onUpdated={(updated) => {
          setProject((prev) => ({ ...prev, ...updated }))
          refetch()
        }}
      />

      <OzalitFormDialog
        open={ozalitFormOpen}
        onOpenChange={(v) => { setOzalitFormOpen(v); if (!v) setOzalitFormAttempt(null) }}
        project={project}
        mode={ozalitFormMode}
        viewAttempt={ozalitFormAttempt}
        onDone={onActionDone}
      />

      <DemoFormDialog
        open={demoFormOpen}
        onOpenChange={(v) => { setDemoFormOpen(v); if (!v) setDemoFormAttempt(null) }}
        project={project}
        mode={demoFormMode}
        viewAttempt={demoFormAttempt}
        onDone={onActionDone}
      />

      <TalepHistoryViewer
        order={orderFormViewer?.order}
        initialStep={orderFormViewer?.step}
        open={!!orderFormViewer}
        onOpenChange={(v) => !v && setOrderFormViewer(null)}
      />
    </>
  )
}

/**
 * Page-count subtask. The designer logs how many pages they finished today;
 * progress is recalculated automatically (pages done / total pages).
 */
function PageSubtaskRow({ sub, canEdit, busy, onAdd, onRevize, revizing = false, flagged = false, lockedDone = false }) {
  const [today, setToday] = useState('')
  const total = sub.total_pages ?? 0
  const done = sub.pages_done ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const remaining = Math.max(0, total - done)

  function submit(e) {
    e.preventDefault()
    const n = Number(today)
    if (!n || n < 1) return
    onAdd(n)
    setToday('')
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-background px-3 py-2.5',
        sub.is_done && 'border-emerald-200 bg-emerald-50/40',
        flagged && !sub.is_done && 'border-amber-200 bg-amber-50/40',
        lockedDone && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {sub.title}
          {flagged && canEdit && (
            <button
              type="button"
              onClick={onRevize}
              disabled={revizing}
              className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {revizing ? 'Kaydediliyor…' : 'Revize Et'}
            </button>
          )}
          {flagged && !canEdit && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Revize bekliyor
            </span>
          )}
          {lockedDone && (
            <span className="text-[11px] font-medium text-muted-foreground">Revize gerekmiyor</span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {done} / {total} sayfa · <span className="font-semibold text-foreground">%{pct}</span>
        </span>
      </div>
      <Progress value={pct} className="mt-2 h-1.5" />
      {canEdit ? (
        <form onSubmit={submit} className="mt-2.5 flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min="1"
            max={remaining || undefined}
            value={today}
            onChange={(e) => setToday(e.target.value)}
            placeholder="Bugün biten sayfa"
            className="h-8 w-40"
            disabled={busy || remaining === 0}
          />
          <Button type="submit" size="sm" disabled={busy || remaining === 0 || !today}>
            Ekle
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {remaining === 0 ? 'Tamamlandı' : `Kalan: ${remaining} sayfa`}
          </span>
        </form>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {remaining === 0 ? 'Tamamlandı' : `Kalan: ${remaining} sayfa`}
        </p>
      )}
    </div>
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
  const role = user.role
  const stage = project.stage
  const set = new Set()

  // Team leader moves a project forward. TR demo/ozalit teslim are forwarded by
  // the printer (matbaa) via the approval queue, so the leader doesn't advance
  // those — instead they see a "Gönderildi" status (see sentStatusLabel).
  //
  // The leader no longer pushes a project into Satışta: reaching Satışta now
  // happens only when Sales confirms Matbaa's handover ("Alındı"). So the leader
  // advances 'tasarim' and 'cin_demo_teslim', plus ÇİN 'uretimde' → 'gumruk'
  // (customs). TR 'uretimde' and ÇİN 'gumruk' are handled by the handover flow.
  const leaderAdvanceable = new Set(['tasarim', 'cin_demo_teslim'])
  if (
    role === 'team_leader' &&
    (leaderAdvanceable.has(stage) || (stage === 'uretimde' && project.type === 'CIN'))
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
  // the header shows the "Demoya Gönderildi" pill (see sentStatusLabel).
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
  if (stage === 'ozalit_onay') {
    const alreadyApproved = (project.ozalit_approvals ?? []).some((a) => a.id === user.id)
    // Each leader/designer approves once. A leader who hasn't decided yet sees
    // both Onayla and Reddet; once they approve, BOTH disappear (they've
    // committed) — a different leader who hasn't approved still sees Reddet.
    if ((role === 'team_leader' || isAssignedDesigner) && !alreadyApproved) {
      set.add('approve')
    }
    if (role === 'team_leader' && !alreadyApproved) {
      set.add('reject')
    }
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
      if (ozalitRequested || matbaaLock) set.add('advance')
    } else if (!ozalitRequested && !matbaaLock && (role === 'team_leader' || isAssignedDesigner)) {
      set.add('advance')
    }
  }

  // Printer: confirms receipt of the TR demo and forwards it to the leader's
  // onay queue, and takes an approved project into production ("Üretime Al").
  if (role === 'printer' && project.type === 'TR' && stage === 'demo_teslim') {
    set.add('advance')
  }
  if (role === 'printer' && stage === 'uretime_hazir') {
    set.add('advance')
  }

  return [...set]
}

/** Contextual label for the "advance" action button. */
function advanceActionLabel(project, userRole) {
  if (userRole === 'printer') {
    if (project.stage === 'demo_teslim') return "Demo'yu Teslim Et"
    if (project.stage === 'ozalit_teslim') return 'Ozaliti Teslim Et'
    if (project.stage === 'uretime_hazir') return 'Üretime Al'
  }
  switch (project.stage) {
    case 'tasarim':
      // A design that's back in Tasarım after an ozalit rejection resubmits to
      // the ozalit flow, not the demo.
      return project.last_reject_type === 'ozalit' ? "Ozalit'e Gönder" : "Demo'ya Gönder"
    case 'demo_onay':
    case 'cin_demo_onay':
      // Matbaa delivered; leader can approve/reject. The leader or
      // designer can also re-trigger a new demo round.
      return 'Demo İste'
    case 'ozalit_teslim':
      // Leader / assigned designer requesting the ozalit proof.
      return 'Ozalit İste'
    case 'demo_teslim':
    case 'cin_demo_teslim':
      // At demo_teslim the matbaa delivers (printer). The team leader
      // or assigned designer re-triggers a new demo round.
      return userRole === 'printer' ? "Demo'yu Teslim Et" : 'Demo İste'
    case 'uretimde':
      // Only ÇİN reaches here as a leader-advanceable stage (→ Gümrük). TR
      // Üretimde is closed out via the Sales handover, not this button.
      return 'Gümrüğe Gönder'
    default:
      return 'İlerlet'
  }
}

/** Destination-aware label for the "approve" action button. */
function approveActionLabel(project) {
  switch (project.stage) {
    case 'ozalit_onay':
      // Two-step sign-off: both the leader's and the designer's approval simply
      // read "Onayla" (the designer's is the final one that sends to production).
      return 'Onayla'
    case 'cin_demo_onay':
      return 'Üretime Al'
    default:
      // Demo Onay and every other approval: the leader is approving the item
      // in front of them, so the button simply reads "Onayla".
      return 'Onayla'
  }
}

/** "Sent" status pill shown once a demo/ozalit has been forwarded. */
function sentStatusLabel(project) {
  switch (project.stage) {
    case 'demo_teslim':
    case 'cin_demo_teslim':
      return 'Demoya Gönderildi'
    case 'ozalit_teslim':
      return "Ozalit'e Gönderildi"
    default:
      return null
  }
}
