import { useEffect, useMemo, useState } from 'react'
import { Package, X, Search, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { cn } from '@/lib/utils'

/**
 * Promote archive (backlist) products into the Ürünler catalog.
 *
 * These are REÇETE.xlsx specs with no project behind them (`p-x1`…): they live
 * only in the browser and Sales can't order them. Confirming here calls
 * `POST /api/projects/import`, which creates each one as a real project at a
 * finished stage with `origin: 'legacy'` — see AGENTS.md → "Arşiv (legacy)
 * products".
 *
 * Two modes, one component so the two entry points can't drift:
 *
 *  - **picker** (`seeds` given): the dialog lists every un-promoted archive spec
 *    with search + tick boxes. Used from Ürünler, where the leader hasn't
 *    chosen anything yet.
 *  - **fixed** (`items` given): the selection was already made outside, e.g. the
 *    per-row checkboxes on Ürün Bilgileri. No picker is shown.
 *
 * `type` and `stage` are asked once and applied to the whole selection, because
 * REÇETE.xlsx carries specs only — no TR/ÇİN and no stage to infer them from.
 * ÇİN titles should be promoted as their own pass.
 */
export default function PromoteArchiveDialog({ open, onClose, seeds, items, onDone }) {
  const pickerMode = !items
  const [selected, setSelected] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [type, setType] = useState('TR')
  const [stage, setStage] = useState('satista')
  const [busy, setBusy] = useState(false)

  // Reset every time the dialog opens so a previous run's choices don't leak
  // into the next one.
  useEffect(() => {
    if (open) {
      setSelected(new Set())
      setSearch('')
      setType('TR')
      setStage('satista')
    }
  }, [open])

  const available = useMemo(() => seeds ?? [], [seeds])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return available
    return available.filter((s) => s.title.toLocaleLowerCase('tr-TR').includes(q))
  }, [available, search])

  const chosen = useMemo(
    () => (pickerMode ? available.filter((s) => selected.has(s.id)) : items),
    [pickerMode, available, selected, items],
  )

  if (!open) return null

  const missingSpec = chosen.filter((x) => (x.comps?.length ?? 0) === 0).length
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id))

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const s of filtered) next.delete(s.id)
      } else {
        for (const s of filtered) next.add(s.id)
      }
      return next
    })
  }

  async function submit() {
    if (chosen.length === 0) {
      toast.error('Lütfen en az bir ürün seçin.')
      return
    }
    setBusy(true)
    try {
      // The seed id travels as the project id on purpose: it makes the Ürün
      // Bilgileri archive row convert in place instead of the catalog listing
      // the product twice (once as a seed, once as the new project).
      const payload = chosen.map(({ id, title, comps }) => ({
        id,
        title,
        type,
        stage,
        components: comps ?? [],
      }))
      const res = await api.importProjects(payload)
      const dupes = res?.duplicates?.length ?? 0
      if (res?.willCreate > 0) {
        toast.success(
          `${res.willCreate} ürün Ürünler listesine eklendi.${dupes > 0 ? ` ${dupes} tanesi zaten mevcuttu.` : ''}`,
        )
      } else if (dupes > 0) {
        toast.info('Seçilen ürünler zaten Ürünler listesinde.')
      }
      for (const e of res?.errors ?? []) toast.error(`Satır ${e.row}: ${e.message}`)
      await onDone?.(res)
      onClose?.()
    } catch (e) {
      toast.error(e?.message || 'Ürünler eklenemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 px-4 animate-in fade-in"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Package className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold">Arşivden Ürün Ekle</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Kapat"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition active:scale-90 hover:bg-muted disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Sistemden önce yayımlanmış ürünler. Eklenenler için Satış ekibi sipariş talebi oluşturabilir;
            bu kayıtlar iş akışında (Kanban, Tüm Projeler) görünmez.
          </p>

          {pickerMode && (
            available.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                Eklenecek arşiv ürünü kalmadı — hepsi zaten Ürünler listesinde.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Ürün ara…"
                      className="h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={toggleAllFiltered}
                    className="shrink-0 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition active:scale-95 hover:text-foreground"
                  >
                    {allFilteredSelected ? 'Kaldır' : `Tümünü seç (${filtered.length})`}
                  </button>
                </div>

                <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border bg-background">
                  {filtered.length === 0 ? (
                    <li className="px-3 py-6 text-center text-xs text-muted-foreground">Aramaya uyan ürün yok.</li>
                  ) : (
                    filtered.map((s) => (
                      <li key={s.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-primary/[0.03]',
                            selected.has(s.id) && 'bg-primary/[0.05]',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onChange={() => toggle(s.id)}
                            className="h-4 w-4 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {s.comps.length} parça
                          </span>
                        </label>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )
          )}

          {!pickerMode && (
            <p className="text-sm font-semibold text-foreground">{chosen.length} arşiv ürünü seçildi</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tür
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
              >
                <option value="TR">TR</option>
                <option value="CIN">ÇİN</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Aşama
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
              >
                <option value="satista">Satışta</option>
                <option value="uretime_hazir">Üretime Hazır</option>
                <option value="uretimde">Üretimde</option>
                <option value="gumruk">Gümrük</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tür ve aşama seçilen tüm ürünlere uygulanır. ÇİN ürünlerini ayrı seçip ekleyin.
          </p>

          {missingSpec > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {missingSpec} ürünün parça bilgisi yok — Ürünler listesinde görünür ama Ürün Bilgileri
                girilene kadar sipariş verilemez.
              </span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition active:scale-95 hover:text-foreground disabled:opacity-50"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || chosen.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition active:scale-95 hover:brightness-105 disabled:opacity-60"
          >
            <Package className="h-3.5 w-3.5" />
            {busy ? 'Ekleniyor…' : chosen.length > 0 ? `${chosen.length} ürünü ekle` : 'Ürün seçin'}
          </button>
        </div>
      </div>
    </div>
  )
}
