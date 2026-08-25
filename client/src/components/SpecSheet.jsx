import { Box, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR')

/**
 * Reçete/parça spec sheet rendering — shared between Ürün Bilgileri and
 * Baskı Reçeteleri, both of which read/write the same product_info rows
 * (see migration 020__product_info.sql). A "reçete" here is one
 * `{ component, date, fields: [{k, v}] }` entry inside a project's
 * product_info.components array.
 */

/* ---------- read-only spec row (definition-list: key / value) ---------- */
export function SheetRow({ label, value }) {
  return (
    <div className="grid grid-cols-[minmax(6.5rem,10rem)_1fr] gap-x-4 px-4 py-2.5 transition-colors hover:bg-primary/[0.025]">
      <dt className="pt-px text-[11px] font-semibold uppercase leading-snug tracking-wide text-muted-foreground">{up(label)}</dt>
      <dd className="whitespace-pre-wrap text-[13px] font-medium leading-snug text-foreground tabular-nums">{value}</dd>
    </div>
  )
}

/* ---------- read-only component spec sheet ---------- */
export function SpecSheet({ comp }) {
  const fields = (comp.fields ?? []).filter((f) => f.v)
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="flex items-center gap-2.5 border-b bg-primary/[0.04] px-4 py-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Box className="h-3.5 w-3.5" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-wide text-foreground">{comp.component}</h3>
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
export function EditableSheetRow({ label, value, onLabel, onValue, onRemove }) {
  return (
    <div className="group/row grid grid-cols-[minmax(6.5rem,10rem)_1fr_auto] items-center gap-x-3 px-4 py-1.5 transition-colors hover:bg-primary/[0.025]">
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
      <button
        type="button"
        onClick={onRemove}
        aria-label="Satırı sil"
        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition active:scale-90 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100 print:hidden"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/* ---------- editable component spec sheet ---------- */
export function EditableSpecSheet({ comp, onChange }) {
  const fields = comp.fields ?? []
  const setField = (i, patch) => onChange({ ...comp, fields: fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) })
  const addField = () => onChange({ ...comp, fields: [...fields, { k: '', v: '' }] })
  const removeField = (i) => onChange({ ...comp, fields: fields.filter((_, idx) => idx !== i) })

  return (
    <div className="overflow-hidden rounded-xl border border-primary/40 bg-card shadow-sm ring-1 ring-primary/10">
      <div className="flex items-center gap-2.5 border-b bg-primary/[0.05] px-4 py-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Box className="h-3.5 w-3.5" />
        </span>
        <input
          value={comp.component}
          onChange={(e) => onChange({ ...comp, component: e.target.value })}
          placeholder="PARÇA ADI"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-bold uppercase tracking-wide text-foreground outline-none placeholder:text-muted-foreground/50"
        />
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
