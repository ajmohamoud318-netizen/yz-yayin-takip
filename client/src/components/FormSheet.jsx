import { useLayoutEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The on-screen spec form — the same document the printer produces
 * (lib/specPrint.js), rendered live so what a user edits and what comes out
 * of the printer are recognisably one form.
 *
 * Shared by the Demo / Ozalit / Baskı Onay dialogs (SpecFormDialog), the
 * order-side Baskı Onay Formu (SiparisBaskiOnayFormDialog) and the Dökümanlar
 * preview. Every row sits on ONE grid, so each colon on the sheet lines up and
 * the value column reads as a real column with a rule down it — that grid is
 * what makes this look like a form rather than a list of inputs.
 *
 * The label column fits HAZIRLAYAN / BASIM YERİ at 390px and wraps rather than
 * truncating: this app is used on phones first.
 */
export const SHEET_ROW = 'grid grid-cols-[minmax(5.5rem,36%)_auto_1fr] items-start border-b last:border-b-0'
/**
 * The same row with a trailing column for the edit controls (move / remove).
 * The first three tracks are identical, so the label column and the colon —
 * and with them the rule down the value column — stay aligned with every
 * plain row on the sheet; only the value cell gives up the width.
 */
const SHEET_ROW_TOOLS = 'grid grid-cols-[minmax(5.5rem,36%)_auto_1fr_auto] items-start border-b last:border-b-0'
const SHEET_TOOL_BTN = 'inline-flex w-6 items-center justify-center rounded text-muted-foreground transition active:scale-90 disabled:pointer-events-none disabled:opacity-25'
export const SHEET_LABEL = 'py-1.5 pr-2 text-[11px] font-semibold uppercase leading-snug tracking-wide text-muted-foreground'
const SHEET_COLON = 'self-stretch pt-1.5 text-center text-xs font-bold text-muted-foreground'
const SHEET_VALUE_CELL = 'min-w-0 self-stretch border-l pl-2'
const SHEET_VALUE_TEXT = 'block whitespace-pre-wrap break-words py-1.5 text-[13px] leading-snug text-foreground'
const SHEET_FIELD = 'w-full min-w-0 resize-none overflow-hidden bg-transparent py-1.5 text-[13px] leading-snug outline-none placeholder:text-muted-foreground/50'

/**
 * A field that grows instead of truncating.
 *
 * Every control in this app renders at 16px on a touch device (index.css
 * forces it, or iOS Safari zooms the page in on focus and never zooms back
 * out). At that size a one-line <input> in the label column of a 390px phone
 * fits about eleven characters, so "SETTEKİ KİTAP SAYISI" showed as "SETTEKİ
 * KİTA" while editing — and this is a form people read, not a scratch input.
 * A textarea wraps, so the row just gets taller, exactly like the printed
 * sheet's pre-wrap cells.
 *
 * Enter is swallowed: these are single-value fields, and a stray newline would
 * be saved and printed.
 */
function AutoField({ className, value, onChange, ...props }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value ?? ''}
      onChange={onChange}
      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
      className={cn(SHEET_FIELD, className)}
      {...props}
    />
  )
}

/** The sheet itself — a single white page the blocks below stack inside. */
export function FormSheet({ className, children }) {
  return <div className={cn('overflow-hidden rounded-lg border bg-white', className)}>{children}</div>
}

/**
 * Title block. `title` is the form's name (DEMO ÜRETİM FORMU …), `subtitle`
 * the job it belongs to, `attemptLabel` the round ("2. DEMO") where the stage
 * counts rounds — the sipariş side has no counter and passes none.
 */
export function FormSheetHead({ title, subtitle, attemptLabel, icon: Icon }) {
  return (
    <div className="border-b px-4 py-3 text-center">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.18em] text-foreground">{title}</h2>
      {subtitle && (
        <p className="mt-1.5 flex items-start justify-center gap-1.5 text-[13px] font-semibold leading-snug text-foreground">
          {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 break-words">{subtitle}</span>
        </p>
      )}
      {attemptLabel && (
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{attemptLabel}</p>
      )}
    </div>
  )
}

/** A block of rows inside the sheet (künye, one parça, …). */
export function FormSheetBlock({ className, children }) {
  return <div className={cn('border-b px-4 py-0.5 last:border-b-0', className)}>{children}</div>
}

/** Centred caption naming the block below it — a parça, mostly. */
export function FormSheetBlockTitle({ children }) {
  return (
    <div className="border-b bg-muted/30 px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest text-foreground">
      {children}
    </div>
  )
}

/**
 * One künye line (LABEL : value) with a fixed label.
 *
 * `onChange` is a DOM handler and `name` the form key, matching the rest of
 * the app's controlled inputs. Read-only renders plain text instead of a dead
 * input, so a sheet nobody can edit reads as a document.
 *
 * `required` marks a field that may never be sent blank: while it IS blank the
 * cell carries a red wash, so the gap shows on the sheet itself and not only
 * in a footer warning a scroll away on a phone.
 */
export function SheetRow({ label, name, value, onChange, readOnly, required = false }) {
  const missing = required && !String(value ?? '').trim()
  return (
    <div className={SHEET_ROW}>
      <span className={SHEET_LABEL}>
        {label}
        {/* A fill-this-in instruction — nothing to obey on a sheet that can no
            longer be edited, or on paper. */}
        {required && !readOnly && <span className="text-destructive print:hidden"> *</span>}
      </span>
      <span className={SHEET_COLON}>:</span>
      <div className={cn(SHEET_VALUE_CELL, missing && !readOnly && 'bg-destructive/5')}>
        {readOnly ? (
          <span className={SHEET_VALUE_TEXT}>{value || '—'}</span>
        ) : (
          <AutoField
            name={name}
            value={value}
            onChange={onChange}
            placeholder={missing ? 'Zorunlu' : undefined}
            className={cn(missing && 'placeholder:text-destructive/60')}
          />
        )}
      </div>
    </div>
  )
}

/**
 * A spec row whose LABEL is editable too — the user-added rows and the parça
 * rows, where a leader may rename a field. Read-only collapses both halves to
 * plain text, which is then indistinguishable from a SheetRow.
 *
 * `onMoveUp` / `onMoveDown` reorder the row. Pass them whenever the row sits in
 * a list of more than one — a row at an end passes null for the direction it
 * cannot go, and that arrow renders disabled rather than disappearing, so the
 * controls keep the same width on every row and the value column does not
 * jitter as rows move. With neither handler (a lone row) the arrows are left
 * out altogether and only the remove button takes space.
 */
export function SheetSpecRow({ label, value, onLabelChange, onValueChange, onRemove, onMoveUp, onMoveDown, readOnly }) {
  const canReorder = !readOnly && (onMoveUp || onMoveDown)
  const hasTools = !readOnly && (canReorder || onRemove)
  return (
    <div className={hasTools ? SHEET_ROW_TOOLS : SHEET_ROW}>
      {readOnly ? (
        <span className={SHEET_LABEL}>{label}</span>
      ) : (
        <AutoField
          value={label}
          onChange={(e) => onLabelChange?.(e.target.value)}
          placeholder="ALAN"
          aria-label="Alan adı"
          className={cn(SHEET_LABEL, 'py-1.5 pr-2')}
        />
      )}
      <span className={SHEET_COLON}>:</span>
      <div className={SHEET_VALUE_CELL}>
        {readOnly ? (
          <span className={SHEET_VALUE_TEXT}>{value || '—'}</span>
        ) : (
          <AutoField
            value={value}
            onChange={(e) => onValueChange?.(e.target.value)}
            placeholder="Değer"
            aria-label="Alan değeri"
          />
        )}
      </div>
      {/* Editing controls — they sit outside the value cell so they never
          overlap the text, and off the sheet when it goes to paper. */}
      {hasTools && (
        <div className="flex items-start gap-0.5 pl-1 pt-1 print:hidden">
          {canReorder && (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={onMoveUp ?? undefined}
                disabled={!onMoveUp}
                aria-label="Satırı yukarı taşıyın"
                className={cn(SHEET_TOOL_BTN, 'h-6 hover:text-foreground')}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onMoveDown ?? undefined}
                disabled={!onMoveDown}
                aria-label="Satırı aşağı taşıyın"
                className={cn(SHEET_TOOL_BTN, 'h-6 hover:text-foreground')}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Satırı silin"
              className={cn(SHEET_TOOL_BTN, canReorder ? 'h-12' : 'h-6', 'hover:text-destructive')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * "+ Satır Ekleyin" under a block's rows.
 *
 * Wrapped in its own row so it carries the sheet's rule when other rows follow
 * it — on the künye it sits between the added rows and the fixed ones, and
 * without the rule those two groups would run together. Last in a block it
 * drops the rule, exactly like a row.
 */
export function SheetAddRow({ onClick, className }) {
  return (
    <div className={cn('border-b last:border-b-0 print:hidden', className)}>
      <button
        type="button"
        onClick={onClick}
        className="my-1 inline-flex items-center gap-1 py-1 text-[11px] font-semibold text-primary transition active:scale-95 hover:opacity-80"
      >
        <Plus className="h-3 w-3" /> Satır Ekleyin
      </button>
    </div>
  )
}
