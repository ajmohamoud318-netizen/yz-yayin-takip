import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
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
import api from '@/api'
import { useProjectsStore } from '@/hooks/useProjectsStore'

/**
 * Reject a pending Ekran Demo Onayı request (migration 050). Unlike the main
 * pipeline's ApprovalDialog reject mode, there's no target/revize picker —
 * rejecting always just falls back to the normal physical Demo İste, so the
 * only input needed is the required reason.
 */
export default function EkranDemoRejectDialog({ open, onOpenChange, project, onDone }) {
  const { updateOne } = useProjectsStore()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setReason('')
  }, [open, project?.id])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!project || !reason.trim()) return
    setBusy(true)
    try {
      const updated = await api.rejectEkranDemo(project.id, reason.trim())
      updateOne(updated)
      toast.success('Ekran demo onayı reddedildi.')
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
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <X className="h-4 w-4 text-destructive" />
            Ekran demo onayını reddedin
          </DialogTitle>
          <DialogDescription>
            Proje demo onay aşamasında kalır; ekip lideri veya tasarımcı normal (fiziksel) demo
            sürecine devam edebilir. Bir red sebebi yazın.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-foreground">{project.title}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ekran-demo-reject-reason">Red Sebebi *</Label>
            <Textarea
              id="ekran-demo-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lütfen neden ekrandan onaylanamadığını açıklayın…"
              rows={4}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              İptal
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
              {busy ? 'İşleniyor…' : 'Reddedin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
