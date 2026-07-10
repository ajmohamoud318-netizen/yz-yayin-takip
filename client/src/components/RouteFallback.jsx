/**
 * Page-transition fallback — reads as intentional loading, not a broken screen.
 * Mirrors the page's own shape (eyebrow + h1 + content block) so the swap
 * from skeleton to real content doesn't shift the layout. Rendered inside
 * the AppShell (so the sidebar + topbar stay visible during the lazy load).
 *
 * Extracted to its own module so AppShell and App.jsx can both import it
 * without a circular import.
 */
export default function RouteFallback() {
  return (
    <div
      className="mx-auto max-w-7xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 lg:px-8"
      role="status"
      aria-live="polite"
      aria-label="Sayfa yükleniyor"
    >
      {/* Eyebrow + h1 — same shape as the real pages so the swap is invisible */}
      <div className="space-y-2">
        <div className="h-2.5 w-24 animate-pulse rounded-full bg-muted/50" />
        <div className="h-7 w-44 animate-pulse rounded-md bg-muted/60" />
        <div className="h-3.5 w-64 animate-pulse rounded-md bg-muted/40" />
      </div>
      {/* Content block — a single full-width card, not 3 identical stacked
          bars (which read as "the app is broken"). The card has the
          rose-soft top hint that the dashboard uses to mark "current". */}
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <div className="h-1 w-full bg-primary/10" />
        <div className="space-y-3 p-5">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted/50" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
        </div>
      </div>
    </div>
  )
}
