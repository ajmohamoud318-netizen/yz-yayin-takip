import { ORDER_REJECT_TARGETS } from '@/api'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * The team leader's reject form inside TalepSignDialog — split out of it
 * (slice: client god-components).
 *
 * Three questions, in the order they matter: who re-does the rejected ozalit,
 * which alt görevler go back with it, and why. The dialog owns the state and
 * the submit; this only asks.
 */
export default function TalepRejectForm({
  order,
  route,
  onRouteChange,
  revisableSubtasks,
  revizeIds,
  onToggleRevize,
  reason,
  onReasonChange,
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      {/* Route choice: who re-does the rejected ozalit? Only the
          targets this step actually offers are shown — ekran_onay
          never touched a physical proof, so it has no 'matbaa'
          option, and no 'reassign' either. */}
      {ORDER_REJECT_TARGETS[order.status] && (
        <div className="space-y-1.5">
          <Label className="text-destructive">Kime geri gönderilsin?</Label>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Object.keys(ORDER_REJECT_TARGETS[order.status]).length}, 1fr)` }}
          >
            {ORDER_REJECT_TARGETS[order.status].designer && (
              <button
                type="button"
                onClick={() => onRouteChange('designer')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition',
                  route === 'designer'
                    ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                    : 'hover:bg-muted/50',
                )}
              >
                <span className="block text-sm font-semibold">Tasarımcı</span>
                <span className="block text-xs text-muted-foreground">Tasarımı yeniden düzenler</span>
              </button>
            )}
            {ORDER_REJECT_TARGETS[order.status].matbaa && (
              <button
                type="button"
                onClick={() => onRouteChange('matbaa')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition',
                  route === 'matbaa'
                    ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                    : 'hover:bg-muted/50',
                )}
              >
                <span className="block text-sm font-semibold">Matbaa</span>
                <span className="block text-xs text-muted-foreground">Yeniden teslim eder</span>
              </button>
            )}
            {ORDER_REJECT_TARGETS[order.status].reassign && (
              <button
                type="button"
                onClick={() => onRouteChange('reassign')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition',
                  route === 'reassign'
                    ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                    : 'hover:bg-muted/50',
                )}
              >
                <span className="block text-sm font-semibold">Kadro değişsin</span>
                <span className="block text-xs text-muted-foreground">Tasarımcıyı yeniden seçer</span>
              </button>
            )}
          </div>
        </div>
      )}
      {/* Which alt görevler have to be redone. Mirrors the demo/ozalit
          rejection picker in ApprovalDialog. */}
      {route === 'designer' && revisableSubtasks.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-destructive">
            Revize Edilecek Alt Görevler{' '}
            <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Yalnızca tamamlanmış görevler revize edilebilir. Seçtikleriniz tasarımcıya
            revize olarak işaretlenir; seçmezseniz talep sadece geri gönderilir.
          </p>
          <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border bg-background p-2">
            {revisableSubtasks.map((s) => {
              const checked = revizeIds.includes(s.id)
              return (
                <label
                  key={s.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition',
                    checked ? 'border-amber-300 bg-amber-50' : 'border-transparent hover:bg-muted/50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleRevize(s.id)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span className={cn('min-w-0 flex-1', checked && 'font-medium text-amber-800')}>
                    {s.title}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="reject-reason" className="text-destructive">Red Sebebi *</Label>
        <Textarea
          id="reject-reason"
          rows={2}
          placeholder="Ozalitin neden reddedildiğini yazın…"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          className="resize-none text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {route === 'designer'
            ? 'Tasarımcıya geri gönderilir; tasarımı revize eder. Ozalit deneme sayacı artar.'
            : route === 'reassign'
            ? 'Talep başa sarılır; takım lideri tasarımcı kadrosunu yeniden seçer. Ozalit deneme sayacı artar.'
            : 'Matbaaya geri gönderilir; yeni bir Ozalit teslim edilir. Tasarım değişmez. Ozalit deneme sayacı artar.'}
        </p>
      </div>
    </div>
  )
}
