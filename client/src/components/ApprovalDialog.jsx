import { useState } from 'react'
import { Check, X, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
  demo_onay: { label: "Özalit'e Gönder", stage: 'ozalit_teslim' },
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

  // Destination of this approval (e.g. Demo Onay → Özalit). Null on non-approve.
  const approveDest = project ? APPROVE_DEST[project.stage] : null
  const approveLabel = approveDest?.label ?? 'Onayla'

  const titles = {
    approve: approveDest?.label ?? 'Aşamayı onayla',
    reject: 'Reddet ve geri gönder',
    advance: advanceLabel,
  }
  const descriptions = {
    approve: approveDest
      ? `Onaylandığında proje "${STAGE_LABELS[approveDest.stage]}" aşamasına geçecek. Onaylıyor musunuz?`
      : 'Bu proje bir sonraki aşamaya ilerleyecek. Bu işlemi onaylıyor musunuz?',
    reject:
      'Proje tasarım aşamasına geri dönecek ve demo denemesi sayacı artacak. Lütfen bir sebep yazın.',
    advance: 'Bu projeyi sonraki aşamaya elle ilerleteceksiniz. Devam edilsin mi?',
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!project) return
    if (mode === 'reject' && !reason.trim()) {
      toast.error('Red sebebi zorunludur.')
      return
    }
    setBusy(true)
    try {
      let updated
      if (mode === 'approve') updated = await api.approveProject(project.id)
      else if (mode === 'reject') updated = await api.rejectProject(project.id, reason.trim())
      else updated = await api.advanceProject(project.id)
      updateOne(updated)
      toast.success(
        mode === 'approve' ? 'Onaylandı.' : mode === 'reject' ? 'Reddedildi.' : 'İlerletildi.',
      )
      onDone?.(updated)
      onOpenChange(false)
      setReason('')
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
              Şu anki aşama: {STAGE_LABELS[project.stage] ?? project.stage}
            </p>
          </div>

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
              disabled={busy}
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
