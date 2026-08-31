/**
 * The three no-timeline states of Geçmiş — split out of ProjectHistory.jsx
 * (slice: client god-components): nothing has happened yet, the filter
 * matches nothing, and the panel is still loading.
 */

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-10 text-center">
      {/* A quiet, drawn stand-in for the timeline this panel will hold —
          three dots on a spine. Cheaper to read than an icon in a circle. */}
      <svg width="44" height="34" viewBox="0 0 44 34" aria-hidden="true" className="text-muted-foreground/30">
        <line x1="6" y1="4" x2="6" y2="30" stroke="currentColor" strokeWidth="1" />
        <circle cx="6" cy="7" r="3" fill="currentColor" />
        <circle cx="6" cy="17" r="3" fill="currentColor" />
        <circle cx="6" cy="27" r="3" fill="currentColor" />
        <rect x="15" y="4" width="26" height="4" rx="2" fill="currentColor" opacity="0.6" />
        <rect x="15" y="14" width="20" height="4" rx="2" fill="currentColor" opacity="0.6" />
        <rect x="15" y="24" width="24" height="4" rx="2" fill="currentColor" opacity="0.6" />
      </svg>
      <p className="text-sm font-medium text-foreground">Henüz hareket yok</p>
      <p className="max-w-[34ch] text-xs leading-relaxed text-muted-foreground">
        Alt görevler işaretlendikçe ve proje aşama atladıkça her adım buraya
        kaydedilir.
      </p>
    </div>
  )
}

export function FilteredEmptyState({ onReset }) {
  return (
    <div className="rounded-md border border-dashed px-6 py-8 text-center">
      <p className="text-xs text-muted-foreground">Bu filtreye uygun kayıt yok.</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        Tümünü göster
      </button>
    </div>
  )
}

/** Skeleton mirrors the real row geometry — disc, two text lines, a time. */
export function HistorySkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <span className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5 pt-1">
            <span className="block h-3 animate-pulse rounded bg-muted" style={{ width: `${58 - i * 9}%` }} />
            <span className="block h-2.5 w-24 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  )
}
