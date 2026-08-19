import { useEffect, useState } from 'react'
import { Check, ListChecks, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { Skeleton } from '@/components/ui/skeleton'

const deepCopy = (x) => JSON.parse(JSON.stringify(x))

// Only these three exist in the DB (migration 003's CHECK constraint).
const SUBTASK_KINDS = [
  { value: 'check', label: 'Tamamlandı işareti' },
  { value: 'pages', label: 'İç sayfalar' },
  { value: 'sticker-count', label: 'Sticker sayısı' },
]

/**
 * Team leader's alt görev editor for one catalog product. Rendered from both
 * Ürün Bilgileri and Ürünler — the leader shouldn't have to switch pages to
 * give a product the checklist its designer will work from, and an imported
 * backlist product (origin='legacy') arrives with no subtasks at all, so the
 * catalog is exactly where that gap shows up.
 *
 * The leader owns the SHAPE of the list (which subtasks exist, their kind,
 * totals and assignment); designers own per-row state (done, counters,
 * needs_revize) through their own endpoints. That split is why this saves via
 * `PUT /projects/:id/subtasks` and why it echoes each row's current `is_done`
 * back unchanged — the endpoint writes that column, so dropping it here would
 * silently reset the designers' progress on every save.
 *
 * Loads lazily: mount it only once its card/row is expanded, so opening a page
 * full of products doesn't fire a request per product.
 *
 * Adding subtasks to a product already at an orderable stage does NOT drop its
 * progress bar — `progressFor` pins every stage in STAGES_REQUIRING_FULL_PROGRESS
 * at 100, so a fresh unchecked list can't repaint a finished book as overdue.
 */
export default function ProductSubtaskEditor({ projectId, designers = [] }) {
  const [rows, setRows] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getProject(projectId)
      .then((p) => { if (!cancelled) setRows(p.subtasks ?? []) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [projectId])

  const list = draft ?? rows
  const editing = draft !== null
  const set = (i, patch) => setDraft((d) => d.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  async function save() {
    setSaving(true)
    try {
      // Send only what the endpoint's schema accepts. `id` keeps a renamed row
      // matched to its original (and so keeps its notes); `is_done` is echoed
      // so the save doesn't clear designer progress.
      const payload = draft
        .filter((s) => String(s.title ?? '').trim())
        .map((s) => ({
          ...(s.id ? { id: s.id } : {}),
          title: s.title.trim(),
          kind: s.kind ?? 'check',
          total_pages: s.kind === 'pages' ? (Number(s.total_pages) || null) : null,
          total_stickers: s.kind === 'sticker-count' ? (Number(s.total_stickers) || null) : null,
          is_done: !!s.is_done,
          assigned_to: s.assigned_to ?? null,
        }))
      await api.saveProjectSubtasks(projectId, payload)
      // Re-read rather than trusting the reply: the endpoint returns the raw
      // inserted rows (RETURNING *), which have no joined `assigned_name`, so
      // using them directly would blank out every designer name until reload.
      const fresh = await api.getProject(projectId)
      setRows(fresh.subtasks ?? [])
      setDraft(null)
      toast.success('Alt görevler kaydedildi.')
    } catch (err) {
      toast.error(err?.message || 'Alt görevler kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  if (rows === null) return <Skeleton className="mt-3 h-16" />

  return (
    <div className="mt-4 rounded-xl border border-dashed bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          Alt Görevler {list.length > 0 && `· ${list.length}`}
        </span>
        {editing ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft([...draft, { title: '', kind: 'check', is_done: false, assigned_to: null }])}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-primary/40 bg-background px-2.5 py-1.5 text-xs font-semibold text-primary transition active:scale-95 hover:bg-primary/5"
            >
              <Plus className="h-3.5 w-3.5" /> Görev Ekle
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition active:scale-95 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> İptal
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition active:scale-95 hover:brightness-105 disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDraft(deepCopy(rows))}
            className="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition active:scale-95 hover:border-primary/40 hover:text-primary"
          >
            <Pencil className="h-3.5 w-3.5" /> Düzenle
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          Bu ürün için alt görev tanımlı değil.
        </p>
      ) : (
        <div className="space-y-1.5">
          {list.map((s, i) => (
            <div key={s.id ?? i} className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
              {editing ? (
                <>
                  <input
                    value={s.title ?? ''}
                    onChange={(e) => set(i, { title: e.target.value })}
                    placeholder="Görev adı"
                    className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[13px] outline-none focus:border-primary/50"
                  />
                  <select
                    value={s.kind ?? 'check'}
                    onChange={(e) => set(i, { kind: e.target.value })}
                    className="rounded-md border bg-background px-1.5 py-1 text-xs"
                  >
                    {SUBTASK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  {(s.kind === 'pages' || s.kind === 'sticker-count') && (
                    <input
                      type="number"
                      min={1}
                      value={(s.kind === 'pages' ? s.total_pages : s.total_stickers) ?? ''}
                      onChange={(e) => set(i, s.kind === 'pages'
                        ? { total_pages: e.target.value }
                        : { total_stickers: e.target.value })}
                      placeholder="Toplam"
                      className="w-20 rounded-md border px-2 py-1 text-xs"
                    />
                  )}
                  <select
                    value={s.assigned_to ?? ''}
                    onChange={(e) => set(i, { assigned_to: e.target.value || null })}
                    className="rounded-md border bg-background px-1.5 py-1 text-xs"
                  >
                    <option value="">Projedeki tasarımcı</option>
                    {designers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setDraft(draft.filter((_, idx) => idx !== i))}
                    title="Görevi sil"
                    className="rounded-md p-1 text-destructive transition active:scale-95 hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-[13px]">{s.title}</span>
                  {s.needs_revize && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-600/20">
                      revize
                    </span>
                  )}
                  {s.assigned_name && (
                    <span className="text-[11px] text-muted-foreground">{s.assigned_name}</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
