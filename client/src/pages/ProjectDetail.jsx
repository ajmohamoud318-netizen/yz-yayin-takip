import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ChevronRight,
  FileText,
  History,
  Lock,
  Pencil,
  Plus,
  Save,
  Send,
  ShoppingCart,
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
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import ApprovalDialog from '@/components/ApprovalDialog'
import NewProjectDialog from '@/components/NewProjectDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import DemoFormDialog from '@/components/DemoFormDialog'
import { TalepHistoryViewer } from '@/components/TalepSignDialog'
import { cn, formatDateTr, initials } from '@/lib/utils'
import { useDesignerCelebration } from '@/hooks/useCelebration'

const ACTION_META = {
  create:  { icon: Plus,        color: 'text-primary' },
  advance: { icon: ChevronRight, color: 'text-primary' },
  approve: { icon: ThumbsUp,    color: 'text-emerald-600' },
  reject:  { icon: ThumbsDown,  color: 'text-destructive' },
  order:   { icon: ShoppingCart, color: 'text-violet-600' },
}

function historyLabel({ action, from_stage, to_stage }) {
  if (action === 'create') return 'Proje Oluşturuldu'
  if (action === 'advance') {
    if (to_stage === 'demo_teslim' || to_stage === 'cin_demo_teslim') return 'Demoya Gönderildi'
    if (to_stage === 'demo_onay')     return 'Demo Teslim Edildi'
    if (to_stage === 'cin_demo_onay') return 'Demo Teslim Edildi'
    if (to_stage === 'ozalit_teslim') return "Ozalit'e Gönderildi"
    if (to_stage === 'ozalit_onay')   return 'Ozalit'
    if (to_stage === 'uretime_hazir') return 'Üretime Hazır'
    if (to_stage === 'uretimde')      return 'Üretime Alındı (Sipariş)'
    if (to_stage === 'gumruk')        return 'Gümrüğe Gönderildi'
    if (to_stage === 'satista')       return 'Satışa Çıkarıldı'
    return 'İlerletildi'
  }
  if (action === 'approve') {
    if (from_stage === 'demo_onay' || from_stage === 'cin_demo_onay') return 'Demo Onaylandı'
    if (from_stage === 'ozalit_onay') return 'Ozalit Onaylandı'
    return 'Onaylandı'
  }
  if (action === 'reject') {
    if (from_stage === 'demo_onay' || from_stage === 'cin_demo_onay') return 'Demo Reddedildi'
    if (from_stage === 'ozalit_onay') return 'Ozalit Reddedildi'
    return 'Reddedildi'
  }
  if (action === 'order') return 'Sipariş'
  return 'İlerletildi'
}

export default function ProjectDetail({ projectId: propId, isModal = false }) {
  const { id: paramId } = useParams()
  const id = propId ?? paramId

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

  // Base condition: designer must be on the project and in tasarım stage.
  const canEditBase =
    user?.role === 'designer' &&
    isAssigned &&
    project?.stage === 'tasarim'

  // The "Güncelle" (what-changed) log is an additive record, so the assigned
  // designer may add updates at any stage — not only during tasarım.
  const canLogUpdate = user?.role === 'designer' && isAssigned

  // Revision mode: the project is back in tasarım after a rejection and the
  // leader has flagged specific subtasks to revise. Only those are editable;
  // everything else is treated as already completed and locked.
  const inRevision =
    project?.stage === 'tasarim' && (project?.subtasks ?? []).some((s) => s.needs_revize)

  // Per-subtask: if the subtask has a specific assigned_to, only that designer can edit it.
  // During a revision cycle only the leader-flagged (needs_revize) subtasks are editable.
  function canEditSubtask(sub) {
    if (!canEditBase) return false
    if (sub.assigned_to && sub.assigned_to !== user?.id) return false
    if (inRevision && !sub.needs_revize) return false
    return true
  }

  // Kept for the footer hint (true when the base condition is met).
  const canEditSubtasks = canEditBase
  const isLeader = user?.role === 'team_leader'

  // Available actions depend on the role + stage
  const actions = availableActions({ project, user })
  const advanceLabel = project ? advanceActionLabel(project, user?.role) : 'İlerlet'
  const approveLabel = project ? approveActionLabel(project) : 'Onayla'
  // Suppress "Demoya Gönderildi" pill for the printer — they get an action button instead.
  const sentStatus = project && user?.role !== 'printer' ? sentStatusLabel(project) : null

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
    return merged.map((h) => {
      const entry = { ...h, demoAttemptAt: demoN + 1, ozalitAttemptAt: ozalitN + 1 }
      if (h.action === 'reject' && h.from_stage === 'demo_onay')   demoN++
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

  // Returns the effective checked state (local pending or server value)
  function subtaskChecked(sub) {
    return localDone[sub.id] !== undefined ? localDone[sub.id] : sub.is_done
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

  // True if there's at least one unsaved change
  const hasSubtaskChanges =
    project?.subtasks.some(
      (s) => localDone[s.id] !== undefined && localDone[s.id] !== s.is_done,
    ) ?? false

  async function saveSubtaskChanges() {
    if (!hasSubtaskChanges) return
    setSaving(true)
    const wasInRevision = inRevision
    const revizeSubs = (project?.subtasks ?? []).filter((s) => s.needs_revize)
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
      project.subtasks.every((s) => {
        const done = localDone[s.id] !== undefined ? localDone[s.id] : s.is_done
        if (s.kind === 'pages') return (s.pages_done ?? 0) >= (s.total_pages ?? 0)
        return done
      })
    try {
      const changed = project.subtasks.filter(
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
        {!isModal && (
          <div>
            <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
                Panele dön
              </Link>
            </Button>
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
                    {STAGE_LABELS[project.stage]}
                  </Badge>
                  {project.demo_attempt > 0 && (
                    <Badge variant="outline" className="font-medium text-slate-600">
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
                    Hedef: {formatDateTr(project.target_month, { day: undefined, month: 'long', year: 'numeric' })}
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
                    onClick={() => {
                      // tasarım → demo: open demo form dialog for all project types
                      if (project.stage === 'tasarim') {
                        setDemoFormMode('advance')
                        setDemoFormAttempt(null)
                        setDemoFormOpen(true)
                      } else {
                        setDialog('advance')
                      }
                    }}
                  >
                    <Send className="h-4 w-4" />
                    {advanceLabel}
                  </Button>
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

            <div className="rounded-lg bg-muted/30 px-4 py-5">
              <StageBar type={project.type} stage={project.stage} />
            </div>
          </CardContent>
        </Card>

        {/* Body grid */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Alt Görevler</CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {project.subtasks.filter((s) => subtaskChecked(s)).length} / {project.subtasks.length} tamamlandı
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
              {project.subtasks.length === 0 ? (
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

                  {project.subtasks
                    .filter((s) => s.kind !== 'revize')
                    .map((s) => {
                      const canEdit = canEditSubtask(s)
                      const flagged = inRevision && s.needs_revize
                      const lockedDone = inRevision && !s.needs_revize

                      if (s.kind === 'pages') {
                        return (
                          <PageSubtaskRow
                            key={s.id}
                            sub={s}
                            canEdit={canEdit}
                            flagged={flagged}
                            lockedDone={lockedDone}
                            busy={toggling === s.id}
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
                            onCheckedChange={() => canEdit && toggleSubtask(s)}
                            disabled={!canEdit}
                          />
                          <span className={cn('flex-1', subtaskChecked(s) && 'text-muted-foreground line-through')}>
                            {s.title}
                          </span>
                          {flagged && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Revize Et
                            </span>
                          )}
                          {lockedDone && (
                            <span className="text-[11px] font-medium text-muted-foreground">
                              Revize gerekmiyor
                            </span>
                          )}
                          {s.assigned_name && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                              <UserIcon className="h-2.5 w-2.5" />
                              {s.assigned_name}
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
              {canEditSubtasks && project.subtasks.some((s) => s.assigned_to && s.assigned_to !== user?.id) && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Size atanmayan alt görevler (
                  <UserIcon className="inline h-2.5 w-2.5" /> ikonlu) düzenlenemez.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {(project.assignees ?? []).length > 1 ? (
                    <UsersIcon className="h-4 w-4" />
                  ) : (
                    <UserIcon className="h-4 w-4" />
                  )}
                  {(project.assignees ?? []).length > 1 ? 'Tasarımcılar' : 'Tasarımcı'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {(project.assignees ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">Henüz tasarımcı atanmadı.</p>
                )}
                {(project.assignees ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs">{initials(a.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-semibold">{a.name}</p>
                      <p className="text-xs text-muted-foreground">Tasarımcı</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Geçmiş
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {(project.history ?? []).length === 0 && (
                  <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                    Henüz bir aşama geçişi yok.
                  </p>
                )}
                <ol className="relative">
                  {historyWithAttempts.map((h, i) => {
                    const meta = ACTION_META[h.action] ?? ACTION_META.advance
                    const Icon = meta.icon
                    const isLast = i === historyWithAttempts.length - 1

                    const isDemoEntry =
                      (h.action === 'advance' && (h.to_stage === 'demo_teslim' || h.to_stage === 'cin_demo_teslim')) ||
                      (h.action === 'advance' && (h.from_stage === 'demo_teslim' || h.from_stage === 'cin_demo_teslim')) ||
                      h.from_stage === 'demo_onay' || h.from_stage === 'cin_demo_onay'

                    const isOzalitEntry = (
                      (h.action === 'advance' && h.to_stage === 'ozalit_teslim') ||
                      (h.action === 'advance' && h.from_stage === 'ozalit_teslim') ||
                      (h.from_stage === 'ozalit_onay')
                    ) && project.type === 'TR'

                    const iconBg =
                      h.action === 'approve'
                        ? 'bg-emerald-100 ring-emerald-200'
                        : h.action === 'reject'
                          ? 'bg-red-100 ring-red-200'
                          : h.action === 'create'
                            ? 'bg-primary/10 ring-primary/20'
                            : h.action === 'order'
                              ? 'bg-violet-100 ring-violet-200'
                              : 'bg-muted ring-border'

                    return (
                      <li key={h.id ?? i} className="relative flex gap-3 pb-5 last:pb-0">
                        {/* Vertical connector line */}
                        {!isLast && (
                          <span className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
                        )}

                        {/* Icon dot */}
                        <span
                          className={cn(
                            'relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-2',
                            iconBg,
                            meta.color,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                        </span>

                        {/* Content */}
                        <div className="min-w-0 flex-1 pt-0.5">
                          <p className="text-sm font-semibold leading-snug">
                            {h.action === 'order'
                              ? `Sipariş — ${h.order_step_label ?? ''}`
                              : historyLabel(h)}
                          </p>

                          {h.note && h.action !== 'order' && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{h.note}</p>
                          )}

                          {h.reason && (
                            <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2">
                              <ThumbsDown className="mt-0.5 h-3 w-3 shrink-0 text-destructive/70" />
                              <p className="text-xs leading-relaxed text-destructive">
                                {h.reason}
                              </p>
                            </div>
                          )}

                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <UserIcon className="h-2.5 w-2.5" />
                              {h.done_by_name}
                            </span>
                            <span className="text-[11px] text-muted-foreground/60">·</span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatDateTr(h.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {isDemoEntry && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDemoFormAttempt(h.demoAttemptAt)
                                  setDemoFormMode('history')
                                  setDemoFormOpen(true)
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                              >
                                <FileText className="h-2.5 w-2.5" />
                                Demo Formu
                              </button>
                            )}
                            {isOzalitEntry && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOzalitFormAttempt(h.ozalitAttemptAt)
                                  setOzalitFormMode('history')
                                  setOzalitFormOpen(true)
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                              >
                                <FileText className="h-2.5 w-2.5" />
                                Ozalit Formu
                              </button>
                            )}
                            {h.action === 'order' && projectOrders.length > 0 && (() => {
                              const ord = h.order_id
                                ? projectOrders.find((o) => o.id === h.order_id)
                                : projectOrders[0]
                              if (!ord) return null
                              return (
                                <button
                                  type="button"
                                  onClick={() => setOrderFormViewer({ order: ord, step: h.order_step })}
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-violet-400/50 hover:bg-violet-50 hover:text-violet-700"
                                >
                                  <ShoppingCart className="h-2.5 w-2.5" />
                                  Sipariş Formu
                                </button>
                              )
                            })()}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
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
function PageSubtaskRow({ sub, canEdit, busy, onAdd, flagged = false, lockedDone = false }) {
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
          {flagged && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Revize Et
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
  const advanceableStages = ['tasarim', 'cin_demo_teslim', 'uretimde', 'gumruk']
  if (role === 'team_leader' && advanceableStages.includes(stage)) {
    set.add('advance')
  }
  if ((stage === 'demo_onay' || stage === 'ozalit_onay' || stage === 'cin_demo_onay') && role === 'team_leader') {
    set.add('approve')
    set.add('reject')
  }

  // Designer: can request demo at any progress level. Revision subtasks are
  // shown directly in the alt görevler section — no "Revize Başla" gate needed.
  const isAssignedDesigner =
    role === 'designer' && (project.assignees ?? []).some((a) => a.id === user.id)
  if (isAssignedDesigner && stage === 'tasarim') {
    set.add('advance')
  }

  // Printer: confirms receipt of TR demo/ozalit and forwards to the leader's onay queue.
  if (role === 'printer' && project.type === 'TR' && (stage === 'demo_teslim' || stage === 'ozalit_teslim')) {
    set.add('advance')
  }

  return [...set]
}

/** Contextual label for the "advance" action button. */
function advanceActionLabel(project, userRole) {
  if (userRole === 'printer') {
    if (project.stage === 'demo_teslim' || project.stage === 'ozalit_teslim') return 'Teslim Et'
  }
  switch (project.stage) {
    case 'tasarim':
      return "Demo'ya Gönder"
    case 'demo_teslim':
    case 'ozalit_teslim':
    case 'cin_demo_teslim':
      return 'Onaya Gönder'
    case 'uretimde':
      return project.type === 'CIN' ? 'Gümrüğe Gönder' : 'Satışa Çıkar'
    case 'gumruk':
      return 'Satışa Çıkar'
    default:
      return 'İlerlet'
  }
}

/** Destination-aware label for the "approve" action button. */
function approveActionLabel(project) {
  switch (project.stage) {
    case 'demo_onay':
      return "Ozalit'e Gönder"
    case 'ozalit_onay':
    case 'cin_demo_onay':
      return 'Üretime Al'
    default:
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
