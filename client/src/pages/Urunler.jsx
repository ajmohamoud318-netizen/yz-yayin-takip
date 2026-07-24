import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Plus } from 'lucide-react'

import api, { TYPE_LABELS, ORDERABLE_STAGES, canRequestOrder } from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import OrderRequestDialog from '@/components/OrderRequestDialog'

/**
 * Catalog of every product that has reached Satışta — visible to all roles
 * for reference, but only Sales (satis) can actually raise an order from it.
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

  const canOrderRole = user?.role === 'satis'

  useEffect(() => {
    api.listProjects()
      .then((projs) => setProducts(projs.filter((p) => ORDERABLE_STAGES.has(p.stage))))
      .finally(() => setLoading(false))
  }, [refreshTick])

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
              Satışa ulaşmış tüm ürünler — {products.length} ürün
            </p>
          </div>
          {canOrderRole && (
            <Button onClick={() => openOrderFor(null)} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Sipariş Oluştur
            </Button>
          )}
        </header>

        {products.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Şu anda satışta ürün bulunmuyor.
            </CardContent>
          </Card>
        ) : (
          <ol className="divide-y overflow-hidden rounded-lg border bg-white">
            {products.map((p, i) => (
              <ProductRow
                key={p.id}
                project={p}
                index={i + 1}
                showOrderAction={canOrderRole}
                canOrder={canRequestOrder(p)}
                onOrder={() => openOrderFor(p.id)}
              />
            ))}
          </ol>
        )}
      </div>

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

function ProductRow({ project, index, onOrder, canOrder, showOrderAction }) {
  const typeLabel = TYPE_LABELS[project.type] ?? project.type
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
