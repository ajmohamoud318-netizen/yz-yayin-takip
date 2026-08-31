import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, FileText, ThumbsDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  TONES,
  demoFormAttempt,
  foldBreakdown,
  hasDemoForm,
  hasOzalitForm,
  ozalitFormAttempt,
  rowText,
} from '@/lib/project-history.js'
import {
  FoldSummary,
  FormButton,
  FormChip,
  RepeatBadge,
  formatClock,
  timeSpan,
} from '@/components/ProjectHistoryBits'

/**
 * The three kinds of node a Geçmiş day can hold — split out of
 * ProjectHistory.jsx (slice: client god-components).
 *
 * The weight pass of the redesign lives here: a pipeline moment renders
 * full-width with its rejection reason and attached forms (MajorRow), a
 * bookkeeping row collapses to a single line (MinorRow), and a run of 3+ of
 * those folds behind one summary node (FoldedRun). The shell owns the
 * timeline, the filters and the day headings; these own how a row reads.
 */

/**
 * A pipeline moment: created, advanced, approved, rejected, a form sent, a
 * handover, an order step. Gets the icon disc, the rejection reason and the
 * attached-form actions.
 */
export function MajorRow({
  row, index, isLast, reduce, projectType,
  onOpenDemoForm, onOpenOzalitForm,
}) {
  const { entry, meta, count, firstAt, lastAt } = row
  const Icon = meta.icon
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
      className="relative flex gap-3.5 pb-5 pl-1 last:pb-0"
    >
      {!isLast && (
        // Spine passes through the disc's vertical centre, so a row above and
        // a row below read as one continuous timeline. top-5 lands the start at
        // the disc's mid-line; bottom-0 lets the next disc's mid-line close it.
        <span aria-hidden="true" className="absolute bottom-0 left-[20px] top-5 w-px bg-border" />
      )}
      <span
        className={cn(
          'relative z-[1] mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-foreground/80 ring-1 ring-inset ring-border/80',
        )}
        style={meta.tone === 'negative' ? { background: 'hsl(var(--destructive) / 0.12)', color: 'hsl(var(--destructive))' } : undefined}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <p className="truncate text-[15px] font-semibold leading-snug text-foreground">{title}</p>
            {count > 1 && <RepeatBadge count={count} />}
          </div>
          <time
            dateTime={entry.created_at}
            className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground"
          >
            {timeSpan(firstAt, lastAt)}
          </time>
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug text-muted-foreground">
          {/* Older rows predate the LEFT JOIN on done_by and have no name. */}
          <span className="truncate">{entry.done_by_name ?? 'Bilinmeyen'}</span>
          {round && (
            <>
              <span className="opacity-40">·</span>
              <span className="font-mono text-[12px] tabular-nums">{round}</span>
            </>
          )}
        </p>

        {detail && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground/90">{detail}</p>}

        {entry.reason && (
          <div className="mt-2 flex items-start gap-2 rounded-md border-l-2 border-destructive/40 bg-destructive/5 py-1.5 pl-2.5 pr-3">
            <ThumbsDown className="mt-0.5 h-3 w-3 shrink-0 text-destructive/60" />
            <p className="text-xs leading-relaxed text-destructive">{entry.reason}</p>
          </div>
        )}

        {(demoForm || ozalitForm) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
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
 * A run of 3+ consecutive bookkeeping rows, folded into one node. The summary
 * line lists the bucket each row belongs to — "4 alt görev, 2 form düzenleme"
 * — so the reader sees what kind of activity is hidden before opening the
 * fold. A single-kind fold reads as just "4 alt görev".
 *
 * `defaultOpen` is the guard against the failure this fold can cause rather
 * than cure: if every event on a day is 'minor', the run absorbs all of them
 * and the day renders as ONE summary line and nothing else. The weights in
 * lib/project-history.js are the first line of defence (a demo negotiation
 * is not bookkeeping); this is the structural one, so no future minor-only
 * mix can swallow a day again. Still collapsible — the affordance stays,
 * only its initial state changes.
 */
export function FoldedRun({ rows, total, reduce, isLast, defaultOpen = false, onOpenDemoForm, onOpenOzalitForm }) {
  const [open, setOpen] = useState(defaultOpen)
  // Distinct tones present in the run, so the summary still signals whether
  // anything in there went backwards (amber) or completed (emerald).
  const tones = [...new Set(rows.map((r) => (TONES[r.meta.tone] ?? TONES.neutral).dot))]
  const breakdown = foldBreakdown(rows)

  return (
    <motion.li layout={!reduce} className="relative pb-4 last:pb-0">
      {!isLast && (
        <span aria-hidden="true" className="absolute bottom-0 left-[11px] top-6 w-px bg-border" />
      )}
      {/* Same one-line shape as any minor row — the fold is a regular line of
          the timeline, not a separate surface. A reader scrolling the Geçmiş
          treats it as another fact, not as a menu of an N-row list. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={
          breakdown.length === 0
            ? `${total} yardımcı işlem, ${open ? 'daralt' : 'genişlet'}`
            : breakdown.map((b) => `${b.count} ${b.label}`).join(', ')
        }
        className="group flex w-full items-center gap-3 text-left"
      >
        <span className="relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full bg-card ring-4 ring-card">
          <span className="flex items-center gap-[2px]">
            {tones.slice(0, 3).map((dot) => (
              <span key={dot} className={cn('h-[5px] w-[5px] rounded-full', dot)} />
            ))}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
          <FoldSummary breakdown={breakdown} total={total} />
          <ChevronDown
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-300 [transition-timing-function:var(--ease-out)]',
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
            {rows.map((row, i) => (
              <MinorRow
                key={row.id}
                row={row}
                isLast={i === rows.length - 1}
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
function MinorRow({ row, isLast, onOpenDemoForm, onOpenOzalitForm }) {
  const { entry, entries, meta, count, firstAt, lastAt } = row
  const tone = TONES[meta.tone] ?? TONES.neutral
  const Icon = meta.icon
  const { title, detail } = rowText(entry, meta, { dense: true })
  const isDemoEdit = entry.event === 'demo_form_edited'
  const isOzalitEdit = entry.event === 'ozalit_form_edited'
  const formLabel = isDemoEdit ? 'Demo Formu' : 'Ozalit Formu'
  const openForm = (e) =>
    isDemoEdit
      ? onOpenDemoForm?.(demoFormAttempt(e), e.demoAttemptAt, e.demo_id)
      : onOpenOzalitForm?.(ozalitFormAttempt(e), e.ozalitAttemptAt, e.demo_id)
  return (
    <li className="group/row relative py-1.5 first:pt-1 last:pb-1">
      {/* Spine that runs THROUGH this row — the parent <ul> starts above with
          a half-circle cap, this row's icon sits on top, and a half-pixel
          segment continues down to the next row. A single absolute line can't
          know where the last dot sits, so the spine is drawn per row. */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[7px] top-[18px] w-px bg-border/70 group-hover/row:bg-border"
        />
      )}
      <div className="flex items-baseline gap-2.5">
        <span
          className={cn(
            'mt-0.5 grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-card ring-1 ring-inset',
            tone.dot,
            tone.dot === 'bg-foreground/70'
              ? 'ring-foreground/15'
              : tone.dot === 'bg-muted-foreground/50'
                ? 'ring-muted-foreground/15'
                : tone.dot === 'bg-destructive'
                  ? 'ring-destructive/30'
                  : tone.dot === 'bg-amber-500'
                    ? 'ring-amber-500/25'
                    : tone.dot === 'bg-violet-500'
                      ? 'ring-violet-500/25'
                      : 'ring-emerald-600/25',
          )}
        >
          {/* Inner glyph — checks for the "completed" rows so the dot reads
              as "done", not as a status waiting on the reader. Plain disc for
              non-completion tones. */}
          {(meta.tone === 'positive' && count === 1) ? (
            <Icon className="h-2 w-2 text-white" strokeWidth={3.5} />
          ) : null}
        </span>
        {/* Clamped, not truncated: at 390px a heading like "Ürün Bilgileri
            Otomatik Kaydedildi" needs the second line more than the badge
            beside it needs the space. */}
        <span
          className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-snug text-foreground/85"
          title={entry.note || title}
        >
          {title}
        </span>
        {count > 1 && <RepeatBadge count={count} />}
        <time
          dateTime={entry.created_at}
          className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70"
        >
          {timeSpan(firstAt, lastAt)}
        </time>
      </div>
      {detail && (
        <p className="mt-0.5 line-clamp-2 pl-[26px] text-[11px] leading-relaxed text-muted-foreground/80">
          {detail}
        </p>
      )}
      {(isDemoEdit || isOzalitEdit) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
          {count === 1 ? (
            <FormButton onClick={() => openForm(entry)} icon={FileText}>
              {formLabel}
            </FormButton>
          ) : (
            // Merging the rows must not merge the sheets: each correction
            // writes its own snapshot (migration 052), so the row that stands
            // for five of them offers five numbered links, oldest first.
            <>
              <span className="text-[11px] font-medium text-muted-foreground/80">{formLabel}</span>
              <span
                aria-hidden="true"
                className="flex items-center gap-1 rounded-md border border-border/70 bg-background px-1.5 py-0.5 shadow-[0_1px_0_hsl(var(--border))]"
              >
                {entries.map((e, i) => (
                  <FormChip
                    key={e.id ?? i}
                    onClick={() => openForm(e)}
                    title={`${formLabel}, ${formatClock(e.created_at)}`}
                    active={i === entries.length - 1}
                  >
                    {i + 1}
                  </FormChip>
                ))}
              </span>
            </>
          )}
        </div>
      )}
    </li>
  )
}
