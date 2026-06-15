import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, Clock, Plus, Check } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import AppShell from '@/components/AppShell'
import AssigneeAvatars from '@/components/AssigneeAvatars'
import DemoSubmitDialog from '@/components/DemoSubmitDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import api, { STAGE_LABELS, STATUS_META, TYPE_LABELS, statusKeyForProject } from '@/api'
import { cn } from '@/lib/utils'

const IN_FLOW = [
  'demo_teslim',
  'demo_onay',
  'ozalit_teslim',
  'ozalit_onay',
  'cin_demo_teslim',
  'cin_demo_onay',
]

/** Friendly "where is it right now" label for an in-flow project. */
function whereLabel(stage) {
  switch (stage) {
    case 'demo_teslim':
    case 'ozalit_teslim':
      return 'Matbaada'
    case 'demo_onay':
    case 'ozalit_onay':
    case 'cin_demo_onay':
      return 'Lider onayında'
    case 'cin_demo_teslim':
      return 'Lider incelemesinde'
    default:
      return STAGE_LABELS[stage]
  }
}

export default function DemoRequests() {
  const { user } = useAuth()
  const { projects, loading } = useProjects()
  const navigate = useNavigate()
  const [submitProject, setSubmitProject] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)

  const mine = useMemo(() => {
    if (user?.role === 'team_leader') return projects
    return projects.filter((p) => (p.assignees ?? []).some((a) => a.id === user?.id))
  }, [projects, user])

  // Any project still in the design stage can be sent to demo — complete or not.
  const requestable = useMemo(
    () => mine.filter((p) => p.stage === 'tasarim').sort((a, b) => b.progress - a.progress),
    [mine],
  )
  const inFlow = mine.filter((p) => IN_FLOW.includes(p.stage))

  function onDone() {
    // DemoSubmitDialog already called updateOne — nothing else needed here.
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Demo</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Projeleriniz için matbaadan demo isteyin ve demo sürecini takip edin.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Demo İsteği Oluştur
          </Button>
        </header>

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {/* Request a demo — works for completed and in-progress projects */}
            <Section title="Demo İste" hint="Tasarım aşamasındaki projeler" icon={Send} count={requestable.length}>
              {requestable.length === 0 ? (
                <EmptyNote>Tasarım aşamasında projeniz yok.</EmptyNote>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {requestable.map((p) => {
                    const meta = STATUS_META[statusKeyForProject(p)]
                    const ready = p.progress === 100
                    return (
                      <Card key={p.id}>
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{p.title}</p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <Badge variant="secondary">{TYPE_LABELS[p.type]}</Badge>
                                {ready ? (
                                  <Badge variant="success">Hazır</Badge>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">Tasarım sürüyor</span>
                                )}
                              </div>
                            </div>
                            <AssigneeAvatars assignees={p.assignees} />
                          </div>
                          <div>
                            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>İlerleme</span>
                              <span className="font-semibold text-foreground">{p.progress}%</span>
                            </div>
                            <Progress value={p.progress} className="h-1.5" indicatorClassName={meta.dot} />
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="flex-1"
                              onClick={() => navigate(`/projects/${p.id}`)}
                            >
                              Detay
                            </Button>
                            <Button size="sm" className="flex-1" onClick={() => setSubmitProject(p)}>
                              <Send className="h-4 w-4" />
                              Demoya Gönder
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* In the demo / approval flow */}
            <Section title="Demo Sürecinde" hint="Matbaa ve lider onayındaki projeler" icon={Clock} count={inFlow.length}>
              {inFlow.length === 0 ? (
                <EmptyNote>Süreçte bekleyen demo yok.</EmptyNote>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {inFlow.map((p) => {
                    const meta = STATUS_META[statusKeyForProject(p)]
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => navigate(`/projects/${p.id}`)}
                        className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', meta.dot)} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{p.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {STAGE_LABELS[p.stage]}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {whereLabel(p.stage)}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      <DemoSubmitDialog
        open={!!submitProject}
        onOpenChange={(v) => setSubmitProject(v ? submitProject : null)}
        project={submitProject}
        onDone={onDone}
      />

      <CreateDemoRequestDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={requestable}
        onSent={onDone}
      />
    </AppShell>
  )
}

/**
 * Two-step dialog: (1) pick a project, (2) select which content items to include in the demo.
 */
function CreateDemoRequestDialog({ open, onOpenChange, projects, onSent }) {
  const { updateOne } = useProjects()
  const [selectedId, setSelectedId] = useState(null)
  const [step, setStep] = useState(1) // 1 = pick project, 2 = pick content
  const [selectedSubtasks, setSelectedSubtasks] = useState([])
  const [busy, setBusy] = useState(false)

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null
  const completed = projects.filter((p) => p.progress === 100)
  const inProgress = projects.filter((p) => p.progress < 100)

  function handleClose(v) {
    if (!v) {
      setSelectedId(null)
      setStep(1)
      setSelectedSubtasks([])
    }
    onOpenChange(v)
  }

  function goToStep2() {
    if (!selectedProject) return
    // Pre-select done subtasks
    const done = (selectedProject.subtasks ?? [])
      .filter((s) => s.kind !== 'pages' && s.is_done)
      .map((s) => s.id)
    setSelectedSubtasks(done)
    setStep(2)
  }

  function toggleSub(id) {
    setSelectedSubtasks((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function submit() {
    if (!selectedId) return
    if (selectedSubtasks.length === 0) {
      toast.error('En az bir içerik seçmelisiniz.')
      return
    }
    setBusy(true)
    try {
      const updated = await api.advanceProject(selectedId)
      updateOne(updated)
      toast.success('Demo isteği matbaaya gönderildi.')
      onSent?.(updated)
      handleClose(false)
    } catch (err) {
      toast.error(err.message || 'Demo isteği gönderilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const checkableSubtasks = (selectedProject?.subtasks ?? []).filter((s) => s.kind !== 'pages')
  const pagesSub = (selectedProject?.subtasks ?? []).find((s) => s.kind === 'pages')

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            {step === 1 ? 'Demo İsteği Oluştur' : 'Demo İçeriğini Seç'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Bir proje seçin; ardından demo içeriğini belirleyeceksiniz.'
              : 'Bu demo gönderiminde hangi içerikler hazır? En az bir tane seçin.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          projects.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              Tasarım aşamasında, demo isteğine uygun projeniz yok.
            </p>
          ) : (
            <div className="space-y-4">
              {completed.length > 0 && (
                <PickGroup label="Tamamlanan">
                  {completed.map((p) => (
                    <PickRow
                      key={p.id}
                      project={p}
                      selected={selectedId === p.id}
                      onSelect={() => setSelectedId(p.id)}
                    />
                  ))}
                </PickGroup>
              )}
              {inProgress.length > 0 && (
                <PickGroup label="Devam eden">
                  {inProgress.map((p) => (
                    <PickRow
                      key={p.id}
                      project={p}
                      selected={selectedId === p.id}
                      onSelect={() => setSelectedId(p.id)}
                    />
                  ))}
                </PickGroup>
              )}
            </div>
          )
        ) : (
          <div className="space-y-3">
            {/* Selected project info */}
            <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
              <p className="font-medium text-foreground">{selectedProject?.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Genel ilerleme: {selectedProject?.progress ?? 0}%
              </p>
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              İçerikler
            </p>

            {checkableSubtasks.map((s) => {
              const checked = selectedSubtasks.includes(s.id)
              return (
                <label
                  key={s.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                    checked ? 'border-primary/40 bg-primary/5' : 'hover:border-input hover:bg-muted/30',
                  )}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0 rounded border',
                      checked ? 'text-primary' : 'text-transparent',
                    )}
                    onClick={() => toggleSub(s.id)}
                  />
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleSub(s.id)}
                  />
                  <span className="flex-1 text-sm font-medium">{s.title}</span>
                  {s.is_done && (
                    <span className="text-[11px] font-medium text-emerald-600">Hazır</span>
                  )}
                </label>
              )
            })}

            {pagesSub && (
              <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{pagesSub.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {pagesSub.pages_done ?? 0} / {pagesSub.total_pages ?? 0} sayfa
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Sayfa sayısı demo ile otomatik gönderilir.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button type="button" variant="ghost" onClick={() => handleClose(false)}>
                İptal
              </Button>
              <Button type="button" onClick={goToStep2} disabled={!selectedId}>
                Devam
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                Geri
              </Button>
              <Button type="button" onClick={submit} disabled={busy || selectedSubtasks.length === 0}>
                <Send className="h-4 w-4" />
                {busy ? 'Gönderiliyor…' : 'Demoya Gönder'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PickGroup({ label, children }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function PickRow({ project, selected, onSelect }) {
  const meta = STATUS_META[statusKeyForProject(project)]
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
      )}
    >
      <span
        className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded-full border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{project.title}</span>
          <Badge variant="secondary" className="shrink-0">
            {TYPE_LABELS[project.type]}
          </Badge>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Progress value={project.progress} className="h-1.5 w-28" indicatorClassName={meta.dot} />
          <span className="text-[11px] text-muted-foreground">{project.progress}%</span>
        </div>
      </div>
    </button>
  )
}

function Section({ title, hint, icon: Icon, count, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-secondary px-1.5 text-[11px] font-semibold text-secondary-foreground">
          {count}
        </span>
        {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
      </div>
      {children}
    </section>
  )
}

function EmptyNote({ children }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
