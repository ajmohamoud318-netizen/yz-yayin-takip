import { Package } from 'lucide-react'
import { ORDER_STEP_LABELS } from '@/api'
import { orderLabel } from '@/domain/constants/orders'
import { cn } from '@/lib/utils'

/**
 * Small marker shown on a project row/bar that has open siparişler — every
 * one of them, oldest first (see useOpenOrdersByProject).
 *
 * Past one order it carries a count. The tooltip naming each order does not
 * exist on a phone, which is where the team works, so the number beside the
 * icon is the only thing that says a second reprint is in flight.
 *
 * `className` styles the wrapper (colour, margins); `iconClassName` sizes the
 * icon. The count inherits the wrapper's colour.
 */
export default function OrderBadge({ orders, className, iconClassName = 'h-3.5 w-3.5' }) {
  if (!orders?.length) return null
  const title = orders
    .map((o) => `${orderLabel(o)}: ${ORDER_STEP_LABELS[o.status] ?? o.status}`)
    .join('\n')
  return (
    <span
      role="img"
      aria-label={orders.length > 1 ? `${orders.length} baskı bekliyor` : 'Baskı bekliyor'}
      title={title}
      className={cn('inline-flex shrink-0 items-center gap-0.5 text-amber-600', className)}
    >
      <Package className={iconClassName} aria-hidden="true" />
      {orders.length > 1 && (
        <span className="text-[10px] font-semibold leading-none tabular-nums">{orders.length}</span>
      )}
    </span>
  )
}
