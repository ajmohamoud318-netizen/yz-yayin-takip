import { Search } from 'lucide-react'

/**
 * Pill-shaped button that opens the command palette. Visually looks like a
 * search input (rounded, muted background, leading icon) so it reads as the
 * same affordance as the magnifier glass on every other app, but it never
 * actually accepts input — that's the palette's job. Clicking anywhere on
 * the pill (or its keyboard hint chip) opens it.
 */
export default function TopbarSearch({ onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full max-w-sm items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Ara…</span>
      {/* Keyboard hint chip — shows ⌘K on macOS, Ctrl K elsewhere. The hint
          is part of the affordance, not a tooltip: it teaches the shortcut
          while signalling this is a real command palette, not a search box. */}
      <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
        {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}K
      </kbd>
    </button>
  )
}