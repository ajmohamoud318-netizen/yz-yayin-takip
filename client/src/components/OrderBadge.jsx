import { Package } from 'lucide-react'
import { ORDER_STEP_LABELS } from '@/api'

/** Small marker shown on a project row/bar that has an open sipariş. */
export default function OrderBadge({ order, className = 'h-3.5 w-3.5 text-amber-600' }) {
  if (!order) return null
  return (
    <Package
      className={className}
      aria-label="Sipariş bekliyor"
      title={`Sipariş: ${ORDER_STEP_LABELS[order.status] ?? order.status}`}
    />
  )
}
