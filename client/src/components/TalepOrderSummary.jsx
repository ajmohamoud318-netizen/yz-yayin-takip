import { Check, ShoppingCart } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { cn, formatNumber } from '@/lib/utils'

/**
 * The two read-the-order blocks at the top of TalepSignDialog — split out of
 * it (slice: client god-components): what was ordered, and (on the assign
 * step) who is going to check it.
 */

/** What this sipariş is: title, the parça/adet chips, and the sales note. */
export function TalepOrderSummary({ order, items }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">
            {order.project_title?.replace(/ \/ /g, ' ')}
          </p>
          {items.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {items.map((item) => (
                <span
                  key={item.name}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  {item.name}
                  <span className="font-normal text-primary/70">
                    · {formatNumber(item.quantity)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatNumber(order.quantity)} adet
            </p>
          )}
          {order.notes && (
            <p className="mt-0.5 text-xs text-muted-foreground">Not: {order.notes}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Assign step (pending → görüldü): the team leader picks the designer(s) who
 * will check this run. Defaults to the project's current designers, but the
 * reprint can go to anyone active.
 */
export function TalepAssignDesigners({ designers, assignIds, onToggle }) {
  return (
    <div className="space-y-1.5">
      <Label>Tasarımcı(lar), kim kontrol edecek? *</Label>
      <p className="text-xs text-muted-foreground">
        Bu baskıyı orijinal tasarımcı(lar)a veya farklı birine atayabilirsiniz.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {designers.map((d) => {
          const sel = assignIds.includes(d.id)
          return (
            <button
              type="button"
              key={d.id}
              onClick={() => onToggle(d.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                sel
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
            >
              {sel && <Check className="h-3 w-3" />}
              {d.name}
            </button>
          )
        })}
        {designers.length === 0 && (
          <span className="text-xs text-muted-foreground">Aktif tasarımcı bulunamadı.</span>
        )}
      </div>
    </div>
  )
}
