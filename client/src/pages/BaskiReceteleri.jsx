import { useEffect, useMemo, useState } from 'react'
import { FileText, Search, Pencil, Check, X, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useProjects } from '@/hooks/useProjects'
import { useAuth } from '@/hooks/useAuth'
import { canEditProductInfo } from '@/domain'
import api from '@/api'
import { Skeleton } from '@/components/ui/skeleton'
import { SpecSheet, EditableSpecSheet } from '@/components/SpecSheet'
import PRODUCT_INFO from '@/data/productInfo'
import { saveComponentsForProject, primeProductInfoCache } from '@/data/productCatalog'

const deepCopy = (x) => JSON.parse(JSON.stringify(x))

/**
 * Baskı Reçeteleri — a flat, browsable index of every reçete (parça spec
 * sheet) across every product, each tagged with the project it belongs to.
 * Ürün Bilgileri groups reçeteler under a collapsed product card; this page
 * flattens that same data (server: product_info, one row per project
 * holding a components array — see migration 020__product_info.sql) into
 * one row per reçete so the whole set is scannable and searchable without
 * expanding cards one at a time. Same edit rights as Ürün Bilgileri:
 * team_leader only.
 */
export default function BaskiReceteleri() {
  const { allProjects: projects, loading: projectsLoading } = useProjects()
  const { user } = useAuth()
  const canEdit = canEditProductInfo(user)

  const [overrides, setOverrides] = useState({})
  const [infoLoading, setInfoLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingKey, setEditingKey] = useState(null)
  const [draft, setDraft] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.listProductInfo()
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        primeProductInfoCache(rows)
        const fromServer = {}
        for (const r of rows) {
          if (!r?.project_id) continue
          fromServer[r.project_id] = Array.isArray(r.components) ? r.components : []
        }
        setOverrides(fromServer)
      })
      .catch(() => {})
      .finally(() => setInfoLoading(false))
    return () => { cancelled = true }
  }, [])

  const compsFor = (pid) => overrides[pid] ?? PRODUCT_INFO[pid]

  // One row per project (real or seed) that has at least one reçete —
  // mirrors UrunBilgileri's `products` builder exactly, since both read the
  // same product_info data.
  const products = useMemo(() => {
    const realKeys = new Set()
    const real = projects
      .filter((p) => Array.isArray(compsFor(p.id)) && compsFor(p.id).length > 0)
      .map((p) => {
        realKeys.add(p.id)
        return { project: p, comps: compsFor(p.id) }
      })
    const orphanIds = new Set([...Object.keys(PRODUCT_INFO), ...Object.keys(overrides)])
    const orphans = []
    for (const pid of orphanIds) {
      if (realKeys.has(pid)) continue
      const comps = compsFor(pid)
      if (!Array.isArray(comps) || comps.length === 0) continue
      const first = comps[0]
      const fields = first?.fields ?? []
      const titleField = fields.find((f) => f.k === 'İŞİN ADI')?.v
      orphans.push({
        project: { id: pid, title: titleField || first?.component || pid, __seed: true },
        comps,
      })
    }
    return [...real, ...orphans]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, overrides])

  // Flatten every product's comps array into one row per reçete.
  const receteler = useMemo(() => {
    const rows = []
    for (const { project, comps } of products) {
      comps.forEach((comp, index) => {
        rows.push({ key: `${project.id}::${index}`, projectId: project.id, projectTitle: project.title, seed: !!project.__seed, index, comp })
      })
    }
    return rows.sort((a, b) => a.projectTitle.localeCompare(b.projectTitle, 'tr-TR'))
  }, [products])

  const filtered = useMemo(() => {
    if (!search.trim()) return receteler
    const q = search.toLowerCase()
    return receteler.filter(
      (r) => r.projectTitle.toLowerCase().includes(q) || r.comp.component.toLowerCase().includes(q),
    )
  }, [receteler, search])

  function startEdit(row) {
    setEditingKey(row.key)
    setDraft(deepCopy(row.comp))
  }
  function cancelEdit() {
    setEditingKey(null)
    setDraft(null)
  }
  async function saveEdit(row) {
    const projectComps = deepCopy(compsFor(row.projectId) ?? [])
    projectComps[row.index] = draft
    setOverrides((prev) => ({ ...prev, [row.projectId]: projectComps }))
    saveComponentsForProject(row.projectId, projectComps)
    setEditingKey(null)
    setDraft(null)
    toast.success('Reçete kaydedildi.')
  }

  const loading = projectsLoading || infoLoading

  return (
    <div className="mx-auto max-w-5xl 2xl:max-w-screen-xl space-y-8">
      <header className="flex flex-col gap-5 border-b border-dashed pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Matbaa Takip</span>
          </div>
          <h1 className="text-3xl tracking-tight md:text-4xl">Baskı Reçeteleri</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tüm ürünlerdeki reçeteler, projeleriyle birlikte tek listede.</p>
        </div>
        {!loading && (
          <div className="shrink-0">
            <div className="font-mono text-3xl font-semibold tabular-nums leading-none text-primary">{receteler.length}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">reçete</div>
          </div>
        )}
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Reçete veya proje ara…"
          className="w-full rounded-xl border bg-card py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
        />
      </div>

      {loading ? (
        <div className="space-y-3" role="status" aria-label="Reçeteler yükleniyor">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FileText className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-foreground">{search ? 'Aramaya uyan reçete yok.' : 'Henüz reçete yok.'}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {filtered.map((row) => {
            const editing = editingKey === row.key
            return (
              <li key={row.key} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                    <BookOpen className="h-3 w-3 shrink-0" />
                    <span className="truncate">{row.projectTitle}</span>
                    {row.seed && <span className="shrink-0 opacity-70">· Kayıt</span>}
                  </span>
                  {canEdit && (
                    editing ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition active:scale-95 hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" /> İptal
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(row)}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition active:scale-95 hover:brightness-105"
                        >
                          <Check className="h-3.5 w-3.5" /> Kaydet
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="inline-flex items-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition active:scale-95 hover:border-primary/40 hover:text-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Düzenle
                      </button>
                    )
                  )}
                </div>
                {editing ? (
                  <EditableSpecSheet comp={draft} onChange={setDraft} />
                ) : (
                  <SpecSheet comp={row.comp} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
