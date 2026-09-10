import { orderLabel } from '@/domain/constants/orders'
import { cn } from '@/lib/utils'

/**
 * "Sipariş #2" — which of its book's orders a card is about (migration 083).
 * Two live orders on one title otherwise share every word on the card.
 *
 * A span, not the Badge primitive (a div), so it can sit inside the `<p>` meta
 * line under a title. That line is where it goes: beside the title it would
 * squeeze the book name on a phone.
 */
export default function OrderNoBadge({ order, className }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-violet-200 bg-violet-50 px-1.5 py-px align-middle text-[10px] font-semibold leading-4 text-violet-700',
        className,
      )}
    >
      {orderLabel(order)}
    </span>
  )
}
