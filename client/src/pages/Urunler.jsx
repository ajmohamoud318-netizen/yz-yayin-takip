import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, Plus, ListChecks, ChevronDown, EyeOff, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import api, {
  TYPE_LABELS, STAGE_LABELS, ORDERABLE_STAGES, STATUS_STYLES,
  canRequestOrder, statusKeyForProject, canEditProductInfo,
} from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import OrderRequestDialog from '@/components/OrderRequestDialog'
import PromoteRecordDialog from '@/components/PromoteRecordDialog'
import ProductSubtaskEditor from '@/components/ProductSubtaskEditor'
import { listRecordSeeds } from '@/data/productCatalog'
import { cn } from '@/lib/utils'

/**
 * Catalog of every product Sales can raise an order (sipariş) against —
 * everything from "Üretime Hazır" onward (Üretime Hazır, Üretimde, Gümrük,
 * Satışta), grouped into "ready for order" (production finished, not yet
 * fully sold) and "already made" (Satışta). Visible to all roles for
 * reference, but only Sales (satis) can actually raise an order from it.
 * A product missing its Ürün Bilgileri spec is still shown (so nothing
 * silently disappears) but its order action is disabled until the team
 * leader fills that in.
 *
 * The team leader can also "kaldır" a product (`catalog_hidden`, migration
 * 033): it leaves this catalog and Sales can no longer order it, while the
 * project itself — stage, history, dashboards — is untouched. Delisted rows
 * stay visible to the leader in their own section so the action is reversible;
 * every other role simply doesn't see them.
 */
export default function Urunler() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [orderProductId, setOrderProductId] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)
  // Every project id that exists, at any stage — used to work out which kayıt
  // specs haven't been promoted yet. Kept separate from `products` (which is
  // filtered to the orderable stages) so a seed already promoted to, say,
  // Tasarım still counts as taken.
  const [allProjectIds, setAllProjectIds] = useState([])
  const [promoteOpen, setPromoteOpen] = useState(false)

  const canOrderRole = user?.role === 'satis'
  // The team leader owns the catalog's data integrity (same gate as editing
  // Ürün Bilgileri), so they're the one who can add kayıt products here.
  const canAddRecords = canEditProductInfo(user)
  // ...and the one who owns the SHAPE of each product's alt görev list. Same
  // editor as Ürün Bilgileri: a product ordered off this page hands its
  // subtasks to the designer the leader assigns, and an imported backlist
  // product starts with none, so this is where that gets fixed.
  const canManageSubtasks = canAddRecords
  // ...and who may pull a product out of the catalog. Mirrors the server's
  // `requireRole(team_leader)` on POST /projects/:id/catalog.
  const canManageCatalog = canAddRecords
  // Designer roster for the alt görev assignment dropdown. Fetched once for
  // the page rather than per row, and only for the role that can see it.
  const [designers, setDesigners] = useState([])
  // Ids currently in flight through the kaldır/geri al call, so the row's
  // button can disable itself instead of queueing duplicate requests.
  const [catalogBusy, setCatalogBusy] = useState(() => new Set())

  useEffect(() => {
    api.listProjects()
      .then((projs) => {
        setProducts(projs.filter((p) => ORDERABLE_STAGES.has(p.stage)))
        setAllProjectIds(projs.map((p) => p.id))
      })
      .finally(() => setLoading(false))
  }, [refreshTick])

  useEffect(() => {
    if (!canManageSubtasks) return
    let cancelled = false
    api.listUsers()
      .then((users) => {
        if (!cancelled) setDesigners(users.filter((u) => u.role === 'designer' && u.is_active !== false))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [canManageSubtasks])

  // Kayıt (REÇETE.xlsx) specs with no project behind them yet. These are what
  // the "Kayıtlardan Ürün Ekle" button offers; once promoted they drop out of this
  // list and appear in the catalog below.
  const recordSeeds = useMemo(
    () => (canAddRecords ? listRecordSeeds(allProjectIds) : []),
    [canAddRecords, allProjectIds],
  )

  // Pick up Ürün Bilgileri changes made in another tab.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'yz_product_info_overrides_v1') setRefreshTick((t) => t + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function openOrderFor(productId) {
    setRefreshTick((t) => t + 1)
    setOrderProductId(productId)
    setDialogOpen(true)
  }

  /**
   * Kaldır / geri al. Optimistic-free on purpose: the server response is the
   * updated project (with a fresh `has_product_info`), so we drop it straight
   * into state and the row re-renders into the right section — no refetch of
   * the whole catalog, and no risk of the two views disagreeing.
   */
  async function setCatalogHidden(project, hidden) {
    setCatalogBusy((prev) => new Set(prev).add(project.id))
    try {
      const updated = await api.setProductCatalogHidden(project.id, hidden)
      setProducts((prev) => prev.map((p) => (p.id === project.id ? { ...p, ...updated } : p)))
      toast.success(hidden ? 'Ürün katalogdan kaldırıldı.' : 'Ürün katalogda tekrar yayında.')
    } catch (err) {
      toast.error(err?.message || 'İşlem tamamlanamadı.')
    } finally {
      setCatalogBusy((prev) => {
        const next = new Set(prev)
        next.delete(project.id)
        return next
      })
    }
  }

  // Delisted products are catalog rows only the leader still sees. Everyone
  // else — Sales included — gets a catalog that simply doesn't contain them.
  const listedProducts = products.filter((p) => !p.catalog_hidden)
  const hiddenProducts = canManageCatalog ? products.filter((p) => p.catalog_hidden) : []

  const orderableProducts = listedProducts.filter((p) => canRequestOrder(p))

  // Two buckets sales thinks in: work that's finished but not yet sold
  // through (still worth reordering ahead of running out) vs. products
  // that have already reached Satışta. Both are orderable; the split is
  // purely about scanability.
  const readyProducts = listedProducts.filter((p) => p.stage !== 'satista')
  const madeProducts = listedProducts.filter((p) => p.stage === 'satista')

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ürünler</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {listedProducts.length} ürün
              {hiddenProducts.length > 0 && (
                <span className="text-muted-foreground/70"> · {hiddenProducts.length} kaldırıldı</span>
              )}
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
            {canAddRecords && (
              <Button
                variant="outline"
                onClick={() => setPromoteOpen(true)}
                className="w-full sm:w-auto"
                title="Sistemden önce yayımlanmış ürünleri kataloğa ekle"
              >
                Ürün Ekle
                {recordSeeds.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                    {recordSeeds.length}
                  </span>
                )}
              </Button>
            )}
            {canOrderRole && (
              <Button onClick={() => openOrderFor(null)} className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                Baskı Oluştur
              </Button>
            )}
          </div>
        </header>

        {listedProducts.length === 0 && hiddenProducts.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Şu anda baskı verilebilecek ürün bulunmuyor.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <ProductGroup
              title="Baskı İçin Hazır"
              hint="Üretimi tamamlanmış, henüz satışı bitmemiş"
              products={readyProducts}
              canOrderRole={canOrderRole}
              onOrder={openOrderFor}
              canManageSubtasks={canManageSubtasks}
              designers={designers}
              canManageCatalog={canManageCatalog}
              onDelist={(p) => setCatalogHidden(p, true)}
              catalogBusy={catalogBusy}
            />
            <ProductGroup
              title="Halihazırda Satışta"
              hint="Daha önce üretilmiş, satışa çıkmış"
              products={madeProducts}
              canOrderRole={canOrderRole}
              onOrder={openOrderFor}
              canManageSubtasks={canManageSubtasks}
              designers={designers}
              canManageCatalog={canManageCatalog}
              onDelist={(p) => setCatalogHidden(p, true)}
              catalogBusy={catalogBusy}
            />
            {/* Leader-only. Kept on the page rather than behind a separate
                route so "kaldır" reads as reversible at the moment you do it —
                the row moves down here instead of disappearing. */}
            <ProductGroup
              title="Katalogdan Kaldırıldı"
              hint="Satış ekibi göremez, baskı veremez"
              products={hiddenProducts}
              canOrderRole={false}
              onOrder={openOrderFor}
              canManageSubtasks={canManageSubtasks}
              designers={designers}
              canManageCatalog={canManageCatalog}
              onRelist={(p) => setCatalogHidden(p, false)}
              catalogBusy={catalogBusy}
              muted
            />
          </div>
        )}
      </div>

      {canAddRecords && (
        <PromoteRecordDialog
          open={promoteOpen}
          onClose={() => setPromoteOpen(false)}
          seeds={recordSeeds}
          onDone={() => setRefreshTick((t) => t + 1)}
        />
      )}

      {canOrderRole && (
        <OrderRequestDialog
          products={orderableProducts}
          user={user}
          open={dialogOpen}
          initialProductId={orderProductId}
          onOpenChange={setDialogOpen}
          onSubmitted={() => setDialogOpen(false)}
          onBatchSubmitted={() => setDialogOpen(false)}
        />
      )}
    </>
  )
}

function ProductGroup({
  title, hint, products, canOrderRole, onOrder, canManageSubtasks, designers,
  canManageCatalog, onDelist, onRelist, catalogBusy, muted,
}) {
  if (products.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} · {products.length}
        </h2>
        <span className="text-xs text-muted-foreground/70">{hint}</span>
      </div>
      <ol className={cn(
        'divide-y overflow-hidden rounded-lg border bg-white',
        // Delisted rows read as "parked", not as live catalog entries.
        muted && 'border-dashed bg-muted/20',
      )}>
        {products.map((p, i) => (
          <ProductRow
            key={p.id}
            project={p}
            index={i + 1}
            showOrderAction={canOrderRole}
            canOrder={canRequestOrder(p)}
            onOrder={() => onOrder(p.id)}
            canManageSubtasks={canManageSubtasks}
            designers={designers}
            canManageCatalog={canManageCatalog}
            onDelist={onDelist ? () => onDelist(p) : null}
            onRelist={onRelist ? () => onRelist(p) : null}
            busy={!!catalogBusy?.has(p.id)}
            muted={muted}
          />
        ))}
      </ol>
    </section>
  )
}

function ProductRow({
  project, index, onOrder, canOrder, showOrderAction,
  canManageSubtasks, designers,
  canManageCatalog, onDelist, onRelist, busy, muted,
}) {
  const typeLabel = TYPE_LABELS[project.type] ?? project.type
  const stageLabel = STAGE_LABELS[project.stage] ?? project.stage
  const stageStyle = STATUS_STYLES[statusKeyForProject(project)]
  const hasSpec = !!project.has_product_info
  // Collapsed by default, and the editor is mounted only while open: it fetches
  // the project's subtasks on mount, so a 90-product catalog would otherwise
  // fire 90 requests on page load.
  const [subtasksOpen, setSubtasksOpen] = useState(false)

  return (
    <li className="px-3 py-3 sm:px-4">
      {/* One line on ≥sm (title truncates, actions right). On phones the
          title gets its own full-width line — it's the reason the row exists
          — and the badges/actions wrap onto an indented second line. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center gap-2.5 sm:flex-1 sm:gap-3">
          <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
            {index}.
          </span>
          <span className={cn(
            'min-w-0 flex-1 text-sm font-semibold leading-snug sm:truncate',
            muted && 'text-muted-foreground',
          )}>
            {project.title.replace(/ \/ /g, ' ')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-[2.125rem] sm:shrink-0 sm:gap-3 sm:pl-0">
        {hasSpec ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ürün bilgisi var
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-600" title="Baskı verilmeden önce takım lideri Ürün Bilgileri'ni doldurmalı">
            <AlertTriangle className="h-3.5 w-3.5" />
            Ürün bilgisi eksik
          </span>
        )}
        {stageStyle && (
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset', stageStyle.badge)}>
            {stageLabel}
          </span>
        )}
        <Badge variant="outline" className="shrink-0 text-[10px]">{typeLabel}</Badge>
        {showOrderAction && (
          canOrder ? (
            <button
              type="button"
              onClick={onOrder}
              title="Baskı talebi oluştur"
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] sm:py-1 font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <Plus className="h-3 w-3" />
              Baskı
            </button>
          ) : (
            <span
              className="shrink-0 cursor-not-allowed rounded-md bg-muted px-2 py-1.5 text-[11px] sm:py-1 font-medium text-muted-foreground"
              title="Baskı verilmeden önce Ürün Bilgileri'nde kaydı olmalı"
            >
              Baskı veremezsiniz
            </span>
          )
        )}
        {/* Alt görevler — team leader only. This is the checklist the designer
            works from once Sales orders the product and the leader assigns them
            (PATCH /order-requests/:id/advance), and an imported backlist product
            arrives with none, so it's editable straight from the catalog rather
            than only from Ürün Bilgileri. */}
        {canManageSubtasks && (
          <button
            type="button"
            onClick={() => setSubtasksOpen((v) => !v)}
            aria-expanded={subtasksOpen}
            title="Bu ürünün alt görevlerini düzenle"
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] sm:py-1 font-semibold transition-colors',
              subtasksOpen
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )}
          >
            <ListChecks className="h-3 w-3" />
            Alt Görevler
            <ChevronDown className={cn('h-3 w-3 transition-transform', subtasksOpen && 'rotate-180')} />
          </button>
        )}
        {/* Kaldır / Geri Al — team leader only. No confirm dialog: the action is
            reversible in one click from the section right below, so a modal would
            cost more than the misclick it prevents. */}
        {canManageCatalog && onDelist && (
          <button
            type="button"
            onClick={onDelist}
            disabled={busy}
            title="Ürünü katalogdan kaldır, satış ekibi artık baskı veremez"
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] sm:py-1 font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <EyeOff className="h-3 w-3" />
            Kaldır
          </button>
        )}
        {canManageCatalog && onRelist && (
          <button
            type="button"
            onClick={onRelist}
            disabled={busy}
            title="Ürünü katalogda tekrar yayına al"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] sm:py-1 font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
          >
            <Undo2 className="h-3 w-3" />
            Geri Al
          </button>
        )}
        </div>
      </div>

      {canManageSubtasks && subtasksOpen && (
        <ProductSubtaskEditor projectId={project.id} designers={designers} />
      )}
    </li>
  )
}
