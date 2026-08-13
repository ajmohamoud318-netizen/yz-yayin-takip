import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronUp, FileText, History, ShoppingCart, ThumbsDown } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  HISTORY_FILTERS,
  TONES,
  buildTimeline,
  dedupeNote,
  filterCounts,
  hasDemoForm,
  hasOzalitForm,
  historyMeta,
  isOrderEntry,
  truncateTimeline,
} from '@/lib/project-history.js'

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
 *
 * Structure is carried by hairlines and negative space rather than nested
 * cards; the only boxed element inside the timeline is a rejection reason,
 * which earns its surface by being quoted content.
 */

const INITIAL_LIMIT = 15

function ProjectHistory({
  entries = [],
  projectType,
  orders = [],
  loading = false,
  onOpenDemoForm,
  onOpenOzalitForm,
  onOpenOrderForm,
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
                            entries={node.entries}
                            reduce={reduce}
                            isLast={i === day.nodes.length - 1}
                          />
                        ) : (
                          <MajorRow
                            key={node.id}
                            entry={node.entry}
                            meta={node.meta}
                            index={i}
                            isLast={i === day.nodes.length - 1}
                            reduce={reduce}
                            projectType={projectType}
                            orders={orders}
                            onOpenDemoForm={onOpenDemoForm}
                            onOpenOzalitForm={onOpenOzalitForm}
                            onOpenOrderForm={onOpenOrderForm}
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
/*  Rows                                                               */
/* ------------------------------------------------------------------ */

/**
 * A pipeline moment: created, advanced, approved, rejected, a form sent, a
 * handover, an order step. Gets the icon disc, the rejection reason and the
 * attached-form actions.
 */
function MajorRow({
  entry, meta, index, isLast, reduce, projectType, orders,
  onOpenDemoForm, onOpenOzalitForm, onOpenOrderForm,
}) {
  const Icon = meta.icon
  const tone = TONES[meta.tone] ?? TONES.neutral
  const note = isOrderEntry(entry) ? null : dedupeNote(entry.note, meta.label)

  const demoForm = hasDemoForm(entry)
  const ozalitForm = hasOzalitForm(entry, projectType)
  const order = isOrderEntry(entry) && orders.length > 0
    ? (entry.order_id ? orders.find((o) => o.id === entry.order_id) : orders[0])
    : null

  // Round number, shown only where it disambiguates. "Demo 2" next to a
  // rejection is the difference between reading the log and reconstructing it.
  const round = demoForm
    ? `Demo ${entry.demoAttemptAt}`
    : ozalitForm
      ? `Ozalit ${entry.ozalitAttemptAt}`
      : null

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 240, damping: 26, delay: reduce ? 0 : Math.min(index, 8) * 0.03 }}
      className="relative flex gap-3 pb-4 last:pb-0"
    >
      {!isLast && (
        <span aria-hidden="true" className="absolute bottom-0 left-[11px] top-6 w-px bg-border" />
      )}
      <span
        className={cn(
          'relative z-[1] mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-4 ring-card',
          tone.surface,
          tone.icon,
        )}
      >
        <Icon className="h-3 w-3" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold leading-snug text-foreground">{meta.label}</p>
          <time
            dateTime={entry.created_at}
            className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {formatClock(entry.created_at)}
          </time>
        </div>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          {/* Older rows predate the LEFT JOIN on done_by and have no name. */}
          <span>{entry.done_by_name ?? 'Bilinmeyen'}</span>
          {round && (
            <>
              <span className="opacity-40">·</span>
              <span className="font-mono tabular-nums">{round}</span>
            </>
          )}
        </p>

        {note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>}

        {entry.reason && (
          <div className="mt-2 flex items-start gap-2 rounded-md border-l-2 border-destructive/40 bg-destructive/5 py-1.5 pl-2.5 pr-3">
            <ThumbsDown className="mt-0.5 h-3 w-3 shrink-0 text-destructive/60" />
            <p className="text-xs leading-relaxed text-destructive">{entry.reason}</p>
          </div>
        )}

        {(demoForm || ozalitForm || order) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {demoForm && (
              <FormButton onClick={() => onOpenDemoForm?.(entry.demoAttemptAt)} icon={FileText}>
                Demo Formu
              </FormButton>
            )}
            {ozalitForm && (
              <FormButton onClick={() => onOpenOzalitForm?.(entry.ozalitAttemptAt)} icon={FileText}>
                Ozalit Formu
              </FormButton>
            )}
            {order && (
              <FormButton
                onClick={() => onOpenOrderForm?.({ order, step: entry.order_step })}
                icon={ShoppingCart}
                tone="order"
              >
                Sipariş Formu
              </FormButton>
            )}
          </div>
        )}
      </div>
    </motion.li>
  )
}

/**
 * A run of 3+ consecutive bookkeeping rows, folded into one node. Reads as a
 * single fact ("6 alt görev güncellemesi") until you ask for the detail —
 * which is how a reader treats it anyway.
 */
function FoldedRun({ entries, reduce, isLast }) {
  const [open, setOpen] = useState(false)
  // Distinct tones present in the run, so the summary still signals whether
  // anything in there went backwards (amber) or completed (emerald).
  const tones = [...new Set(entries.map((e) => (TONES[metaTone(e)] ?? TONES.neutral).dot))]

  return (
    <motion.li layout={!reduce} className="relative pb-4 last:pb-0">
      {!isLast && (
        <span aria-hidden="true" className="absolute bottom-0 left-[11px] top-6 w-px bg-border" />
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 text-left"
      >
        <span className="relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full bg-card ring-4 ring-card">
          <span className="flex items-center gap-[2px]">
            {tones.slice(0, 3).map((dot) => (
              <span key={dot} className={cn('h-[5px] w-[5px] rounded-full', dot)} />
            ))}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
          <span className="font-mono tabular-nums">{entries.length}</span>
          küçük güncelleme
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-300 [transition-timing-function:var(--ease-out)]',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden pl-9"
          >
            {entries.map((entry, i) => (
              <MinorRow key={entry.id ?? i} entry={entry} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/** One bookkeeping row: a dot, a line of text, a time. Nothing more. */
function MinorRow({ entry }) {
  const tone = TONES[metaTone(entry)] ?? TONES.neutral
  return (
    <li className="flex items-baseline gap-2 py-1 text-[12px]">
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={entry.note || undefined}>
        {entry.note || labelOf(entry)}
      </span>
      <time
        dateTime={entry.created_at}
        className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60"
      >
        {formatClock(entry.created_at)}
      </time>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/*  States                                                             */
/* ------------------------------------------------------------------ */

function EmptyState() {
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

function FilteredEmptyState({ onReset }) {
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
function HistorySkeleton() {
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

/* ------------------------------------------------------------------ */
/*  Bits                                                               */
/* ------------------------------------------------------------------ */

function FormButton({ onClick, icon: Icon, tone = 'default', children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5',
        'text-[11px] font-medium text-muted-foreground',
        'transition-[color,border-color,background-color,transform] duration-150 active:translate-y-px',
        tone === 'order'
          ? 'hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-300'
          : 'hover:border-primary/50 hover:bg-primary/5 hover:text-primary',
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {children}
    </button>
  )
}

// Local helpers — they exist only to keep the minor-row render terse.
function metaTone(entry) {
  return historyMeta(entry).tone
}

function labelOf(entry) {
  return historyMeta(entry).label
}

function formatClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}
