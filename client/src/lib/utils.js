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

/**
 * Format the project's target date for display.
 * `target_month` historically held a YYYY-MM-01 string (month-only precision).
 * After the 2026-07 update it can hold a full YYYY-MM-DD. We keep the visual
 * output backward-compatible: dates that still snap to the 1st render as
 * "Haziran 2026", anything else renders as "15 Haziran 2026".
 */
export function formatTargetDate(iso) {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  if (d.getDate() === 1) {
    return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
  }
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** "AY" suffix for card initials etc. */
export function initials(name = '') {
  // Null-safe — the server's list endpoint can return `assigned_name: null`
  // for unassigned projects or when the join is incomplete. Without this
  // guard the entire dashboard throws `Cannot read properties of null`.
  if (!name) return ''
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
