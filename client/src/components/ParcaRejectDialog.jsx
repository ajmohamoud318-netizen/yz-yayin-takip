import { useEffect, useState } from 'react'
import { ThumbsDown, Palette, Printer } from 'lucide-react'

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
import { cn } from '@/lib/utils'

/**
 * Reject one parça, and say whose problem it is (migration 074).
 *
 * This replaces the grid's old silent reject, which posted a hard-coded
 * "Parça bazlı red" to the designer every time. Two things were wrong with
 * that: the leader could not route a printing fault to the matbaa, and the
 * timeline recorded a reason nobody wrote.
 *
 * The responsible party is the whole point of the dialog, so it leads — the
 * reason follows. Choosing wrong sends real work to the wrong desk, so there
 * is no pre-selected default and the submit button stays disabled until the
 * leader picks one.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   project: object,
 *   parcalar: string[],
 *   busy?: boolean,
 *   onConfirm: (parcalar: string[], reason: string, target: 'designer' | 'matbaa') => Promise<void> | void,
 * }} props
 */
export default function ParcaRejectDialog({
  open, onOpenChange, project, parcalar = [], busy = false, onConfirm,
}) {
  const [reason, setReason] = useState('')
  const [target, setTarget] = useState(null)

  useEffect(() => {
    if (open) { setReason(''); setTarget(null) }
  }, [open, project?.id, parcalar.join('|')])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!target || !reason.trim()) return
    await onConfirm?.(parcalar, reason.trim(), target)
  }

  if (!project || parcalar.length === 0) return null

  const many = parcalar.length > 1

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThumbsDown className="h-4 w-4 text-destructive" />
            {many ? `${parcalar.length} parçayı reddedin` : 'Parçayı reddedin'}
          </DialogTitle>
          <DialogDescription>
            Yalnızca {many ? 'bu parçalar' : 'bu parça'} geri döner. Onaylanmış diğer
            parçalar onaylı kalır ve proje aşaması değişmez.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* The parçalar this applies to. Names wrap rather than truncate —
              a clipped parça name is the one thing the leader must not
              misread here. */}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium text-foreground">{project.title}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {parcalar.map((p) => (
                <span
                  key={p}
                  className="inline-flex rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Kim ilgilenecek? *</Label>
            {/* Stacked on a phone, side by side from sm up — these are the
                two halves of one decision, so they stay equal weight. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TargetOption
                selected={target === 'designer'}
                onSelect={() => setTarget('designer')}
                disabled={busy}
                Icon={Palette}
                label="Tasarımcı"
                hint="Tasarım düzeltilecek, sonra yeni tur istenecek"
              />
              <TargetOption
                selected={target === 'matbaa'}
                onSelect={() => setTarget('matbaa')}
                disabled={busy}
                Icon={Printer}
                label="Matbaa"
                hint="Tasarım doğru, yalnızca yeniden basılacak"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="parca-reject-reason">Red Sebebi *</Label>
            <Textarea
              id="parca-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={target === 'matbaa'
                ? 'Örn. kutu baskısında leke var…'
                : 'Örn. kapak kerningi bozuk…'}
              rows={3}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              İptal
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !target || !reason.trim()}>
              {busy ? 'İşleniyor…' : 'Reddedin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One of the two responsible-party choices. A button rather than a radio so
 * the whole card is the tap target — these are thumb-sized on a phone, which
 * is where this decision actually gets made.
 */
function TargetOption({ selected, onSelect, disabled, Icon, label, hint }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg border p-3 text-left transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border bg-card hover:bg-muted/50',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}
