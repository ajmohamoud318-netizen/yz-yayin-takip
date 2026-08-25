import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronUp, FileText, History, ThumbsDown } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  HISTORY_FILTERS,
  TONES,
  buildTimeline,
  filterCounts,
  demoFormAttempt,
  hasDemoForm,
  hasOzalitForm,
  ozalitFormAttempt,
  rowText,
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
/*  Rows                                                               */
/* ------------------------------------------------------------------ */

/**
 * A pipeline moment: created, advanced, approved, rejected, a form sent, a
 * handover, an order step. Gets the icon disc, the rejection reason and the
 * attached-form actions.
 */
function MajorRow({
  row, index, isLast, reduce, projectType,
  onOpenDemoForm, onOpenOzalitForm,
}) {
  const { entry, meta, count, firstAt, lastAt } = row
  const Icon = meta.icon
  const tone = TONES[meta.tone] ?? TONES.neutral
  const { title, detail } = rowText(entry, meta)

  const demoForm = hasDemoForm(entry)
  const ozalitForm = hasOzalitForm(entry, projectType)

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
          <div className="flex min-w-0 items-baseline gap-1.5">
            <p className="text-sm font-semibold leading-snug text-foreground">{title}</p>
            {count > 1 && <RepeatBadge count={count} />}
          </div>
          <time
            dateTime={entry.created_at}
            className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {timeSpan(firstAt, lastAt)}
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

        {detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>}

        {entry.reason && (
          <div className="mt-2 flex items-start gap-2 rounded-md border-l-2 border-destructive/40 bg-destructive/5 py-1.5 pl-2.5 pr-3">
            <ThumbsDown className="mt-0.5 h-3 w-3 shrink-0 text-destructive/60" />
            <p className="text-xs leading-relaxed text-destructive">{entry.reason}</p>
          </div>
        )}

        {(demoForm || ozalitForm) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {demoForm && (
              <FormButton onClick={() => onOpenDemoForm?.(demoFormAttempt(entry), entry.demoAttemptAt, entry.demo_id)} icon={FileText}>
                Demo Formu
              </FormButton>
            )}
            {ozalitForm && (
              <FormButton onClick={() => onOpenOzalitForm?.(ozalitFormAttempt(entry), entry.ozalitAttemptAt, entry.demo_id)} icon={FileText}>
                Ozalit Formu
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
 *
 * `defaultOpen` is the guard against the failure this fold can cause rather
 * than cure: if every event on a day is 'minor', the run absorbs all of them
 * and the day renders as ONE grey line reading "22 küçük güncelleme" — the
 * reader is told a number and nothing else. The weights in
 * lib/project-history.js are the first line of defence (a demo negotiation is
 * not bookkeeping); this is the structural one, so no future minor-only mix
 * can swallow a day again. Still collapsible — the affordance stays, only its
 * initial state changes.
 */
function FoldedRun({ rows, total, reduce, isLast, defaultOpen = false, onOpenDemoForm, onOpenOzalitForm }) {
  const [open, setOpen] = useState(defaultOpen)
  // Distinct tones present in the run, so the summary still signals whether
  // anything in there went backwards (amber) or completed (emerald).
  const tones = [...new Set(rows.map((r) => (TONES[r.meta.tone] ?? TONES.neutral).dot))]

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
          <span className="font-mono tabular-nums">{total}</span>
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
            {rows.map((row) => (
              <MinorRow
                key={row.id}
                row={row}
                onOpenDemoForm={onOpenDemoForm}
                onOpenOzalitForm={onOpenOzalitForm}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/**
 * One bookkeeping row: a dot, a line of text, a time. Nothing more — except
 * for a "Formu Düzenleyin" edit, which otherwise leaves no way to see the
 * updated sheet: the matching "Demoya/Ozalit'e Gönderildi" major row above
 * only ever shows the form as it was FIRST sent. handleSave (SpecFormDialog)
 * stages an edit's snapshot under the round's NEXT attempt slot (the round
 * itself doesn't bump until an actual resend), so the attempt to open here is
 * entry.demoAttemptAt/ozalitAttemptAt + 1 — see the comment on `attemptNo` in
 * SpecFormDialog.jsx.
 */
function MinorRow({ row, onOpenDemoForm, onOpenOzalitForm }) {
  const { entry, entries, meta, count, firstAt, lastAt } = row
  const tone = TONES[meta.tone] ?? TONES.neutral
  const { title, detail } = rowText(entry, meta, { dense: true })
  const isDemoEdit = entry.event === 'demo_form_edited'
  const isOzalitEdit = entry.event === 'ozalit_form_edited'
  const formLabel = isDemoEdit ? 'Demo Formu' : 'Ozalit Formu'
  const openForm = (e) =>
    isDemoEdit
      ? onOpenDemoForm?.(demoFormAttempt(e), e.demoAttemptAt, e.demo_id)
      : onOpenOzalitForm?.(ozalitFormAttempt(e), e.ozalitAttemptAt, e.demo_id)
  return (
    <li className="py-1 text-[12px]">
      <div className="flex items-baseline gap-2">
        <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
        {/* Clamped, not truncated: at 390px a heading like "Ürün Bilgileri
            Otomatik Kaydedildi" needs the second line more than the badge
            beside it needs the space. */}
        <span className="line-clamp-2 min-w-0 flex-1 text-muted-foreground" title={entry.note || title}>
          {title}
        </span>
        {count > 1 && <RepeatBadge count={count} />}
        <time
          dateTime={entry.created_at}
          className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60"
        >
          {timeSpan(firstAt, lastAt)}
        </time>
      </div>
      {detail && (
        <p className="mt-0.5 line-clamp-2 pl-3.5 text-[11px] leading-relaxed text-muted-foreground/80">
          {detail}
        </p>
      )}
      {(isDemoEdit || isOzalitEdit) && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-3.5">
          {count === 1 ? (
            <FormButton onClick={() => openForm(entry)} icon={FileText}>
              {formLabel}
            </FormButton>
          ) : (
            // Merging the rows must not merge the sheets: each correction
            // writes its own snapshot (migration 052), so the row that stands
            // for five of them offers five numbered links, oldest first.
            <>
              <span className="text-[11px] text-muted-foreground/70">{formLabel}</span>
              {entries.map((e, i) => (
                <FormChip
                  key={e.id ?? i}
                  onClick={() => openForm(e)}
                  title={`${formLabel}, ${formatClock(e.created_at)}`}
                >
                  {i + 1}
                </FormChip>
              ))}
            </>
          )}
        </div>
      )}
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

function FormButton({ onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5',
        'text-[11px] font-medium text-muted-foreground',
        'transition-[color,border-color,background-color,transform] duration-150 active:translate-y-px',
        'hover:border-primary/50 hover:bg-primary/5 hover:text-primary',
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {children}
    </button>
  )
}

/** One version of a sheet on a merged row — the number, not another button. */
function FormChip({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-background px-1.5',
        'font-mono text-[11px] tabular-nums text-muted-foreground',
        'transition-[color,border-color,background-color,transform] duration-150 active:translate-y-px',
        'hover:border-primary/50 hover:bg-primary/5 hover:text-primary',
      )}
    >
      {children}
    </button>
  )
}

/**
 * "×5" on a row that stands for five identical events. The count is the whole
 * point of merging them — without it the merge would be hiding history rather
 * than summarising it.
 */
function RepeatBadge({ count }) {
  return (
    <span
      title={`${count} kez`}
      className="shrink-0 rounded-full bg-muted px-1.5 py-px font-mono text-[10px] tabular-nums text-muted-foreground"
    >
      ×{count}
    </span>
  )
}

function formatClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

/** One clock, or the span a merged row covers. Same day by construction. */
function timeSpan(firstAt, lastAt) {
  const from = formatClock(firstAt)
  const to = formatClock(lastAt)
  return from && to && from !== to ? `${from}–${to}` : to || from
}
