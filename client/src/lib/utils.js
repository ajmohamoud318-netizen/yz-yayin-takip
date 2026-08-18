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

/**
 * Format a number (or numeric string) with tr-TR thousands separators —
 * `1000` → "1.000", `2500.5` → "2.500,5". Returns '' for null/undefined/''/NaN
 * so it's safe to use directly on optional fields; use this everywhere a
 * numeric value (adet, count, total…) is displayed to a user.
 */
export function formatNumber(value, { maxDecimals = 2 } = {}) {
  if (value === null || value === undefined || value === '') return ''
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (Number.isNaN(n)) return ''
  return n.toLocaleString('tr-TR', { maximumFractionDigits: maxDecimals })
}

/** Strip a typed value down to plain digits — for masked integer inputs like order quantities. */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * Like `digitsOnly` but keeps a single decimal separator (typed as either
 * "," or "."), for masked inputs that allow fractional values.
 */
export function decimalDigitsOnly(value) {
  const s = String(value ?? '').replace(/[^\d.,]/g, '').replace(',', '.')
  const firstDot = s.indexOf('.')
  if (firstDot === -1) return s
  return s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
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
