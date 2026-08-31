import { cn } from '@/lib/utils'

/**
 * The small shared pieces of the Geçmiş timeline — split out of
 * ProjectHistory.jsx (slice: client god-components).
 *
 * The two form affordances a row can carry, the fold's summary line, the
 * repeat badge, and the two clock formatters. Nothing here knows what a
 * history entry is; they are the vocabulary the rows are written in.
 */

export function FormButton({ onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1',
        'text-[11px] font-medium text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]',
        'transition-[color,border-color,background-color,box-shadow,transform] duration-150 active:translate-y-px',
        'hover:border-primary/40 hover:bg-primary/[0.04] hover:text-primary hover:shadow-none',
      )}
    >
      <Icon className="h-3 w-3" />
      {children}
    </button>
  )
}

/** One version of a sheet on a merged row — the number, not another button. */
export function FormChip({ onClick, title, children, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-6 min-w-6 select-none items-center justify-center rounded-md border bg-background px-1.5 font-mono text-[11px] font-medium tabular-nums',
        'transition-[color,border-color,background-color,box-shadow,transform] duration-150 active:translate-y-px',
        active
          ? 'border-primary/40 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.4)]'
          : 'border-border/70 text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]',
        'hover:border-primary/40 hover:bg-primary/[0.04] hover:text-primary hover:shadow-none',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The fold summary line. The label changes with the shape of what's inside:
 *   - no recognised bucket   → "5 yardımcı işlem" (fallback for legacy rows)
 *   - one kind of activity   → "4 alt görev"
 *   - multiple kinds         → "4 alt görev, 2 form düzenleme"
 * The breakdown already adds up to `total`, so the multi-kind line has no
 * "N olay" prefix — adding one would make the reader count twice.
 *
 * Numbers get the mono treatment so they read as a count at a glance; labels
 * stay in the prose font because they're words the reader scans, not values
 * to be parsed. A long breakdown is clamped to a single line; the reader can
 * always expand the fold to see every row.
 */
export function FoldSummary({ breakdown, total }) {
  if (breakdown.length === 0) {
    return (
      <>
        <span className="font-mono tabular-nums">{total}</span>
        <span>yardımcı işlem</span>
      </>
    )
  }
  return (
    <span className="flex min-w-0 items-baseline gap-x-1.5 truncate">
      {breakdown.map((b, i) => (
        <span key={b.label} className="inline-flex items-baseline gap-1">
          {i > 0 && <span className="opacity-50">,</span>}
          <span className="font-mono tabular-nums">{b.count}</span>
          <span>{b.label}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * "×N" on a row that stands for N identical events. The count is the whole
 * point of merging them — without it the merge would be hiding history rather
 * than summarising it.
 */
export function RepeatBadge({ count }) {
  return (
    <span
      title={`${count} kez`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-muted/80 px-1.5 py-px font-mono text-[10px] font-medium tabular-nums text-muted-foreground ring-1 ring-inset ring-border/60"
    >
      <span className="text-[9px] text-muted-foreground/70">×</span>
      {count}
    </span>
  )
}

export function formatClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

/** One clock, or the span a merged row covers. Same day by construction. */
export function timeSpan(firstAt, lastAt) {
  const from = formatClock(firstAt)
  const to = formatClock(lastAt)
  return from && to && from !== to ? `${from}–${to}` : to || from
}
