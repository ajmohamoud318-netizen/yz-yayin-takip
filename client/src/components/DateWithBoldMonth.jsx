import { formatDateTrParts } from '@/lib/utils'

/** Renders a tr-TR calendar date with the month name in bold. */
export default function DateWithBoldMonth({ iso, options }) {
  const parts = formatDateTrParts(iso, options)
  if (!parts.length) return '—'
  return parts.map((part, i) => (
    part.type === 'month'
      ? <span key={i} className="font-bold">{part.value}</span>
      : part.value
  ))
}
