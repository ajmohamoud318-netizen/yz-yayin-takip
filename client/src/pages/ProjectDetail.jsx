import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  History,
  Pencil,
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
import AppShell from '@/components/AppShell'
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
import { cn, formatDateTr, initials } from '@/lib/utils'

const ACTION_META = {
  advance: { label: 'İlerletildi', icon: ChevronRight, color: 'text-primary' },
  approve: { label: 'Onaylandı', icon: ThumbsUp, color: 'text-emerald-600' },
  reject: { label: 'Reddedildi', icon: ThumbsDown, color: 'text-destructive' },
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { project, loading, refetch, setProject } = useProject(id)
  const [dialog, setDialog] = useState(null) // 'approve' | 'reject' | 'advance'
  const [editOpen, setEditOpen] = useState(false)
  const [toggling, setToggling] = useState(null)

  // Designer can toggle subtasks only on projects they are assigned to
  const canEditSubtasks =
    user?.role === 'designer' && (project?.assignees ?? []).some((a) => a.id === user?.id)
  const isLeader = user?.role === 'team_leader'

  // Available actions depend on the role + stage
  const actions = availableActions({ project, user })
  const advanceLabel = project ? advanceActionLabel(project) : 'İlerlet'

  async function toggleSubtask(sub) {
    setToggling(sub.id)
    try {
      const { project: updated } = await api.setSubtaskDone(sub.id, !sub.is_done)
      setProject((prev) => ({ ...prev, subtasks: updated.subtasks, progress: updated.progress }))
    } catch (err) {
      toast.error(err.message || 'Alt görev güncellenemedi.')
    } finally {
      setToggling(null)
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
      <AppShell>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-64 lg:col-span-2" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </AppShell>
    )
  }

  if (!project) {
    return (
      <AppShell>
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <p className="text-sm font-medium text-foreground">Proje bulunamadı.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/">Panele dön</Link>
          </Button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
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
                    {STAGE_LABELS[project.stage]}
                  </Badge>
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
                {actions.includes('advance') && (
                  <Button size="sm" onClick={() => setDialog('advance')}>
                    <Send className="h-4 w-4" />
                    {advanceLabel}
                  </Button>
                )}
                {actions.includes('approve') && (
                  <Button size="sm" variant="success" onClick={() => setDialog('approve')}>
                    <ThumbsUp className="h-4 w-4" />
                    Onayla
                  </Button>
                )}
                {actions.includes('reject') && (
                  <Button size="sm" variant="destructive" onClick={() => setDialog('reject')}>
                    <ThumbsDown className="h-4 w-4" />
                    Reddet
                  </Button>
                )}
              </div>
            </div>

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
              <span className="text-xs text-muted-foreground">
                {project.subtasks.filter((s) => s.is_done).length} / {project.subtasks.length} tamamlandı
              </span>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {project.subtasks.length === 0 ? (
                <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  Bu proje için alt görev tanımlanmamış.
                </p>
              ) : (
                project.subtasks.map((s) =>
                  s.kind === 'pages' ? (
                    <PageSubtaskRow
                      key={s.id}
                      sub={s}
                      canEdit={canEditSubtasks}
                      busy={toggling === s.id}
                      onAdd={(delta) => addPages(s, delta)}
                    />
                  ) : (
                    <label
                      key={s.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-sm transition',
                        s.is_done ? 'border-emerald-200 bg-emerald-50/40' : 'hover:border-primary/30',
                        !canEditSubtasks && 'cursor-default',
                      )}
                    >
                      <Checkbox
                        checked={s.is_done}
                        onCheckedChange={() => canEditSubtasks && toggleSubtask(s)}
                        disabled={!canEditSubtasks || toggling === s.id}
                      />
                      <span className={cn('flex-1', s.is_done && 'text-muted-foreground line-through')}>
                        {s.title}
                      </span>
                      {s.is_done && s.done_at && (
                        <span className="text-[11px] text-muted-foreground">{formatDateTr(s.done_at)}</span>
                      )}
                    </label>
                  ),
                )
              )}
              {!canEditSubtasks && (
                <p className="pt-2 text-[11px] text-muted-foreground">
                  {isLeader
                    ? 'Alt görevleri sadece atanmış tasarımcı işaretleyebilir.'
                    : 'Bu projeye atanmadığınız için alt görevleri düzenleyemezsiniz.'}
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
              <CardContent className="space-y-2 pt-0">
                {(project.history ?? []).length === 0 && (
                  <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                    Henüz bir aşama geçişi yok.
                  </p>
                )}
                {(project.history ?? []).map((h, i) => {
                  const meta = ACTION_META[h.action] ?? ACTION_META.advance
                  const Icon = meta.icon
                  return (
                    <div key={h.id ?? i} className="flex gap-3">
                      <span
                        className={cn(
                          'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted',
                          meta.color,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{meta.label}</span>
                          {h.to_stage && (
                            <>
                              {' → '}
                              <span className="text-muted-foreground">
                                {STAGE_LABELS[h.to_stage] ?? h.to_stage}
                              </span>
                            </>
                          )}
                        </p>
                        {h.reason && (
                          <p className="mt-1 rounded-md border bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                            “{h.reason}”
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {h.done_by_name} · {formatDateTr(h.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  )
                })}
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
    </AppShell>
  )
}

/**
 * Page-count subtask. The designer logs how many pages they finished today;
 * progress is recalculated automatically (pages done / total pages).
 */
function PageSubtaskRow({ sub, canEdit, busy, onAdd }) {
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
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{sub.title}</span>
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

  // Only the team leader can move a project forward in the flow (ilerleme).
  const advanceableStages = [
    'tasarim',
    'demo_teslim',
    'ozalit_teslim',
    'cin_demo_teslim',
    'uretimde',
    'gumruk',
  ]
  if (role === 'team_leader' && advanceableStages.includes(stage)) {
    set.add('advance')
  }
  if ((stage === 'demo_onay' || stage === 'ozalit_onay' || stage === 'cin_demo_onay') && role === 'team_leader') {
    set.add('approve')
    set.add('reject')
  }

  return [...set]
}

/** Contextual label for the "advance" action button. */
function advanceActionLabel(project) {
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
