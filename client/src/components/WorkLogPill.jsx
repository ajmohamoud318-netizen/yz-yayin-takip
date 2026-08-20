import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Clock, CornerDownLeft, History, NotebookPen, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useWorkLog } from '@/hooks/useWorkLog.js'
import { cn } from '@/lib/utils'
import {
  MINUTE_PRESETS,
  WORK_LOG_KINDS,
  WORK_LOG_MAX_BODY,
  formatClock,
  formatDayLabel,
  formatMinutes,
  kindMeta,
} from '@/lib/work-log.js'

/**
 * Çalışma Defteri — the sidebar entry point for logging work that isn't the
 * project you're assigned to (see server migration 026__work_log.sql). It
 * lives in the sidebar's "resources" group, right under Ürün Bilgileri —
 * moved there from the header pill next to the bell so it reads as part of
 * the app's reference/records section rather than a transient alert.
 *
 * Composition notes, since a few things here are deliberate rather than
 * incidental:
 *
 *   • The trigger looks like any other nav item (icon + label + count badge)
 *     so it doesn't stand out as a different kind of control — it opens a
 *     popover instead of navigating, but visually it belongs with its
 *     neighbors.
 *   • The composer discloses progressively: category chips + writing surface
 *     first; the duration row and the Ekle button only slide in once there's
 *     text. An empty composer stays quiet instead of presenting eight
 *     controls for a sentence nobody has written yet.
 *   • Everything writes optimistically through `useWorkLog`, so the entry
 *     appears on the timeline the instant you hit ⌘↵ and rolls back visibly
 *     if the server rejects it.
 */

const MAX_ROWS_HEIGHT = 132 // ~5 lines before the textarea starts scrolling

export default function WorkLogPill({ collapsed = false }) {
  const [open, setOpen] = useState(false)
  const { today, history, loading, busy, add, remove } = useWorkLog()

  const count = today.length
  const label = 'Çalışma Defteri'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {collapsed ? (
          <button
            type="button"
            aria-label={count ? `${label}, bugün ${count} kayıt` : `${label}, bugün kayıt yok`}
            title={label}
            className={cn(
              'relative flex h-9 w-full items-center justify-center rounded-md transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-primary/10 data-[state=open]:text-primary',
            )}
          >
            <NotebookPen className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={count ? `${label}, bugün ${count} kayıt` : `${label}, bugün kayıt yok`}
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-primary/10 data-[state=open]:text-primary',
            )}
          >
            <NotebookPen className="h-5 w-5" />
            <span className="flex-1">{label}</span>
            {count > 0 && (
              <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground group-data-[state=open]:bg-primary/15 group-data-[state=open]:text-primary">
                {count}
              </span>
            )}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0"
      >
        <WorkLogPanel
          today={today}
          history={history}
          loading={loading}
          busy={busy}
          onAdd={add}
          onRemove={remove}
        />
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

function WorkLogPanel({ today, history, loading, busy, onAdd, onRemove }) {
  const [kind, setKind] = useState('baska_proje')
  const [text, setText] = useState('')
  const [minutes, setMinutes] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const textareaRef = useRef(null)

  const meta = kindMeta(kind)
  const trimmed = text.trim()
  const canSave = trimmed.length > 0 && !busy

  // Focus the writing surface on open rather than the first category chip,
  // which is what Radix would pick. Typing is the primary action here.
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 40)
    return () => clearTimeout(t)
  }, [])

  // Auto-grow: reset to 0 first so the box can also SHRINK when text is
  // deleted, then clamp to MAX_ROWS_HEIGHT and let it scroll past that.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_HEIGHT)}px`
  }, [text])

  const submit = useCallback(async () => {
    if (!trimmed || busy) return
    try {
      await onAdd({ kind, body: trimmed, minutes })
      setText('')
      setMinutes(null)
      textareaRef.current?.focus()
    } catch (err) {
      toast.error(err?.message || 'Kayıt eklenemedi.')
    }
  }, [busy, kind, minutes, onAdd, trimmed])

  function handleKeyDown(e) {
    // ⌘↵ / Ctrl+↵ saves. Plain Enter stays a newline — these notes are often
    // two lines, and losing the second one to a stray Enter is worse than
    // asking for a modifier.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  const totalMinutes = today.reduce((sum, e) => sum + (e.minutes || 0), 0)

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="label-eyebrow">Çalışma Defteri</p>
          <h3 className="mt-0.5 text-base leading-tight">Bugün ne yaptın?</h3>
        </div>
        <span className="shrink-0 pt-0.5 text-right text-[11px] leading-tight text-muted-foreground">
          {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })}
          <br />
          {new Date().toLocaleDateString('tr-TR', { weekday: 'long' })}
        </span>
      </header>

      {/* ── Composer ───────────────────────────────────────────── */}
      <div className="border-b bg-muted/30 px-3 py-3">
        <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2.5">
          {WORK_LOG_KINDS.map((k) => {
            const Icon = k.icon
            const selected = k.value === kind
            return (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                aria-pressed={selected}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1',
                  'transition-[background-color,color,box-shadow,transform] duration-150 [transition-timing-function:var(--ease-out)]',
                  'active:scale-[0.96]',
                  selected ? k.active : 'bg-transparent text-muted-foreground ring-border hover:bg-background',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {k.short}
              </button>
            )
          })}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value.slice(0, WORK_LOG_MAX_BODY))}
          onKeyDown={handleKeyDown}
          placeholder={meta.placeholder}
          className={cn(
            'block w-full resize-none rounded-md border border-transparent bg-background px-2.5 py-2 text-sm leading-relaxed',
            'placeholder:text-muted-foreground/70 focus:border-input focus:outline-none focus:ring-2 focus:ring-ring/30',
            'transition-[border-color,box-shadow] duration-150',
          )}
        />

        {/* Duration + save appear only once there's something to save. The
            grid-rows 0fr→1fr trick animates an auto height without JS. */}
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-300 [transition-timing-function:var(--ease-out)]',
            trimmed ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="scrollbar-none -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">
                <span className="flex shrink-0 items-center gap-1 pr-0.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                </span>
                {MINUTE_PRESETS.map((p) => (
                  <button
                    key={p.minutes}
                    type="button"
                    // Tapping the active preset clears it — no separate
                    // "no duration" control needed.
                    onClick={() => setMinutes((m) => (m === p.minutes ? null : p.minutes))}
                    aria-pressed={minutes === p.minutes}
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 transition-colors duration-150',
                      minutes === p.minutes
                        ? 'bg-foreground text-background ring-foreground'
                        : 'text-muted-foreground ring-border hover:bg-background',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <CharCounter value={trimmed.length} max={WORK_LOG_MAX_BODY} />

              <Button size="sm" className="h-7 shrink-0 gap-1.5 px-2.5" disabled={!canSave} onClick={submit}>
                {busy ? 'Ekleniyor…' : 'Ekleyin'}
                <CornerDownLeft className="h-3 w-3 opacity-70" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Today + history ────────────────────────────────────── */}
      <div className="scrollbar-thin max-h-[min(24rem,50vh)] overflow-y-auto">
        <section className="px-4 py-3">
          <div className="flex items-baseline justify-between">
            <p className="label-eyebrow">Bugün</p>
            {today.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {today.length} kayıt
                {totalMinutes > 0 && ` · ${formatMinutes(totalMinutes)}`}
              </p>
            )}
          </div>

          {loading ? (
            <div className="mt-3 space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : today.length === 0 ? (
            <p className="mt-2.5 rounded-md border border-dashed px-3 py-3 text-center text-[12px] leading-relaxed text-muted-foreground">
              Bugün için kayıt yok.
              <br />
              Yukarıya yaz, <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd> ile ekle.
            </p>
          ) : (
            <Timeline entries={today} onRemove={onRemove} />
          )}
        </section>

        {history.length > 0 && (
          <section className="border-t">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <History className="h-3.5 w-3.5" />
              Geçmiş kayıtlar
              <span className="ml-auto flex items-center gap-1">
                {history.reduce((n, d) => n + d.entries.length, 0)}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-300 [transition-timing-function:var(--ease-out)]',
                    showHistory && 'rotate-180',
                  )}
                />
              </span>
            </button>

            {showHistory && (
              <div className="space-y-3 px-4 pb-3">
                {history.map((day) => (
                  <div key={day.date}>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {formatDayLabel(day.date)}
                    </p>
                    <Timeline entries={day.entries} readOnly />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Timeline                                                           */
/* ------------------------------------------------------------------ */

/**
 * A single vertical rule with a coloured dot per entry. The rule is inset
 * from the top and bottom of the first/last dot so it reads as a spine
 * connecting them rather than a stray border running off the edges.
 */
function Timeline({ entries, onRemove, readOnly = false }) {
  const [removing, setRemoving] = useState(null)

  async function handleRemove(entry) {
    setRemoving(entry.id)
    try {
      await onRemove(entry.id)
    } catch (err) {
      toast.error(err?.message || 'Kayıt silinemedi.')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <ol className="relative mt-2 space-y-0.5">
      <span
        aria-hidden="true"
        className="absolute bottom-3 left-[6px] top-3 w-px bg-border"
      />
      {entries.map((entry) => {
        const meta = kindMeta(entry.kind)
        const duration = formatMinutes(entry.minutes)
        const isRemoving = removing === entry.id
        return (
          <li
            key={entry.id}
            className={cn(
              'worklog-row group relative flex items-start gap-2.5 rounded-md py-1.5 pl-0 pr-1 transition-[opacity,background-color] duration-200',
              !readOnly && 'hover:bg-muted/60',
              (entry.pending || isRemoving) && 'opacity-50',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'relative z-[1] mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full ring-2 ring-popover',
                meta.dot,
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-foreground">{entry.body}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className={cn('rounded px-1 py-px font-medium ring-1', meta.chip)}>
                  {meta.short}
                </span>
                {duration && <span>{duration}</span>}
                <span className="tabular-nums opacity-70">{formatClock(entry.created_at)}</span>
              </p>
            </div>

            {/* Destructive action stays hidden until intent (hover / keyboard
                focus) so a read-through of the day isn't a row of bins. */}
            {!readOnly && !entry.pending && (
              <button
                type="button"
                onClick={() => handleRemove(entry)}
                disabled={isRemoving}
                aria-label="Kaydı silin"
                className={cn(
                  'mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0',
                  'transition-[opacity,color,background-color] duration-150',
                  'hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100',
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ */
/*  Bits                                                               */
/* ------------------------------------------------------------------ */

/**
 * Radial character counter. Silent until 60% of the budget is used, then
 * fades in — a number that's always visible reads as a limit you're being
 * policed against; one that appears as you approach it reads as help.
 */
function CharCounter({ value, max }) {
  const pct = Math.min(1, value / max)
  const show = pct >= 0.6
  const R = 7
  const C = 2 * Math.PI * R
  const tone = pct >= 0.95 ? 'text-destructive' : pct >= 0.85 ? 'text-amber-600' : 'text-muted-foreground'
  return (
    <span
      className={cn('shrink-0 transition-opacity duration-300', show ? 'opacity-100' : 'opacity-0')}
      title={`${value}/${max}`}
      aria-hidden={!show}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" className={tone}>
        <circle cx="9" cy="9" r={R} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.18" />
        <circle
          cx="9"
          cy="9"
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          transform="rotate(-90 9 9)"
          style={{ transition: 'stroke-dashoffset 200ms var(--ease-out)' }}
        />
      </svg>
    </span>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="mx-px inline-grid h-[17px] min-w-[17px] place-items-center rounded border border-border bg-background px-1 align-middle font-sans text-[10px] text-foreground">
      {children}
    </kbd>
  )
}
