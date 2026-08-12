import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, Plus, Package } from 'lucide-react'

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
import PromoteArchiveDialog from '@/components/PromoteArchiveDialog'
import { listArchiveSeeds } from '@/data/productCatalog'
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
 */
export default function Urunler() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [orderProductId, setOrderProductId] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)
  // Every project id that exists, at any stage — used to work out which archive
  // specs haven't been promoted yet. Kept separate from `products` (which is
  // filtered to the orderable stages) so a seed already promoted to, say,
  // Tasarım still counts as taken.
  const [allProjectIds, setAllProjectIds] = useState([])
  const [promoteOpen, setPromoteOpen] = useState(false)

  const canOrderRole = user?.role === 'satis'
  // The team leader owns the catalog's data integrity (same gate as editing
  // Ürün Bilgileri), so they're the one who can add archive products here.
  const canAddArchive = canEditProductInfo(user)

  useEffect(() => {
    api.listProjects()
      .then((projs) => {
        setProducts(projs.filter((p) => ORDERABLE_STAGES.has(p.stage)))
        setAllProjectIds(projs.map((p) => p.id))
      })
      .finally(() => setLoading(false))
  }, [refreshTick])

  // Archive (REÇETE.xlsx) specs with no project behind them yet. These are what
  // the "Arşivden Ürün Ekle" button offers; once promoted they drop out of this
  // list and appear in the catalog below.
  const archiveSeeds = useMemo(
    () => (canAddArchive ? listArchiveSeeds(allProjectIds) : []),
    [canAddArchive, allProjectIds],
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

  const orderableProducts = products.filter((p) => canRequestOrder(p))

  // Two buckets sales thinks in: work that's finished but not yet sold
  // through (still worth reordering ahead of running out) vs. products
  // that have already reached Satışta. Both are orderable; the split is
  // purely about scanability.
  const readyProducts = products.filter((p) => p.stage !== 'satista')
  const madeProducts = products.filter((p) => p.stage === 'satista')

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
              Sipariş verilebilecek tüm ürünler — {products.length} ürün
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
            {canAddArchive && (
              <Button
                variant="outline"
                onClick={() => setPromoteOpen(true)}
                className="w-full sm:w-auto"
                title="Sistemden önce yayımlanmış ürünleri kataloğa ekle"
              >
                <Package className="h-4 w-4" />
                Arşivden Ürün Ekle
                {archiveSeeds.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                    {archiveSeeds.length}
                  </span>
                )}
              </Button>
            )}
            {canOrderRole && (
              <Button onClick={() => openOrderFor(null)} className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                Sipariş Oluştur
              </Button>
            )}
          </div>
        </header>

        {products.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Şu anda sipariş verilebilecek ürün bulunmuyor.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <ProductGroup
              title="Sipariş İçin Hazır"
              hint="Üretimi tamamlanmış, henüz satışı bitmemiş"
              products={readyProducts}
              canOrderRole={canOrderRole}
              onOrder={openOrderFor}
            />
            <ProductGroup
              title="Halihazırda Satışta"
              hint="Daha önce üretilmiş, satışa çıkmış"
              products={madeProducts}
              canOrderRole={canOrderRole}
              onOrder={openOrderFor}
            />
          </div>
        )}
      </div>

      {canAddArchive && (
        <PromoteArchiveDialog
          open={promoteOpen}
          onClose={() => setPromoteOpen(false)}
          seeds={archiveSeeds}
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

function ProductGroup({ title, hint, products, canOrderRole, onOrder }) {
  if (products.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} · {products.length}
        </h2>
        <span className="text-xs text-muted-foreground/70">{hint}</span>
      </div>
      <ol className="divide-y overflow-hidden rounded-lg border bg-white">
        {products.map((p, i) => (
          <ProductRow
            key={p.id}
            project={p}
            index={i + 1}
            showOrderAction={canOrderRole}
            canOrder={canRequestOrder(p)}
            onOrder={() => onOrder(p.id)}
          />
        ))}
      </ol>
    </section>
  )
}

function ProductRow({ project, index, onOrder, canOrder, showOrderAction }) {
  const typeLabel = TYPE_LABELS[project.type] ?? project.type
  const stageLabel = STAGE_LABELS[project.stage] ?? project.stage
  const stageStyle = STATUS_STYLES[statusKeyForProject(project)]
  const hasSpec = !!project.has_product_info

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
        {index}.
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">
        {project.title.replace(/ \/ /g, ' ')}
      </span>
      {hasSpec ? (
        <span className="hidden items-center gap-1.5 text-xs text-emerald-600 sm:flex">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Ürün bilgisi var
        </span>
      ) : (
        <span className="hidden items-center gap-1.5 text-xs text-amber-600 sm:flex" title="Sipariş verilmeden önce takım lideri Ürün Bilgileri'ni doldurmalı">
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
            title="Sipariş talebi oluştur"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Plus className="h-3 w-3" />
            Sipariş
          </button>
        ) : (
          <span
            className="shrink-0 cursor-not-allowed rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
            title="Sipariş verilmeden önce Ürün Bilgileri'nde kaydı olmalı"
          >
            Sipariş veremezsiniz
          </span>
        )
      )}
    </li>
  )
}
