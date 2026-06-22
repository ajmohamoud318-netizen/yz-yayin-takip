import { useEffect, useState } from 'react'
import { Check, X, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import api, { STAGE_LABELS } from '@/api'
import { useProjectsStore } from '@/hooks/useProjectsStore'

// Where an approval sends the project, with a destination-aware button label.
const APPROVE_DEST = {
  demo_onay: { label: "Ozalit'e Gönder", stage: 'ozalit_teslim' },
  ozalit_onay: { label: 'Üretime Al', stage: 'uretimde' },
  cin_demo_onay: { label: 'Üretime Al', stage: 'uretimde' },
}

/**
 * Approval / rejection dialog. The `mode` decides which action the dialog
 * is configured for. Reason is mandatory in `reject` mode.
 *
 *   mode = 'approve' | 'reject' | 'advance'
 */
export default function ApprovalDialog({ open, onOpenChange, project, mode = 'approve', advanceLabel = 'İlerlet', onDone }) {
  const { updateOne } = useProjectsStore()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  // IDs of the subtasks the leader wants the designer to revise.
  const [revizeIds, setRevizeIds] = useState([])

  // Project's own subtasks (drop any legacy revize-kind rows).
  const revisableSubtasks = (project?.subtasks ?? []).filter((s) => s.kind !== 'revize')

  // Reset the picker each time the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setRevizeIds([])
      setReason('')
    }
  }, [open, project?.id])

  function toggleRevize(subId) {
    setRevizeIds((prev) =>
      prev.includes(subId) ? prev.filter((x) => x !== subId) : [...prev, subId],
    )
  }

  // Destination of this approval (e.g. Demo Onay → Ozalit). Null on non-approve.
  const approveDest = project ? APPROVE_DEST[project.stage] : null
  const approveLabel = approveDest?.label ?? 'Onayla'

  // A project can't enter production until its design is 100% complete.
  const blocksUretim =
    mode === 'approve' &&
    approveDest?.stage === 'uretimde' &&
    (project?.progress ?? 0) < 100

  const titles = {
    approve: approveDest?.label ?? 'Aşamayı onayla',
    reject: 'Reddet ve geri gönder',
    advance: advanceLabel,
  }
  const isOzalitReject = project?.stage === 'ozalit_onay'
  const descriptions = {
    approve: approveDest
      ? `Onaylandığında proje "${STAGE_LABELS[approveDest.stage]}" aşamasına geçecek. Onaylıyor musunuz?`
      : 'Bu proje bir sonraki aşamaya ilerleyecek. Bu işlemi onaylıyor musunuz?',
    reject: isOzalitReject
      ? 'Proje tasarım aşamasına geri dönecek ve Ozalit denemesi sayacı artacak. Revize edilmesini istediğiniz alt görevleri seçin ve bir sebep yazın.'
      : 'Proje tasarım aşamasına geri dönecek ve demo denemesi sayacı artacak. Revize edilmesini istediğiniz alt görevleri seçin ve bir sebep yazın.',
    advance: 'Bu projeyi sonraki aşamaya elle ilerleteceksiniz. Devam edilsin mi?',
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!project) return
    if (mode === 'reject' && !reason.trim()) {
      toast.error('Red sebebi zorunludur.')
      return
    }
    if (mode === 'reject' && revisableSubtasks.length > 0 && revizeIds.length === 0) {
      toast.error('Revize edilecek en az bir alt görev seçin.')
      return
    }
    setBusy(true)
    try {
      let updated
      if (mode === 'approve') updated = await api.approveProject(project.id)
      else if (mode === 'reject') updated = await api.rejectProject(project.id, reason.trim(), revizeIds)
      else updated = await api.advanceProject(project.id)
      updateOne(updated)
      toast.success(
        mode === 'approve' ? 'Onaylandı.' : mode === 'reject' ? 'Reddedildi.' : 'İlerletildi.',
      )
      onDone?.(updated)
      onOpenChange(false)
      setReason('')
      setRevizeIds([])
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setBusy(false)
    }
  }

  if (!project) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'approve' && <Check className="h-4 w-4 text-emerald-600" />}
            {mode === 'reject' && <X className="h-4 w-4 text-destructive" />}
            {mode === 'advance' && <Send className="h-4 w-4 text-primary" />}
            {titles[mode]}
          </DialogTitle>
          <DialogDescription>{descriptions[mode]}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-foreground">{project.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Şu anki aşama: {STAGE_LABELS[project.stage] ?? project.stage} · İlerleme: %{project.progress ?? 0}
            </p>
          </div>

          {blocksUretim && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Bu proje %100 tamamlanmadan üretime alınamaz. Lütfen önce tüm alt görevlerin
              tamamlandığından emin olun.
            </div>
          )}

          {mode === 'reject' && revisableSubtasks.length > 0 && (
            <div className="space-y-1.5">
              <Label>Revize Edilecek Alt Görevler *</Label>
              <p className="text-xs text-muted-foreground">
                Tasarımcı yalnızca seçtiğiniz görevleri yeniden düzenleyebilir; diğerleri
                tamamlanmış kabul edilir.
              </p>
              <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {revisableSubtasks.map((s) => {
                  const checked = revizeIds.includes(s.id)
                  return (
                    <label
                      key={s.id}
                      className={
                        'flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition ' +
                        (checked
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-transparent hover:bg-muted/50')
                      }
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggleRevize(s.id)} />
                      <span className="flex-1">{s.title}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {mode === 'reject' && (
            <div className="space-y-1.5">
              <Label htmlFor="reason">Red Sebebi *</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Lütfen neyin düzeltilmesi gerektiğini açıklayın…"
                rows={4}
                required
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button
              type="submit"
              disabled={busy || blocksUretim}
              variant={mode === 'reject' ? 'destructive' : mode === 'approve' ? 'success' : 'default'}
            >
              {busy ? 'İşleniyor…' : mode === 'approve' ? approveLabel : mode === 'reject' ? 'Reddet' : advanceLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
