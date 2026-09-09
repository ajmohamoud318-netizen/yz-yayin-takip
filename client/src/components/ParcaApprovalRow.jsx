import { Check, ThumbsUp, ThumbsDown, Hourglass, AlertCircle, PackageCheck, Clock, PackageX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Per-parça approval chip — the per-parça grid's atomic row. Five states:
 *
 *   pending  → amber dot + Onayla/Reddet buttons. The leader's primary
 *              control surface on a multi-parça round.
 *   approved → green check + "Onaylandı" badge. Read-only; the row sticks
 *              around so the queue reads as a to-do list ("KUTU done, KİTAP
 *              next"), not as a status that disappears after every click.
 *   rejected → red chip + "Reddedildi" badge. Same read-only rationale.
 *
 * The last two belong to a round that is still out at the matbaa (migration
 * 076), where the parçalar arrive one at a time and each is decided as it
 * lands:
 *
 *   awaiting_receipt → the matbaa handed this parça back and nobody has
 *              confirmed it arrived. One button, "Teslim Alın", because that is
 *              genuinely the only thing to do: approving a proof you haven't
 *              got is what the receipt gate exists to prevent.
 *   out      → still on somebody else's desk (`outLabel` says whose). Shown,
 *              never actionable — a leader who can only see the parçalar in
 *              front of them cannot tell whether the round is waiting on the
 *              matbaa or on them.
 *
 * And one that belongs to no round at all:
 *
 *   never_sent → the project has this parça (Ürün Bilgileri) and no round has
 *              ever carried it. Not a decision anybody can take yet, so no
 *              buttons — it is here because the round CANNOT be closed while it
 *              is, and a grid that showed only what was sent gave the leader no
 *              way to find that out. "Kalan Parçaları Gönderin" in the header is
 *              what acts on it.
 *
 * `signers` is the list of approver rows for this parça — the demo list shape
 * `{ by, by_name, at }` for the demo gate, the ozalit-object shape
 * `{ id, role, name, at }` for the ozalit gate. Normalised by the caller to
 * a flat array of `{ name, at }` so this row stays presentation-only.
 *
 * @param {{
 *   parca: string,
 *   status: 'pending' | 'approved' | 'rejected' | 'awaiting_receipt' | 'out' | 'never_sent',
 *   signers?: Array<{ name: string, at: string }>,
 *   busy?: boolean,
 *   onApprove?: () => void,
 *   onReject?: () => void,
 *   onReceive?: () => void,
 *   outLabel?: string,
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
  onReceive,
  outLabel = 'Matbaada',
  className,
}) {
  const isPending = status === 'pending'
  const isApproved = status === 'approved'
  const isRejected = status === 'rejected'
  const isAwaitingReceipt = status === 'awaiting_receipt'
  const isOut = status === 'out'
  const isNeverSent = status === 'never_sent'
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2',
        isPending && 'border-amber-200 bg-amber-50/40',
        isApproved && 'border-emerald-200 bg-emerald-50/30',
        isRejected && 'border-rose-200 bg-rose-50/30',
        isAwaitingReceipt && 'border-sky-200 bg-sky-50/40',
        // Somebody else's work: present, legible, visibly not yours.
        isOut && 'opacity-60',
        // Not dimmed like `out`: this one is the leader's own outstanding job,
        // and it is what is holding the round open.
        isNeverSent && 'border-dashed border-amber-300 bg-amber-50/20',
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
        {isOut && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
            <Clock className="h-3 w-3" />
            {outLabel}
          </span>
        )}
        {isNeverSent && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            <PackageX className="h-3 w-3" />
            Gönderilmedi
          </span>
        )}
        {isAwaitingReceipt && onReceive && (
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={onReceive}
            disabled={busy}
            title="Bu parçayı teslim aldığınızı onaylayın"
            aria-label={`${parca} parçasını teslim alın`}
          >
            <PackageCheck className="h-3.5 w-3.5" />
            Teslim Alın
          </Button>
        )}
        {isAwaitingReceipt && !onReceive && (
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
            <PackageCheck className="h-3 w-3" />
            Teslim bekliyor
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
  if (status === 'awaiting_receipt') {
    return <PackageCheck className="h-3.5 w-3.5 text-sky-600" strokeWidth={2.5} />
  }
  if (status === 'out') {
    return <Clock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.5} />
  }
  if (status === 'never_sent') {
    return <PackageX className="h-3.5 w-3.5 text-amber-700" strokeWidth={2.5} />
  }
  return <Hourglass className="h-3.5 w-3.5 text-amber-600" strokeWidth={2.5} />
}
