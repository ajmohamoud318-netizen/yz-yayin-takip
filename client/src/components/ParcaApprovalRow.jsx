import { Check, ThumbsUp, ThumbsDown, Hourglass, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Per-parça approval chip — the per-parça grid's atomic row. Three states:
 *
 *   pending  → amber dot + Onayla/Reddet buttons. The leader's primary
 *              control surface on a multi-parça round.
 *   approved → green check + "Onaylandı" badge. Read-only; the row sticks
 *              around so the queue reads as a to-do list ("KUTU done, KİTAP
 *              next"), not as a status that disappears after every click.
 *   rejected → red chip + "Reddedildi" badge. Same read-only rationale.
 *
 * `signers` is the list of approver rows for this parça — the demo list shape
 * `{ by, by_name, at }` for the demo gate, the ozalit-object shape
 * `{ id, role, name, at }` for the ozalit gate. Normalised by the caller to
 * a flat array of `{ name, at }` so this row stays presentation-only.
 *
 * @param {{
 *   parca: string,
 *   status: 'pending' | 'approved' | 'rejected',
 *   signers?: Array<{ name: string, at: string }>,
 *   busy?: boolean,
 *   onApprove?: () => void,
 *   onReject?: () => void,
 *   className?: string,
 * }} props
 */
export default function ParcaApprovalRow({
  parca,
  status,
  signers = [],
  busy = false,
  onApprove,
  onReject,
  className,
}) {
  const isPending = status === 'pending'
  const isApproved = status === 'approved'
  const isRejected = status === 'rejected'
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2',
        isPending && 'border-amber-200 bg-amber-50/40',
        isApproved && 'border-emerald-200 bg-emerald-50/30',
        isRejected && 'border-rose-200 bg-rose-50/30',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={status} />
        <span className="truncate text-sm font-medium text-foreground" title={parca}>
          {parca}
        </span>
        {signers.length > 0 && (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {signers.map((s) => s.name).join(', ')}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isApproved && (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <Check className="h-3 w-3" />
            Onaylandı
          </span>
        )}
        {isRejected && (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
            <AlertCircle className="h-3 w-3" />
            Reddedildi
          </span>
        )}
        {isPending && (
          <>
            {onReject && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-rose-700 hover:bg-rose-100"
                onClick={onReject}
                disabled={busy}
                title="Sadece bu parçayı reddet"
                aria-label={`${parca} parçasını reddet`}
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </Button>
            )}
            {onApprove && (
              <Button
                size="sm"
                variant="success"
                className="h-7 px-2"
                onClick={onApprove}
                disabled={busy}
                title="Sadece bu parçayı onayla"
                aria-label={`${parca} parçasını onayla`}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatusDot({ status }) {
  if (status === 'approved') {
    return <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
  }
  if (status === 'rejected') {
    return <AlertCircle className="h-3.5 w-3.5 text-rose-600" strokeWidth={2.5} />
  }
  return <Hourglass className="h-3.5 w-3.5 text-amber-600" strokeWidth={2.5} />
}
