import { Box, BookOpen, ChevronDown, ChevronUp, GraduationCap, Layers, Plus, X } from 'lucide-react'
import { parcaKind } from '@/data/parcaTemplates'
import { cn } from '@/lib/utils'

const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR')

/**
 * Reçete/parça spec sheet rendering — shared between Ürün Bilgileri and
 * Baskı Reçeteleri, both of which read/write the same product_info rows
 * (see migration 020__product_info.sql). A "reçete" here is one
 * `{ component, date, fields: [{k, v}] }` entry inside a project's
 * product_info.components array.
 */

// Structured `kind` → human label + Tailwind classes for the badge.
// `main` is the lead parça (no badge by default — its position in the card
// already says it's the primary); siblings render a small pill so the UI can
// tell Kutu from Kılavuz from a generic parça at a glance.
//
// The labels name the PART, not the document: the parça is already called
// "<ürün> KUTU" (NewProjectDialog#deriveInitialProductInfo), so a chip
// reading "Kutu Reçetesi" next to it said the same word twice and called the
// thing a reçete on a sheet that is a form.
const KIND_META = {
  main:    { label: 'Ana Parça', icon: BookOpen,        cls: 'bg-primary/10 text-primary ring-primary/20' },
  kutu:    { label: 'Kutu', icon: Box,                  cls: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  kilavuz: { label: 'Kılavuz', icon: GraduationCap,     cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  other:   { label: 'Parça', icon: Layers,              cls: 'bg-muted text-muted-foreground ring-border' },
}

/** Resolve a component's `kind` — defaults to `main` for legacy rows that
 *  haven't been backfilled yet (the server does this on read, but offline /
 *  localStorage-only caches can still hand us an untagged row). One rule,
 *  in data/parcaTemplates, so the badge on this card and the spec form's
 *  own reading of the same parça can never diverge. */
export const resolveKind = parcaKind

/**
 * Inline kind badge — same chip the SpecSheet header renders, exposed for
 * the surrounding card chrome (parça navigation pill, future baskı-reçete
 * grouping, etc.) so every surface shows the same label, icon, and colour.
 */
export function KindBadge({ kind, className }) {
  const meta = KIND_META[kind] ?? KIND_META.main
  const Icon = meta.icon
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', meta.cls, className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

/* ---------- read-only spec row (definition-list: key / value) ---------- */
export function SheetRow({ label, value }) {
  return (
    <div className="grid grid-cols-[minmax(6.5rem,10rem)_1fr] gap-x-4 px-4 py-2.5 transition-colors hover:bg-primary/[0.025]">
      <dt className="pt-px text-[11px] font-semibold uppercase leading-snug tracking-wide text-muted-foreground">{up(label)}</dt>
      {/* A declared-but-empty field is content: the KUTU template puts its
          four labels on a new box with nothing beside them yet, and hiding the
          value half would leave a row that looks broken rather than unfilled. */}
      <dd className="whitespace-pre-wrap text-[13px] font-medium leading-snug text-foreground tabular-nums">
        {value || <span className="text-muted-foreground/50">—</span>}
      </dd>
    </div>
  )
}

/* ---------- read-only component spec sheet ---------- */
export function SpecSheet({ comp }) {
  // A row survives on a label alone — the template's unfilled fields are what
  // the leader is meant to see and go fill in. Only rows with neither half
  // (a "Satır Ekle" nobody typed into) are dropped.
  const fields = (comp.fields ?? []).filter((f) => String(f?.k ?? '').trim() || String(f?.v ?? '').trim())
  const kind = resolveKind(comp)
  // The main recipe doesn't get a badge — the card header already labels it
  // as the lead; a pill would just be visual noise on the most common case.
  const showBadge = kind !== 'main'
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b bg-primary/[0.04] px-4 py-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Box className="h-3.5 w-3.5" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-wide text-foreground">{comp.component}</h3>
        {showBadge && <KindBadge kind={kind} />}
        {comp.date && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {comp.date}
          </span>
        )}
      </div>
      <dl className="divide-y divide-border/50">
        {fields.map((f, i) => (
          <SheetRow key={i} label={f.k} value={f.v} />
        ))}
      </dl>
    </div>
  )
}

/* ---------- editable spec row ---------- */
const cellInput = 'w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/50'
const ROW_TOOL_BTN = 'grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition active:scale-90 disabled:pointer-events-none disabled:opacity-25 print:hidden'

/**
 * `onMoveUp` / `onMoveDown` reorder the row; a row at either end passes null
 * for the direction it cannot go and that arrow renders disabled rather than
 * disappearing, so every row keeps the same tool width and the value column
 * does not jitter as rows move. Same treatment as the demo/ozalit form's
 * SheetSpecRow (components/FormSheet.jsx) — the two editors sit over the same
 * product_info rows, so reordering has to be possible in both.
 *
 * The tools are always visible. They used to fade in on `group-hover`, which
 * on a phone — where this app is actually used — meant no visible way to
 * delete a row at all.
 */
export function EditableSheetRow({ label, value, onLabel, onValue, onRemove, onMoveUp, onMoveDown }) {
  const canReorder = Boolean(onMoveUp || onMoveDown)   // a lone row has nowhere to go
  return (
    <div className="grid grid-cols-[minmax(6.5rem,10rem)_1fr_auto] items-center gap-x-3 px-4 py-1.5 transition-colors hover:bg-primary/[0.025]">
      <input
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        placeholder="ALAN"
        aria-label="Alan adı"
        className={cn(cellInput, 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground')}
      />
      <input
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder="Değer"
        aria-label="Alan değeri"
        className={cn(cellInput, 'font-medium text-foreground')}
      />
      <div className="flex items-center print:hidden">
        {canReorder && (
          <>
            <button
              type="button"
              onClick={onMoveUp ?? undefined}
              disabled={!onMoveUp}
              aria-label="Satırı yukarı taşıyın"
              className={cn(ROW_TOOL_BTN, 'hover:bg-primary/10 hover:text-foreground')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown ?? undefined}
              disabled={!onMoveDown}
              aria-label="Satırı aşağı taşıyın"
              className={cn(ROW_TOOL_BTN, 'hover:bg-primary/10 hover:text-foreground')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Satırı sil"
          className={cn(ROW_TOOL_BTN, 'hover:bg-destructive/10 hover:text-destructive')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

/* ---------- editable component spec sheet ---------- */
export function EditableSpecSheet({ comp, onChange }) {
  const fields = comp.fields ?? []
  const setField = (i, patch) => onChange({ ...comp, fields: fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) })
  const addField = () => onChange({ ...comp, fields: [...fields, { k: '', v: '' }] })
  const removeField = (i) => onChange({ ...comp, fields: fields.filter((_, idx) => idx !== i) })
  // Order is meaning on a sheet the matbaa reads top to bottom — the KUTU
  // template lands as EBAT → ÜST KAĞIT → ALT KAĞIT → LAMİNASYON and a leader
  // who adds a row (or seeds one from a different template) has to be able to
  // put it where it belongs instead of only at the end.
  const moveField = (i, dir) => {
    const to = i + dir
    if (to < 0 || to >= fields.length) return
    const next = [...fields]
    const [row] = next.splice(i, 1)
    next.splice(to, 0, row)
    onChange({ ...comp, fields: next })
  }
  const kind = resolveKind(comp)
  const KindIcon = KIND_META[kind].icon

  return (
    <div className="overflow-hidden rounded-xl border border-primary/40 bg-card shadow-sm ring-1 ring-primary/10">
      <div className="flex flex-wrap items-center gap-2.5 border-b bg-primary/[0.05] px-4 py-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Box className="h-3.5 w-3.5" />
        </span>
        <input
          value={comp.component}
          onChange={(e) => onChange({ ...comp, component: e.target.value })}
          placeholder="PARÇA ADI"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-bold uppercase tracking-wide text-foreground outline-none placeholder:text-muted-foreground/50"
        />
        {/* Structured tag dropdown. Lets the leader override the inferred
            `main`/`kutu`/`kilavuz` without renaming the component — e.g. a
            bespoke sticker sheet that shouldn't read as the lead recipe. */}
        <label className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-background px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border print:hidden">
          <KindIcon className="h-3 w-3" />
          <span className="sr-only">Parça türü</span>
          <select
            value={kind}
            onChange={(e) => onChange({ ...comp, kind: e.target.value })}
            className="bg-transparent text-[11px] font-semibold uppercase tracking-wide text-foreground outline-none"
          >
            <option value="main">Ana Parça</option>
            <option value="kutu">Kutu</option>
            <option value="kilavuz">Kılavuz</option>
            <option value="other">Parça</option>
          </select>
        </label>
      </div>
      <dl className="divide-y divide-border/50">
        {fields.map((f, i) => (
          <EditableSheetRow
            key={i}
            label={f.k}
            value={f.v}
            onLabel={(v) => setField(i, { k: v })}
            onValue={(v) => setField(i, { v })}
            onRemove={() => removeField(i)}
            onMoveUp={fields.length > 1 && i > 0 ? () => moveField(i, -1) : null}
            onMoveDown={fields.length > 1 && i < fields.length - 1 ? () => moveField(i, 1) : null}
          />
        ))}
      </dl>
      <div className="border-t border-dashed px-4 py-2.5 print:hidden">
        <button
          type="button"
          onClick={addField}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary transition active:scale-95 hover:opacity-80"
        >
          <Plus className="h-3.5 w-3.5" /> Satır Ekle
        </button>
      </div>
    </div>
  )
}
