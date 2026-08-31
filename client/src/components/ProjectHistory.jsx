import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronUp, History } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  HISTORY_FILTERS,
  buildTimeline,
  filterCounts,
  truncateTimeline,
} from '@/lib/project-history.js'
import { FoldedRun, MajorRow } from '@/components/ProjectHistoryRows'
import { EmptyState, FilteredEmptyState, HistorySkeleton } from '@/components/ProjectHistoryStates'

/**
 * Project history ("Geçmiş").
 *
 * What this replaces: a flat, unfiltered, un-grouped list where a ticked
 * subtask carried exactly the same visual weight as a rejected ozalit,
 * painted in eight competing pastel rings that existed in no design token.
 * On a project with real traffic the one entry you opened the page to find
 * was buried under forty checkbox events.
 *
 * The redesign applies hierarchy in three passes:
 *
 *   1. TONE     — six semantic roles instead of eight decorative hues
 *                 (lib/project-history.js). A colour now means something.
 *   2. WEIGHT   — pipeline moments render full-width with their rejection
 *                 reason and attached forms; bookkeeping rows collapse to a
 *                 single line, and runs of 3+ fold behind one summary node.
 *   3. GROUPING — sticky day headings and filter chips with live counts, so
 *                 a chip can never lead you to an empty list.
 *   4. REPEATS  — consecutive rows that say exactly the same thing merge into
 *                 one row carrying a ×N badge and the clock span it covers
 *                 (buildTimeline). Correcting a demo sheet seven times used
 *                 to print seven identical headings; it now prints one, with
 *                 a numbered link per version so no snapshot is lost.
 *
 * Structure is carried by hairlines and negative space rather than nested
 * cards; the only boxed element inside the timeline is a rejection reason,
 * which earns its surface by being quoted content.
 */

const INITIAL_LIMIT = 15

function ProjectHistory({
  entries = [],
  projectType,
  loading = false,
  onOpenDemoForm,
  onOpenOzalitForm,
}) {
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(false)
  const reduce = useReducedMotion()

  const counts = useMemo(() => filterCounts(entries), [entries])
  const days = useMemo(() => buildTimeline(entries, filter), [entries, filter])
  const { days: visibleDays, hidden } = useMemo(
    () => (expanded ? { days, hidden: 0 } : truncateTimeline(days, INITIAL_LIMIT)),
    [days, expanded],
  )

  const isEmpty = entries.length === 0
  const isFilteredEmpty = !isEmpty && days.length === 0

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="gap-3 pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Geçmiş
          </CardTitle>
          {!isEmpty && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {counts.all} kayıt
            </span>
          )}
        </div>

        {/* Filters are hidden below ~6 rows: a chip row over a five-item list
            is more chrome than the content it filters. */}
        {counts.all > 6 && (
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {HISTORY_FILTERS.map((f) => {
              const n = counts[f.value]
              const active = filter === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => { setFilter(f.value); setExpanded(false) }}
                  aria-pressed={active}
                  // A filter that would show nothing is disabled rather than
                  // hidden — a chip row that changes shape as you click it is
                  // disorienting, and the greyed count explains the absence.
                  disabled={n === 0}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1',
                    'transition-[background-color,color,box-shadow,transform] duration-150 [transition-timing-function:var(--ease-out)]',
                    'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
                    active
                      ? 'bg-foreground text-background ring-foreground'
                      : 'text-muted-foreground ring-border hover:bg-muted hover:text-foreground',
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      'font-mono text-[10px] tabular-nums',
                      active ? 'text-background/70' : 'text-muted-foreground/70',
                    )}
                  >
                    {n}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        {loading ? (
          <HistorySkeleton />
        ) : isEmpty ? (
          <EmptyState />
        ) : isFilteredEmpty ? (
          <FilteredEmptyState onReset={() => setFilter('all')} />
        ) : (
          <>
            {/* Above the list, not below it: the hidden rows are the OLDEST
                ones now, and they live off the top of a chronological
                timeline. Pointing the chevron up says which way they are. */}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className={cn(
                  'mb-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2',
                  'text-[12px] text-muted-foreground transition-colors duration-150',
                  'hover:border-solid hover:bg-muted hover:text-foreground active:scale-[0.995]',
                )}
              >
                <ChevronUp className="h-3.5 w-3.5" />
                <span className="font-mono tabular-nums">{hidden}</span> önceki kayıt
              </button>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={filter}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-5"
              >
                {visibleDays.map((day) => (
                  <section key={day.key}>
                    {/* Sticky so the date stays with you while you read a
                        long day. Offset by the app header's full height —
                        3.5rem *plus* the safe-area inset it carries, or the
                        chip parks under the topbar on a notched iPhone — and
                        painted `bg-card` to match the panel, not the page. */}
                    <div className="sticky top-[calc(3.5rem+var(--safe-top,0px))] z-10 -mx-1 flex items-center gap-2.5 bg-card px-1 py-1.5">
                      <h4 className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {day.label}
                      </h4>
                      <span className="h-px flex-1 bg-border" />
                    </div>

                    {/* The spine is drawn per row rather than once per <ol>:
                        a single absolutely-positioned line can only guess where
                        the last dot sits, and `bottom-3` guessed wrong — it ran
                        past the final icon into empty space, leaving a stub
                        under every day (and a stub connecting nothing at all on
                        a day with one entry). Segments know their own end. */}
                    <ol className="relative mt-1">
                      {day.nodes.map((node, i) =>
                        node.type === 'run' ? (
                          <FoldedRun
                            key={node.id}
                            rows={node.rows}
                            total={node.total}
                            reduce={reduce}
                            isLast={i === day.nodes.length - 1}
                            // A run is allowed to hide rows from a day; it is
                            // not allowed to BE the day. When nothing else
                            // happened, the fold is the whole content and a
                            // collapsed one is a dead end — open it.
                            defaultOpen={day.nodes.length === 1}
                            onOpenDemoForm={onOpenDemoForm}
                            onOpenOzalitForm={onOpenOzalitForm}
                          />
                        ) : (
                          <MajorRow
                            key={node.id}
                            row={node}
                            index={i}
                            isLast={i === day.nodes.length - 1}
                            reduce={reduce}
                            projectType={projectType}
                            onOpenDemoForm={onOpenDemoForm}
                            onOpenOzalitForm={onOpenOzalitForm}
                          />
                        ),
                      )}
                    </ol>
                  </section>
                ))}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default memo(ProjectHistory)

/* ------------------------------------------------------------------ */
/*  Sibling files (slice: client god-components)                      */
/* ------------------------------------------------------------------ */
/**
 * The rows, the states and their shared vocabulary moved out of this file:
 *
 *  - `ProjectHistoryRows.jsx`   — MajorRow / FoldedRun / MinorRow
 *  - `ProjectHistoryStates.jsx` — empty, filtered-empty, skeleton
 *  - `ProjectHistoryBits.jsx`   — form button/chip, fold summary, ×N badge,
 *                                 clock formatters
 *
 * What stays here is the panel itself: the filter chips and their live
 * counts, the truncation, and the day sections the rows hang off.
 */
