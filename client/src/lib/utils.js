import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind class names with conflict-aware deduplication. */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/** Format an ISO date as `15 Haziran 2026` (tr-TR). */
export function formatDateTr(iso, opts = {}) {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  return d.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...opts,
  })
}

/** Format an ISO date as `Haziran 2026` (tr-TR). */
export function formatMonthYear(iso) {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
}

/** First day of a month N months from today, as YYYY-MM-DD. */
export function monthOffset(n) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** "AY" suffix for card initials etc. */
export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
