import { useState, useEffect } from 'react'
import { Send, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import api from '@/api'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { useDesignerCelebration } from '@/hooks/useCelebration'
import { cn } from '@/lib/utils'

/**
 * Dialog shown when a designer sends a project to demo.
 * Lists the project's content items so the designer can specify
 * which ones are included in this demo submission.
 */
export default function DemoSubmitDialog({ open, onOpenChange, project, onDone }) {
  const { updateOne } = useProjectsStore()
  const celebrate = useDesignerCelebration()
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  // The list-view project has no subtasks; fetch the full detail when opened.
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    if (!open || !project) {
      setDetail(null)
      setSelected([])
      return
    }
    let active = true
    setLoadingDetail(true)
    api
      .getProject(project.id)
      .then((full) => {
        if (!active) return
        setDetail(full)
        // Pre-select content that's already done.
        const done = (full.subtasks ?? [])
          .filter((s) => s.is_done && s.kind !== 'pages')
          .map((s) => s.id)
        setSelected(done)
      })
      .catch(() => active && setDetail(null))
      .finally(() => active && setLoadingDetail(false))
    return () => {
      active = false
    }
  }, [project?.id, open])

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!project) return
    if (selected.length === 0) {
      toast.error('En az bir içerik seçmelisiniz.')
      return
    }
    setBusy(true)
    try {
      const updated = await api.advanceProject(project.id)
      updateOne(updated)
      toast.success('Demo isteği matbaaya gönderildi.')
      celebrate()
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'Demo isteği gönderilemedi.')
    } finally {
      setBusy(false)
    }
  }

  if (!project) return null

  const proj = detail ?? project
  const subtasks = proj.subtasks ?? []
  const checkable = subtasks.filter((s) => s.kind !== 'pages')
  const pagesSub = subtasks.find((s) => s.kind === 'pages')

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setSelected([]); onOpenChange(v) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Demo İçeriğini Seç
          </DialogTitle>
          <DialogDescription>
            Bu demo gönderiminde hangi içerikler hazır? En az bir tane seçin.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Project info */}
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
            <p className="font-medium text-foreground">{proj.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Genel ilerleme: {proj.progress}%
            </p>
          </div>

          {/* Content checkboxes */}
          {loadingDetail ? (
            <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
              İçerikler yükleniyor…
            </p>
          ) : subtasks.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
              Bu proje için tanımlı içerik yok.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                İçerikler
              </p>

              {checkable.map((s) => {
                const checked = selected.includes(s.id)
                return (
                  <label
                    key={s.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      checked
                        ? 'border-primary/40 bg-primary/5'
                        : 'hover:border-input hover:bg-muted/30',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(s.id)}
                      id={`sub-${s.id}`}
                    />
                    <span className="flex-1 text-sm font-medium">{s.title}</span>
                    {s.is_done && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                        <PackageCheck className="h-3 w-3" />
                        Hazır
                      </span>
                    )}
                  </label>
                )
              })}

              {/* Pages subtask — shown as info only, auto-included if pages > 0 */}
              {pagesSub && (
                <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{pagesSub.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {pagesSub.pages_done ?? 0} / {pagesSub.total_pages ?? 0} sayfa
                    </span>
                  </div>
                  <Progress
                    value={
                      pagesSub.total_pages > 0
                        ? Math.round(((pagesSub.pages_done ?? 0) / pagesSub.total_pages) * 100)
                        : 0
                    }
                    className="mt-2 h-1.5"
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Sayfa sayısı demo ile otomatik gönderilir.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={busy || loadingDetail || selected.length === 0}>
              <Send className="h-4 w-4" />
              {busy ? 'Gönderiliyor…' : 'Demoya Gönder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
