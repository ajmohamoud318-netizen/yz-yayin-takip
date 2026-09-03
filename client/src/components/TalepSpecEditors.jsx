import { ChevronDown, ListChecks, Pencil, Plus, RefreshCw, X } from 'lucide-react'

import { cn, formatNumber } from '@/lib/utils'

/**
 * What the designer (and, while the round is still theirs to fix, the team
 * leader) may EDIT inside TalepSignDialog — split out of it (slice: client
 * god-components).
 *
 * Two editors and the two disclosure panels that hold them: the order's own
 * alt görevler snapshot, and the project's Baskı Reçeteleri. Both are
 * controlled — every edit goes straight back to the dialog, which owns the
 * saving.
 */

// ── designer inline spec editor ──────────────────────────────────────────────
function EditableComp({ comp, onChange }) {
  const fields = comp.fields ?? []
  const setField = (i, patch) => onChange({ ...comp, fields: fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) })
  const addField = () => onChange({ ...comp, fields: [...fields, { k: '', v: '' }] })
  const removeField = (i) => onChange({ ...comp, fields: fields.filter((_, idx) => idx !== i) })

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b bg-muted/30 px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest text-foreground">
        {comp.component}
      </div>
      <div className="px-2 py-1">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5 border-b py-1 last:border-b-0">
            <input
              value={f.k}
              onChange={(e) => setField(i, { k: e.target.value })}
              placeholder="ALAN"
              className="w-24 shrink-0 bg-transparent text-[11px] font-semibold uppercase tracking-wide outline-none placeholder:text-muted-foreground/50"
            />
            <span className="text-xs font-bold text-muted-foreground">:</span>
            <input
              value={f.v}
              onChange={(e) => setField(i, { v: e.target.value })}
              placeholder="Değer"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
            />
            <button
              type="button"
              onClick={() => removeField(i)}
              aria-label="Satırı sil"
              className="shrink-0 rounded p-0.5 text-muted-foreground transition active:scale-90 hover:text-destructive print:hidden"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addField}
          className="mt-1 inline-flex items-center gap-1 px-1 py-1 text-[11px] font-semibold text-primary transition active:scale-95 hover:opacity-80 print:hidden"
        >
          <Plus className="h-3 w-3" /> Satır Ekle
        </button>
      </div>
    </div>
  )
}

// ── designer inline subtask (alt görev) editor ───────────────────────────────
/**
 * Reprint-check subtask list. The work is already complete, so this is NOT a
 * done/undone checklist — the designer flags which subtasks need revision for
 * this run. Marking "Revize" sets needs_revize and drops the item from done
 * (so the rework shows up); unmarking restores it as complete.
 */
function SubtaskEditor({ subtasks, onChange }) {
  const set = (i, patch) => onChange(subtasks.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const toggleRevize = (i) => {
    const s = subtasks[i]
    const flag = !s.needs_revize
    if (flag) {
      const patch = { needs_revize: true, is_done: false, done_at: null }
      if (s.kind === 'pages') patch.pages_done = 0
      if (s.kind === 'sticker-count') patch.stickers_done = 0
      set(i, patch)
    } else {
      const patch = { needs_revize: false, is_done: true, done_at: new Date().toISOString() }
      if (s.kind === 'pages') patch.pages_done = s.total_pages ?? 0
      if (s.kind === 'sticker-count') patch.stickers_done = s.total_stickers ?? 0
      set(i, patch)
    }
  }
  const revizeCount = subtasks.filter((s) => s.needs_revize).length

  return (
    <div className="space-y-1">
      <p className="px-1 pb-1 text-[11px] text-muted-foreground">
        Revize ettiğiniz alt görevleri işaretleyin.{' '}
        {revizeCount > 0 ? `${revizeCount} görev revize edildi.` : 'İşaretlenen yok, her şey hazır.'}
      </p>
      {subtasks.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">Bu projede alt görev yok.</p>
      ) : (
        subtasks.map((s, i) => {
          const flagged = !!s.needs_revize
          return (
            <div
              key={s.id ?? i}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5',
                flagged ? 'border-amber-300 bg-amber-50' : 'bg-white',
              )}
            >
              <span className={cn('min-w-0 flex-1 text-[13px]', flagged && 'font-medium text-amber-800')}>
                {s.title}
              </span>
              <button
                type="button"
                onClick={() => toggleRevize(i)}
                aria-pressed={flagged}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition active:scale-95',
                  flagged
                    ? 'border-amber-400 bg-amber-100 text-amber-700'
                    : 'border-input text-muted-foreground hover:border-amber-300 hover:text-amber-700',
                )}
              >
                <RefreshCw className="h-3 w-3" />
                {flagged ? 'Revize edildi' : 'Revize'}
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}

/**
 * Alt görevler, collapsed behind their own header with the revize count on it
 * — the designer's first job at the 'tasarimciya_atandi' check step.
 */
export function SubtaskPanel({ subtasks, onChange, open, onToggle }) {
  const revizeCount = subtasks.filter((s) => s.needs_revize).length
  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          Alt Görevler
          {revizeCount > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">
              {revizeCount} revize
            </span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t bg-muted/20 p-2">
          <SubtaskEditor subtasks={subtasks} onChange={onChange} />
        </div>
      )}
    </div>
  )
}

/**
 * Ürün Bilgileri, collapsed by default with the ordered parça/adet chips on
 * its header so the spec can be checked without opening it. Mirrors the main
 * pipeline's Ozalit form, where the team leader may correct the spec right up
 * through approval.
 */
export function ProductInfoPanel({ comps, onChangeComp, items, quantity, open, onToggle }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            Ürün Bilgileri
          </span>
          <div className="flex flex-wrap gap-1.5">
            {items.length > 0
              ? items.map((it) => (
                  <span key={it.name} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                    {it.name}
                    <span className="text-muted-foreground">{formatNumber(it.quantity)} adet</span>
                  </span>
                ))
              : quantity != null && (
                  <span className="inline-flex items-center whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                    {formatNumber(quantity)} adet
                  </span>
                )}
          </div>
        </div>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t bg-muted/20 p-2">
          {comps.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Bu ürün için bilgi yok.</p>
          ) : (
            comps.map((c, ci) => (
              <EditableComp key={ci} comp={c} onChange={(nc) => onChangeComp(ci, nc)} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
