import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * Generic "Emin misiniz?" confirmation dialog. Adds a deliberate second step in
 * front of high-impact, one-click actions (create/confirm a handover, take a
 * project into production) so they can't be triggered by an accidental click.
 *
 * Controlled: the parent owns `open` and runs the real work in `onConfirm`.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title = 'Emin misiniz?',
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  busy = false,
  busyLabel = 'İşleniyor…',
  variant = 'default',
  onConfirm,
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm max-sm:left-0 max-sm:top-0 max-sm:h-screen max-sm:max-h-screen max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={variant} onClick={onConfirm} disabled={busy} loading={busy}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
