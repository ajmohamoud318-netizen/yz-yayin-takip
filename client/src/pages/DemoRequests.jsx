import { useEffect, useMemo, useState } from 'react'
import { useProjectModal } from '@/hooks/useProjectModal'
import { Send, Plus, Clock, FileText, RefreshCw, X, ThumbsUp, ThumbsDown } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import ApprovalDialog from '@/components/ApprovalDialog'
import DemoFormDialog from '@/components/DemoFormDialog'
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
  const { projects, loading, refetch } = useProjects()
  const { openProject } = useProjectModal()
  const [demoOpen, setDemoOpen] = useState(false)
  const [demos, setDemos] = useState([])
  const [approvalDialog, setApprovalDialog] = useState(null) // { project, mode }
  const [demoFormState, setDemoFormState] = useState(null)   // { project, mode }

  // Team leader and designers can request / create demos.
  const canDemo = user?.role === 'team_leader' || user?.role === 'designer'

  async function loadDemos() {
    try {
      // Project-linked rows in /api/demos are per-attempt form snapshots
      // (saved by the spec-form dialog) — not standalone demos. Only
      // standalone entries (no project_id) belong in this list, and the
      // card below assumes title/files exist on them.
      const all = await api.listDemos()
      setDemos((all ?? []).filter((d) => !d.project_id && Array.isArray(d.files)))
    } catch {
      /* demos are optional */
    }
  }
  useEffect(() => {
    loadDemos()
  }, [])

  const inFlow = useMemo(() => projects.filter((p) => IN_FLOW.includes(p.stage)), [projects])

  function openDemoForm(p, mode = 'advance') {
    setDemoFormState({ project: p, mode })
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Demo</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="h-4 w-4" />
              Yenile
            </Button>
            {canDemo && (
              <Button size="sm" onClick={() => setDemoOpen(true)}>
                <Plus className="h-4 w-4" />
                Demo Oluştur
              </Button>
            )}
          </div>
        </header>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {/* Standalone demos */}
            {demos.length > 0 && (
              <section className="space-y-2">
                <SectionTitle icon={FileText} title="Bağımsız Demolar" count={demos.length} />
                <div className="space-y-2">
                  {demos.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-dashed bg-card px-4 py-3 shadow-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{d.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {(d.items?.length ?? 0)} içerik · {d.files.length} dosya ·{' '}
                          {new Date(d.created_at).toLocaleDateString('tr-TR')}
                        </p>
                        {d.items?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {d.items.map((it) => (
                              <span
                                key={it.id}
                                className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                              >
                                {it.title}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDemoForm(
                            { id: d.id, title: d.title, assignees: [], assigned_name: '', subtasks: [], history: [], demo_attempt: 0 },
                            'view'
                          )}
                        >
                          <FileText className="h-4 w-4" />
                          Formu Görüntüle
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* All projects with Demo İste */}
            <section className="space-y-2">
              <SectionTitle icon={Send} title="Tüm Projeler" count={projects.length} />
              {projects.length === 0 ? (
                <EmptyNote>Henüz proje yok.</EmptyNote>
              ) : (
                <div className="space-y-2">
                  {projects.map((p) => {
                    const meta = STATUS_META[statusKeyForProject(p)]
                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openProject(p.id)}
                        onKeyDown={(e) => e.key === 'Enter' && openProject(p.id)}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', meta.dot)} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{p.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {TYPE_LABELS[p.type]} · {STAGE_LABELS[p.stage]} · {p.assigned_name}
                          </p>
                        </div>

                        <div className="hidden w-28 items-center gap-2 sm:flex">
                          <Progress value={p.progress} className="h-1.5 flex-1" indicatorClassName={meta.dot} />
                          <span className="w-9 text-right text-xs font-semibold text-foreground">{p.progress}%</span>
                        </div>

                        {canDemo && p.stage === 'tasarim' && p.progress === 100 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              openDemoForm(p, 'advance')
                            }}
                          >
                            <Send className="h-4 w-4" />
                            Demo İste
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* In the demo / approval flow */}
            <section className="space-y-2">
              <SectionTitle icon={Clock} title="Demo Sürecinde" count={inFlow.length} />
              {inFlow.length === 0 ? (
                <EmptyNote>Süreçte bekleyen demo yok.</EmptyNote>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {inFlow.map((p) => {
                    const meta = STATUS_META[statusKeyForProject(p)]
                    const canTeslim =
                      user?.role === 'printer' &&
                      p.type === 'TR' &&
                      (p.stage === 'demo_teslim' || p.stage === 'ozalit_teslim')
                    const canAct =
                      user?.role === 'team_leader' &&
                      (p.stage === 'demo_onay' || p.stage === 'ozalit_onay' || p.stage === 'cin_demo_onay')
                    return (
                      <div key={p.id} className="rounded-xl border bg-card shadow-sm">
                        <button
                          type="button"
                          onClick={() => openProject(p.id)}
                          className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-xl"
                        >
                          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', meta.dot)} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{p.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{STAGE_LABELS[p.stage]}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0">
                            {whereLabel(p.stage)}
                          </Badge>
                        </button>
                        {(canTeslim || canAct) && (
                          <div className="flex items-center gap-2 border-t px-3 py-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="flex-1 text-xs"
                              onClick={() => openProject(p.id)}
                            >
                              Detay
                            </Button>
                            {canTeslim && (
                              <Button
                                size="sm"
                                className="flex-1"
                                onClick={() => setApprovalDialog({ project: p, mode: 'advance' })}
                              >
                                <Send className="h-4 w-4" />
                                Teslim Et
                              </Button>
                            )}
                            {canAct && (
                              <>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="flex-1"
                                  onClick={() => setApprovalDialog({ project: p, mode: 'reject' })}
                                >
                                  <ThumbsDown className="h-4 w-4" />
                                  Reddet
                                </Button>
                                <Button
                                  size="sm"
                                  variant="success"
                                  className="flex-1"
                                  onClick={() => setApprovalDialog({ project: p, mode: 'approve' })}
                                >
                                  <ThumbsUp className="h-4 w-4" />
                                  Onayla
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <CreateDemoDialog
        open={demoOpen}
        onOpenChange={setDemoOpen}
        onCreated={loadDemos}
      />

      <ApprovalDialog
        open={!!approvalDialog}
        onOpenChange={(v) => setApprovalDialog(v ? approvalDialog : null)}
        project={approvalDialog?.project}
        mode={approvalDialog?.mode ?? 'approve'}
        advanceLabel="Teslim Et"
        onDone={() => refetch()}
      />

      <DemoFormDialog
        open={!!demoFormState}
        onOpenChange={(v) => setDemoFormState(v ? demoFormState : null)}
        project={demoFormState?.project}
        mode={demoFormState?.mode ?? 'view'}
        onDone={() => { setDemoFormState(null); refetch() }}
      />
    </>
  )
}

/* ----------------------- create demo dialog ----------------------- */
// Quick-add suggestions for demo content items.
const ITEM_SUGGESTIONS = ['Kapak', 'Kutu', 'Ses', 'Video', 'Yazılım']

function CreateDemoDialog({ open, onOpenChange, onCreated }) {
  const [title, setTitle] = useState('')
  const [files, setFiles] = useState([])
  const [items, setItems] = useState([])
  const [itemDraft, setItemDraft] = useState('')
  const [saving, setSaving] = useState(false)

  function close(v) {
    if (!v) {
      setTitle('')
      setFiles([])
      setItems([])
      setItemDraft('')
    }
    onOpenChange(v)
  }

  function addItem(value) {
    const v = (value ?? itemDraft).trim()
    if (!v) return
    if (items.some((i) => i.toLowerCase() === v.toLowerCase())) {
      setItemDraft('')
      return
    }
    setItems((prev) => [...prev, v])
    setItemDraft('')
  }

  function removeItem(value) {
    setItems((prev) => prev.filter((i) => i !== value))
  }

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Lütfen bir demo adı girin.')
      return
    }
    setSaving(true)
    try {
      await api.createDemo({ title: title.trim(), files, items })
      toast.success('Demo oluşturuldu.')
      onCreated?.()
      close(false)
    } catch (err) {
      toast.error(err.message || 'Demo oluşturulamadı.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md max-sm:left-0 max-sm:top-0 max-sm:h-screen max-sm:max-h-screen max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Demo Oluştur
          </DialogTitle>
          <DialogDescription>
            Projelerde olmayan dosyalardan bağımsız bir demo oluşturun.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Demo Adı</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="örn. Yeni kapak denemesi"
            />
          </div>

          {/* Content items — add your own like Kapak, Kutu, etc. */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">İçerikler</label>
            <div className="flex gap-2">
              <Input
                value={itemDraft}
                onChange={(e) => setItemDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addItem()
                  }
                }}
                placeholder="örn. Kutu"
              />
              <Button type="button" variant="outline" onClick={() => addItem()}>
                <Plus className="h-4 w-4" />
                Ekle
              </Button>
            </div>

            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {ITEM_SUGGESTIONS.filter((s) => !items.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addItem(s)}
                  className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  + {s}
                </button>
              ))}
            </div>

            {/* Added items */}
            {items.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {items.map((it) => (
                  <span
                    key={it}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    {it}
                    <button
                      type="button"
                      onClick={() => removeItem(it)}
                      className="rounded-full hover:text-primary/70"
                      aria-label={`${it} kaldır`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Dosyalar</label>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full cursor-pointer rounded-lg border border-dashed bg-background px-3 py-2.5 text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
            />
            {files.length > 0 && (
              <ul className="space-y-1 pt-1">
                {files.map((f, i) => (
                  <li key={i} className="truncate text-xs text-muted-foreground">
                    • {f.name}{' '}
                    <span className="text-muted-foreground/70">({Math.round(f.size / 1024)} KB)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Oluşturuluyor…' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ----------------------------- bits ------------------------------- */
function SectionTitle({ icon: Icon, title, count }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-secondary px-1.5 text-[11px] font-semibold text-secondary-foreground">
        {count}
      </span>
    </div>
  )
}

function EmptyNote({ children }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
