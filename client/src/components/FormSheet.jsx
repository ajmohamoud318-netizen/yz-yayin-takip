import { useLayoutEffect, useRef } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, X } from 'lucide-react'

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
 * The same row with a trailing column for the edit controls (remove). The
 * first three tracks are identical, so the label column and the colon — and
 * with them the rule down the value column — stay aligned with every plain
 * row on the sheet; only the value cell gives up the width.
 *
 * (Drag-to-reorder lives on a LEFT-edge grip the row renders as its first
 * child when reorderable, so the right edge stays clean — the rule down
 * the value column never has to dodge a drag handle.)
 */
const SHEET_ROW_TOOLS = 'grid grid-cols-[minmax(5.5rem,36%)_auto_1fr_auto] items-start border-b last:border-b-0'
/**
 * Same shape, with a leading column for the drag handle. Defined separately
 * so the label column starts at the SAME absolute pixel position on a
 * sortable row as it does on every plain row — even though the handle is
 * always present on a sortable list, a row never reflows when it joins or
 * leaves it.
 */
const SHEET_ROW_SORTABLE = 'grid grid-cols-[auto_minmax(5.5rem,36%)_auto_1fr_auto] items-start border-b last:border-b-0'
const SHEET_TOOL_BTN = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition active:scale-90 disabled:pointer-events-none disabled:opacity-25'
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
 *
 * `attemptLabel` sits at the very top tight against the header's upper edge
 * on the right, so the round number reads as a small top-right marker while
 * the centred title and subtitle own the rest of the block.
 */
export function FormSheetHead({ title, subtitle, attemptLabel, icon: Icon }) {
  return (
    <div className="border-b px-4 pt-1 pb-3 text-center">
      {attemptLabel && (
        <p className="mb-0.5 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{attemptLabel}</p>
      )}
      <h2 className="text-[12px] font-bold uppercase tracking-[0.18em] text-foreground">{title}</h2>
      {subtitle && (
        <p className="mt-1.5 flex items-start justify-center gap-1.5 text-[13px] font-semibold leading-snug text-foreground">
          {/* A glyph belongs to the app, not to the form the matbaa gets. */}
          {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground print:hidden" />}
          <span className="min-w-0 break-words">{subtitle}</span>
        </p>
      )}
    </div>
  )
}

/** A block of rows inside the sheet (künye, one parça, …). */
export function FormSheetBlock({ className, children }) {
  return <div className={cn('border-b px-4 py-0.5 last:border-b-0', className)}>{children}</div>
}

/* No FormSheetBlockTitle any more. A parça used to be introduced by a centred
   caption carrying its name; it now names itself with an İŞİN ADI row, which
   is what it does on paper (specPrint.js → formSection) and what the sheet's
   own no-parça body has always done. The caption was the one place on this
   form where screen and print disagreed about what the sheet says, and
   keeping both would have printed the parça's name twice in a row. */

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
export function SheetRow({ label, name, value, onChange, readOnly, required = false, className, badge = null }) {
  const missing = required && !String(value ?? '').trim()
  return (
    <div className={cn(badge ? SHEET_ROW_TOOLS : SHEET_ROW, className)}>
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
      {/* Screen-only marker in the tools column — "PARÇA 2/3" on a parça's
          İŞİN ADI row. On paper each parça IS its own page and the head says
          so; on screen they scroll as one document, and the matbaa has to be
          able to see where one sheet ends and the next begins. */}
      {badge && <div className="flex items-start pl-2 pt-1.5 print:hidden">{badge}</div>}
    </div>
  )
}

/**
 * A spec row whose LABEL is editable too — the user-added rows and the parça
 * rows, where a leader may rename a field. Read-only collapses both halves to
 * plain text, which is then indistinguishable from a SheetRow.
 *
 * Reordering is drag-to-reorder: a left-edge grip (rendered when reorderable,
 * hidden while read-only or when the row sits outside a sortable list) is the
 * drag handle, and rows sit in a `<SortableContext>` the caller wires up via
 * `SheetSpecRowList` below. The handle replaces the up/down arrows the rows
 * used to carry — a row no longer needs two buttons to reorder, and one
 * affordance on every row keeps the value column from jittering on move. A
 * lone row keeps the column reserved for layout stability but renders no
 * grip (there is nothing to swap with), the same way the lone-row case used
 * to drop the arrows.
 *
 * `required` gives the value cell the same red wash SheetRow uses while it is
 * blank — the Baskı Onay Formu's ADET row is a spec row now, and a sheet that
 * may not go out with it empty has to say so where the gap is, not only in a
 * footer a scroll away on a phone.
 *
 * The row receives its drag wiring from `SheetSpecRowList` via the four
 * `__sortable*` props. Standalone callers (a row rendered outside a list) get
 * `dragHandleProps={null}` and `style={undefined}`, which fall through to a
 * static grip with no listeners — handy for read-only previews but rarely used
 * in this app.
 */
export function SheetSpecRow({
  label, value, onLabelChange, onValueChange, onRemove,
  readOnly, required = false,
  __sortableId, __sortableStyle, __sortableSetNodeRef, __sortableHandleProps, __isDragging,
}) {
  const canReorder = !readOnly && !!__sortableId
  const hasTools = !readOnly && (canReorder || onRemove)
  // Drag-to-reorder rows get a leading column for the grip; otherwise the
  // label column on a sortable row would sit one column to the right of
  // every plain row on the sheet and the colons would no longer line up.
  const rowClass = canReorder
    ? SHEET_ROW_SORTABLE
    : hasTools
      ? SHEET_ROW_TOOLS
      : SHEET_ROW
  const missing = required && !String(value ?? '').trim()
  return (
    <div
      ref={__sortableSetNodeRef}
      className={rowClass}
      style={__sortableStyle}
      data-dragging={__isDragging ? '' : undefined}
    >
      {/* Drag handle — a dedicated grip on the left edge so a row is never
          draggable from its label or value (typing must keep working there).
          Off the sheet on paper. `cursor-grab` shows the affordance, the
          listeners from useSortable do the rest. */}
      {canReorder && (
        <button
          type="button"
          aria-label="Satırı sürükleyin"
          title="Satırı sürükleyin"
          // preventDefault on pointerdown keeps the click from reaching the
          // label/value textareas underneath when the user starts a drag —
          // otherwise a short tap on the grip would put a caret in the field.
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
          }}
          {...(__sortableHandleProps ?? {})}
          className={cn(
            SHEET_TOOL_BTN,
            'print:hidden',
            // Show the grip is grabbable only on touch / when the keyboard
            // sensor is engaged. Mouse users get the cursor from
            // `useSortable`'s transform feedback — and an always-on grip on
            // every row of a tall form is visual noise.
            'cursor-grab touch-manipulation active:cursor-grabbing',
            'text-muted-foreground/60 hover:text-foreground',
            __isDragging && 'text-foreground',
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
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
      <div className={cn(SHEET_VALUE_CELL, missing && !readOnly && 'bg-destructive/5')}>
        {readOnly ? (
          <span className={SHEET_VALUE_TEXT}>{value || '—'}</span>
        ) : (
          <AutoField
            value={value}
            onChange={(e) => onValueChange?.(e.target.value)}
            placeholder={missing ? 'Zorunlu' : 'Değer'}
            aria-label="Alan değeri"
            className={cn(missing && 'placeholder:text-destructive/60')}
          />
        )}
      </div>
      {/* Editing controls — outside the value cell so they never overlap the
          text, on one line so a row with them stands exactly as tall as a row
          without: the sheet keeps one row rhythm and an added row does not
          bloat to twice the height of the fixed ones. Off the sheet on paper. */}
      {hasTools && (
        <div className="flex items-start pl-1 pt-0.5 print:hidden">
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Satırı silin"
              className={cn(SHEET_TOOL_BTN, 'hover:text-destructive')}
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
 * `useSortable` hook bound to a row. Lives in its own component so the
 * `SheetSpecRow` itself stays a presentational primitive that can also render
 * outside a drag context (a read-only preview, a test fixture). The sortable
 * styles (transform + transition) are passed through to `SheetSpecRow`'s own
 * root div — wrapping the row in an extra div would shift its grid columns
 * out of line with every other row on the sheet, which is the one thing the
 * form may not do.
 */
function SortableSheetSpecRow({ row, readOnly, required, rowProps }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: row.id, disabled: readOnly })
  const style = {
    // `transform: none` shows up as a translate3d(0,0,0) on dnd-kit — collapse
    // it so the row doesn't pick up a stray compositing layer when idle.
    transform: CSS.Transform.toString(transform),
    transition,
  }
  // The ref lands on the row's root div so the floating preview matches the
  // row's actual size (label column + colon + value + tools). Without the
  // ref on the row itself, dnd-kit would animate a phantom box the same
  // width as its parent block — which on a sheet with no parent padding
  // is wider than the row, and the dragged shadow spills across the rule
  // down the value column.
  return (
    <SheetSpecRow
      {...rowProps}
      required={required}
      readOnly={readOnly}
      __sortableId={row.id}
      __sortableStyle={style}
      __sortableSetNodeRef={setNodeRef}
      __sortableHandleProps={{ ...attributes, ...listeners }}
      __isDragging={isDragging}
    />
  )
}

/**
 * A drag-to-reorder wrapper for `SheetSpecRow`s. The caller hands in the rows
 * (each with a stable `id`), the field/remove callbacks for each row, and an
 * `onReorder(rowId, toIndex)` that the parent uses to splice the new order
 * into its own state. `onReorder` is called with `toIndex` interpreted AFTER
 * the row has been lifted out — the same convention dnd-kit's `arrayMove`
 * uses, so the call site is one line.
 *
 * Even a one-row list goes through the sortable path, so the label column
 * sits at the same pixel position regardless of list length — deleting the
 * second-to-last row would otherwise snap the whole column 24px left. The
 * row's grip is hidden because no drag would do anything useful with one
 * item, but the column is reserved so the layout never reflows.
 */
export function SheetSpecRowList({
  rows,
  onReorder,
  getRowProps,
  isRequired = false,
  readOnly = false,
}) {
  // `closestCenter` lands the row between its visual neighbours on a phone
  // (the body has no gap rows, so axis-aligned centre is the right pick).
  // 6px of pointer movement is enough to start a drag without stealing
  // taps from the row's textareas on the first pixel of a scroll gesture.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const list = rows ?? []
  // `isRequired` may be a flat boolean (one rule for every row) or a
  // predicate `(row) => bool` (per-row rules keyed on the row's own label —
  // the ADET / BASIM YERİ cells on the Baskı Onay Formu are spec rows whose
  // "required" flag depends on what the field is called, not on which row
  // of the list it sits in).
  const requiredFor = typeof isRequired === 'function'
    ? isRequired
    : () => !!isRequired
  function resolveReadOnly(row, props) {
    // Per-row `readOnly` returned from `getRowProps` wins over the list-level
    // flag — the live SAYFA SAYISI lock is a per-row concern (it depends on
    // which field the row carries) and the list is just the default.
    if (readOnly) return true
    if (typeof props?.readOnly === 'boolean') return props.readOnly
    return false
  }
  if (list.length < 2) {
    // Even with a single row we still go through the sortable path so the
    // label column sits at the same pixel position it would if a second row
    // joined the list — deleting the second-to-last row would otherwise snap
    // the whole column 24px left. The row's grip is hidden because no drag
    // would do anything useful with one item, but the column is reserved so
    // the layout never reflows.
    return (
      <DndContext sensors={sensors}>
        <SortableContext items={list.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {list.map((row) => {
            const props = getRowProps(row)
            return (
              <SortableSheetSpecRow
                key={row.id}
                row={row}
                required={requiredFor(row)}
                readOnly={resolveReadOnly(row, props)}
                rowProps={props}
              />
            )
          })}
        </SortableContext>
      </DndContext>
    )
  }
  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = list.findIndex((r) => r.id === active.id)
    const to = list.findIndex((r) => r.id === over.id)
    if (from < 0 || to < 0) return
    onReorder?.(active.id, arrayMove(list, from, to).findIndex((r) => r.id === active.id))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={list.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        {list.map((row) => {
          const props = getRowProps(row)
          return (
            <SortableSheetSpecRow
              key={row.id}
              row={row}
              required={requiredFor(row)}
              readOnly={resolveReadOnly(row, props)}
              rowProps={props}
            />
          )
        })}
      </SortableContext>
    </DndContext>
  )
}

/**
 * "+ Satır Ekleyin" under a block's rows.
 *
 * Wrapped in its own row so it carries the sheet's rule when other rows follow
 * it — on the künye it sits between the added rows and the fixed ones, and
 * without the rule those two groups would run together. Last in a block it
 * drops the rule, exactly like a row.
 *
 * `suggestions` are the parça's own template rows that aren't on the block
 * right now (data/parcaTemplates#missingTemplateLabels). Deleting a template
 * line is how the author clears the send gate for a field this job doesn't
 * have — so putting them back has to be a tap. They render as chips rather
 * than a menu: a menu on a phone is a second surface to open and aim at, and
 * these are at most a handful of short labels that wrap on their own.
 */
export function SheetAddRow({ onClick, className, suggestions = [], onAddSuggestion }) {
  const chips = onAddSuggestion ? suggestions : []
  return (
    <div className={cn('border-b last:border-b-0 print:hidden', className)}>
      <div className="flex flex-wrap items-center gap-1.5 py-1">
        <button
          type="button"
          onClick={onClick}
          className="my-1 inline-flex items-center gap-1 py-1 text-[11px] font-semibold text-primary transition active:scale-95 hover:opacity-80"
        >
          <Plus className="h-3 w-3" /> Satır Ekleyin
        </button>
        {chips.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onAddSuggestion(label)}
            title={`${label} satırını geri ekleyin`}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-primary/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition active:scale-95 hover:border-primary/70 hover:text-primary"
          >
            <Plus className="h-2.5 w-2.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
