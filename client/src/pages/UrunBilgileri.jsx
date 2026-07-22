import { useMemo, useState, useEffect } from 'react'
import { Package, Search, BookOpen, ChevronDown, Pencil, Plus, X, Check, Box, CornerDownRight, Trash2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useProjects } from '@/hooks/useProjects'
import { useAuth } from '@/hooks/useAuth'
import { canEditProductInfo } from '@/domain'
import { TYPE_LABELS } from '@/api'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import PRODUCT_INFO from '@/data/productInfo'

const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR')

/* ---- local override persistence (per browser) ---- */
const LS_KEY = 'yz_product_info_overrides_v1'
const deepCopy = (x) => JSON.parse(JSON.stringify(x))
function loadOverrides() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) ?? {}
  } catch {
    return {}
  }
}
function saveOverrides(o) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(o))
  } catch {
    /* ignore quota */
  }
}

/* ---------- read-only spec row (definition-list: key / value) ---------- */
function SheetRow({ label, value }) {
  return (
    <div className="grid grid-cols-[minmax(6.5rem,10rem)_1fr] gap-x-4 px-4 py-2.5 transition-colors hover:bg-primary/[0.025]">
      <dt className="pt-px text-[11px] font-semibold uppercase leading-snug tracking-wide text-muted-foreground">{up(label)}</dt>
      <dd className="whitespace-pre-wrap text-[13px] font-medium leading-snug text-foreground tabular-nums">{value}</dd>
    </div>
  )
}

/* ---------- read-only component spec sheet (mirrors the Demo/Ozalit form) ---------- */
function SpecSheet({ comp }) {
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
function EditableSheetRow({ label, value, onLabel, onValue, onRemove }) {
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
        className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition active:scale-90 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/row:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/* ---------- editable component spec sheet ---------- */
function EditableSpecSheet({ comp, onChange }) {
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
      <div className="border-t border-dashed px-4 py-2.5">
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

/* ---------- new product dialog ---------- */
function NewProductDialog({ open, onClose, projects, onCreate }) {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (open) {
      setProjectId('')
      setTitle('')
    }
  }, [open])

  if (!open) return null

  const submit = () => {
    if (!projectId) {
      toast.error('Lütfen bir proje seçin.')
      return
    }
    const cleanTitle = title.trim() || projects.find((p) => p.id === projectId)?.title || 'Yeni Ürün'
    onCreate(projectId, cleanTitle)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 px-4 animate-in fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold">Yeni Ürün</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition active:scale-90 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Proje
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
            >
              <option value="">— Proje seçin —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Ürün bu projeye bağlanacak ve projedeki parça verilerini gösterecek.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Ürün Başlığı <span className="font-normal opacity-70">(opsiyonel)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Boş bırakırsanız proje adı kullanılır"
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition active:scale-95 hover:text-foreground"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition active:scale-95 hover:brightness-105"
          >
            <Plus className="h-3.5 w-3.5" /> Oluştur
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- product card ---------- */
function ProductCard({ project, comps, open, onToggle, canEdit, editing, draft, onStartEdit, onCancel, onSave, onDraftComp, onDeleteProduct, onAddComponent, index }) {
  const list = editing ? draft : comps
  const multi = list.length > 1

  return (
    <div
      className={cn(
        'group rounded-2xl border bg-card transition-all duration-200 shadow-sm',
        editing
          ? 'border-primary/40 ring-1 ring-primary/15'
          : 'hover:-translate-y-px hover:border-primary/30 hover:shadow-md',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 rounded-2xl p-4 text-left outline-none transition active:scale-[0.997] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="hidden w-7 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground/60 sm:block">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
          <BookOpen className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">{project.title}</p>
        </div>

        {multi && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-600/20 md:inline-flex">
            <Box className="h-3 w-3" />
            {comps.length} parça
          </span>
        )}
        <span className="hidden shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:block">
          {TYPE_LABELS[project.type] ?? project.type}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300', open && 'rotate-180')} />
      </button>

      {/* CSS-only height animation via grid rows */}
      <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="border-t border-dashed bg-muted/15 px-4 pb-4 pt-3.5">
            {canEdit && (
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CornerDownRight className="h-3.5 w-3.5" />
                  {list.length} parça · demo / ozalit verisi
                </span>
                {editing ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onAddComponent}
                      title="Parça ekle"
                      className="inline-flex items-center gap-1 rounded-lg border border-dashed border-primary/40 bg-background px-2.5 py-1.5 text-xs font-semibold text-primary transition active:scale-95 hover:border-primary/60 hover:bg-primary/5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Parça Ekle
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-border" />
                    <button
                      type="button"
                      onClick={onDeleteProduct}
                      title="Ürünü sil"
                      className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-background px-2.5 py-1.5 text-xs font-semibold text-destructive transition active:scale-95 hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Ürünü Sil
                    </button>
                    <button
                      type="button"
                      onClick={onCancel}
                      className="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition active:scale-95 hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" /> İptal
                    </button>
                    <button
                      type="button"
                      onClick={onSave}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition active:scale-95 hover:brightness-105"
                    >
                      <Check className="h-3.5 w-3.5" /> Kaydet
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onStartEdit}
                    className="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition active:scale-95 hover:border-primary/40 hover:text-primary"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Düzenle
                  </button>
                )}
              </div>
            )}

            {/* one spec sheet per component — side by side when a product has multiple parça */}
            <div className={cn(multi ? 'grid grid-cols-1 items-start gap-4 sm:grid-cols-2' : 'space-y-5')}>
              {list.map((c, i) => (
                <div key={i} className="space-y-2.5">
                  {multi && (
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground ring-1 ring-border">
                        <Box className="h-3 w-3 text-primary" />
                        {c.component}
                      </span>
                      {editing && (
                        <button
                          type="button"
                          onClick={() => onDraftComp(i, { __delete: true })}
                          title="Parçayı sil"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-destructive transition active:scale-95 hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3 w-3" /> Parçayı Sil
                        </button>
                      )}
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  {editing ? <EditableSpecSheet comp={c} onChange={(nc) => onDraftComp(i, nc)} /> : <SpecSheet comp={c} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UrunBilgileri() {
  const { projects, loading } = useProjects()
  const { user } = useAuth()
  // Edit rights: team_leader only.
  const canEdit = canEditProductInfo(user)

  const [search, setSearch] = useState('')
  const [openIds, setOpenIds] = useState(() => new Set())
  const [overrides, setOverrides] = useState(loadOverrides)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [newProductOpen, setNewProductOpen] = useState(false)

  const compsFor = (pid) => overrides[pid] ?? PRODUCT_INFO[pid]

  function toggle(id) {
    if (editingId === id) return
    setOpenIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function startEdit(pid) {
    setEditingId(pid)
    setDraft(deepCopy(compsFor(pid)))
    setOpenIds((prev) => new Set(prev).add(pid))
  }
  function cancelEdit() {
    setEditingId(null)
    setDraft(null)
  }
  function saveEdit() {
    const cleaned = (draft ?? []).filter((c) => !c.__delete)
    if (cleaned.length === 0) {
      toast.error('En az bir parça olmalı. Ürünü silmek için "Ürünü Sil" butonunu kullanın.')
      return
    }
    const next = { ...overrides, [editingId]: cleaned }
    setOverrides(next)
    saveOverrides(next)
    setEditingId(null)
    setDraft(null)
    toast.success('Ürün bilgileri kaydedildi.')
  }
  const updateDraftComp = (i, nc) =>
    setDraft((prev) => {
      if (nc?.__delete) return prev.filter((_, idx) => idx !== i)
      return prev.map((c, idx) => (idx === i ? nc : c))
    })

  function addComponent() {
    setDraft((prev) => [
      ...prev,
      { component: 'YENİ PARÇA', date: '', fields: [{ k: '', v: '' }] },
    ])
  }
  function deleteProduct(pid) {
    const next = { ...overrides }
    delete next[pid]
    setOverrides(next)
    saveOverrides(next)
    setEditingId(null)
    setDraft(null)
    toast.success('Ürün silindi.')
  }
  function createProduct(projectId, title) {
    const newComp = {
      component: title,
      date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
      fields: [
        { k: 'İŞİN ADI', v: title },
        { k: 'ADET', v: '' },
        { k: 'EBAT', v: '' },
      ],
    }
    const next = { ...overrides, [projectId]: [newComp] }
    setOverrides(next)
    saveOverrides(next)
    setNewProductOpen(false)
    setOpenIds((prev) => new Set(prev).add(projectId))
    toast.success('Yeni ürün oluşturuldu.')
  }

  const products = useMemo(() => {
    return projects
      .filter((p) => Array.isArray(compsFor(p.id)) && compsFor(p.id).length > 0)
      .map((p) => ({ project: p, comps: compsFor(p.id) }))
      .sort((a, b) => (b.project.updated_at ?? '').localeCompare(a.project.updated_at ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, overrides])

  const totalComponents = useMemo(() => products.reduce((n, x) => n + x.comps.length, 0), [products])

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter(
      (x) => x.project.title.toLowerCase().includes(q) || x.comps.some((c) => c.component.toLowerCase().includes(q)),
    )
  }, [products, search])

  const allOpen = filtered.length > 0 && filtered.every((x) => openIds.has(x.project.id))
  const toggleAll = () => {
    if (editingId) return
    setOpenIds(allOpen ? new Set() : new Set(filtered.map((x) => x.project.id)))
  }

  return (
    <div className="mx-auto max-w-5xl 2xl:max-w-screen-xl 3xl:max-w-[80rem] space-y-8 2xl:space-y-10">
      {/* Editorial header */}
      <header className="flex flex-col gap-5 border-b border-dashed pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Matbaa Takip</span>
          </div>
          <h1 className="text-3xl tracking-tight md:text-4xl">Ürün Bilgileri</h1>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            Her ürünün parçalarına (kitap, kutu, magnet…) ait üretim verileri — demo ve ozalit isteklerinde kullanılan bilgiler
            {canEdit ? '. Her kartı tek tek düzenleyebilirsiniz.' : '.'}
          </p>
        </div>

        {!loading && (
          <div className="flex shrink-0 items-end gap-6">
            <div>
              <div className="font-mono text-3xl font-semibold tabular-nums leading-none text-foreground">{products.length}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">ürün</div>
            </div>
            <div className="h-9 w-px bg-border" />
            <div>
              <div className="font-mono text-3xl font-semibold tabular-nums leading-none text-primary">{totalComponents}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">parça</div>
            </div>
          </div>
        )}
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün veya parça ara…"
            className="w-full rounded-xl border bg-card py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
          />
        </div>

        {filtered.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-xl border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition active:scale-95 hover:text-foreground"
          >
            {allOpen ? 'Tümünü kapat' : 'Tümünü aç'}
          </button>
        )}

        {canEdit && (
          <button
            type="button"
            onClick={() => setNewProductOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition active:scale-95 hover:brightness-105"
          >
            <Plus className="h-4 w-4" /> Yeni Ürün
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3" role="status" aria-label="Ürünler yükleniyor">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Package className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-foreground">{search ? 'Aramaya uyan ürün yok.' : 'Henüz ürün bilgisi yok.'}</p>
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="text-xs font-semibold text-primary transition active:scale-95 hover:underline"
            >
              Aramayı temizle
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(({ project, comps }, idx) => (
            <li
              key={project.id}
              className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300"
              style={{ animationDelay: `${Math.min(idx, 12) * 40}ms` }}
            >
              <ProductCard
                project={project}
                comps={comps}
                index={idx}
                open={openIds.has(project.id)}
                onToggle={() => toggle(project.id)}
                canEdit={canEdit}
                editing={editingId === project.id}
                draft={editingId === project.id ? draft : null}
                onStartEdit={() => startEdit(project.id)}
                onCancel={cancelEdit}
                onSave={saveEdit}
                onDraftComp={updateDraftComp}
                onAddComponent={addComponent}
                onDeleteProduct={() => {
                  if (confirm('Bu ürünü silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) {
                    deleteProduct(project.id)
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <NewProductDialog
        open={newProductOpen}
        onClose={() => setNewProductOpen(false)}
        projects={projects}
        onCreate={createProduct}
      />
    </div>
  )
}
