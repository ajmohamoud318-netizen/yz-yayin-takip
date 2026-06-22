import { useEffect, useState } from 'react'
import { ShoppingCart, Package, CheckCircle2, Plus, Eye, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

import api, { TYPE_LABELS, STAGE_LABELS, ORDER_STEP_LABELS } from '@/api'
import { getComponentsForProject } from '@/data/productCatalog'
import { storeOrderAdet } from '@/data/orderAdet'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { TalepHistoryViewer } from '@/components/TalepSignDialog'
import { cn } from '@/lib/utils'

const STATUS_BADGE = {
  pending:        'bg-amber-50 text-amber-700 border-amber-200',
  goruldu:        'bg-blue-50 text-blue-700 border-blue-200',
  tasarimci_onay: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  matbaa_onay:    'bg-violet-50 text-violet-700 border-violet-200',
  onaylandi:      'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const STEP_ORDER = ['pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']

export default function SiparisListesi() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewOrder, setViewOrder] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [productsOpen, setProductsOpen] = useState(true)

  useEffect(() => {
    Promise.all([api.listProjects(), api.listOrderRequests()])
      .then(([projs, reqs]) => {
        const ORDERABLE = new Set(['uretime_hazir', 'uretimde', 'gumruk', 'satista'])
        setProducts(projs.filter((p) => ORDERABLE.has(p.stage)))
        setRequests(reqs.filter((r) => r.requested_by === user?.id || r.requested_by === 'u-esra'))
      })
      .finally(() => setLoading(false))
  }, [user?.id, refreshTick])

  // Pick up catalog changes made in another tab / page (Ürün Bilgileri)
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'yz_product_info_overrides_v1') setRefreshTick((t) => t + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function refreshProducts() {
    setRefreshTick((t) => t + 1)
  }

  function handleRequested(newReq) {
    setRequests((prev) => [newReq, ...prev])
    setDialogOpen(false)
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sipariş Talebi</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Satışta olan ürünleri görüntüleyin ve sipariş talebi oluşturun.
            </p>
          </div>
          <Button onClick={() => { refreshProducts(); setDialogOpen(true) }}>
            <Plus className="h-4 w-4" />
            Sipariş Oluştur
          </Button>
        </header>

        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        {/* Product grid */}
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setProductsOpen((v) => !v)}
            aria-expanded={productsOpen}
            className="flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                productsOpen && 'rotate-180',
              )}
            />
            Mevcut Ürünler — {products.length} ürün
          </button>
          {productsOpen && (
            products.length === 0 ? (
              <Card>
                <CardContent className="p-10 text-center text-sm text-muted-foreground">
                  Şu anda satışta ürün bulunmuyor.
                </CardContent>
              </Card>
            ) : (
              <ol className="divide-y overflow-hidden rounded-lg border bg-white">
                {products.map((p, i) => (
                  <ProductRow key={p.id} project={p} index={i + 1} />
                ))}
              </ol>
            )
          )}
        </section>

        {/* My requests with mini-pipeline progress */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Taleplerim
            {pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                {pendingCount} beklemede
              </span>
            )}
          </h2>
          {requests.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                Henüz sipariş talebiniz yok.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <RequestRow key={r.id} request={r} onView={() => setViewOrder(r)} />
              ))}
            </div>
          )}
        </section>
        </div>
      </div>

      <OrderRequestDialog
        products={products}
        user={user}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmitted={handleRequested}
      />

      <TalepHistoryViewer
        order={viewOrder}
        open={!!viewOrder}
        onOpenChange={(v) => !v && setViewOrder(null)}
      />
    </>
  )
}

function ProductRow({ project, index }) {
  const typeLabel = TYPE_LABELS[project.type] ?? project.type
  const stageLabel = STAGE_LABELS[project.stage] ?? project.stage
  const isSatista = project.stage === 'satista'

  return (
    <li className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
        {index}.
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">
        {project.title.replace(/ \/ /g, ' ')}
      </span>
      <span className={`flex items-center gap-1.5 text-xs ${isSatista ? 'text-emerald-600' : 'text-muted-foreground'}`}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        {stageLabel}
      </span>
      <Badge variant="outline" className="shrink-0 text-[10px]">{typeLabel}</Badge>
    </li>
  )
}

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function RequestRow({ request, onView }) {
  const statusBadge = STATUS_BADGE[request.status] ?? ''
  const statusLabel = ORDER_STEP_LABELS[request.status] ?? request.status
  const date = request.created_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(request.created_at))
    : '—'
  const items = normalizeItems(request.items, request.quantity)
  const completedSteps = (request.order_history ?? []).length
  const totalSteps = STEP_ORDER.length

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onView() } }}
      className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardContent className="p-3">
        <div className="flex flex-wrap items-start gap-3">
          <Package className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{request.project_title?.replace(/ \/ /g, ' ')}</p>
            {items.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <span key={item.name} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground">· {item.quantity.toLocaleString('tr-TR')} adet</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-xs">
                <span className="font-medium text-foreground">{request.quantity?.toLocaleString('tr-TR')} adet</span>
              </p>
            )}
            {request.notes && <p className="mt-1 text-xs text-muted-foreground">{request.notes}</p>}

            {/* Mini-pipeline progress */}
            <div className="mt-2 flex items-center gap-1">
              {STEP_ORDER.map((step, i) => {
                const done = (request.order_history ?? []).some((h) => h.step === step)
                return (
                  <div key={step} className="flex items-center">
                    <div className={cn('h-2 w-2 rounded-full', done ? 'bg-emerald-500' : 'bg-muted-foreground/20')} />
                    {i < STEP_ORDER.length - 1 && (
                      <span className={cn('mx-0.5 h-px w-3 shrink-0', done ? 'bg-emerald-300' : 'bg-border')} />
                    )}
                  </div>
                )
              })}
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                {completedSteps}/{totalSteps}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant="outline" className={cn('text-[10px]', statusBadge)}>{statusLabel}</Badge>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{date}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); onView() }}>
                <Eye className="h-3 w-3" />
                Form
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OrderRequestDialog({ products, user, open, onOpenChange, onSubmitted }) {
  const [selectedProductId, setSelectedProductId] = useState('')
  const [itemQtys, setItemQtys] = useState({})
  const [singleQty, setSingleQty] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const components = getComponentsForProject(selectedProductId).map((c) => c.component)
  const hasComponents = components.length > 0
  const selectedProduct = products.find((p) => p.id === selectedProductId)

  // Live recompute on catalog changes (Ürün Bilgileri edits in any tab)
  const [, force] = useState(0)
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'yz_product_info_overrides_v1') force((n) => n + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!open) {
      setSelectedProductId('')
      setItemQtys({})
      setSingleQty('')
      setNotes('')
    }
  }, [open])

  useEffect(() => {
    const init = {}
    components.forEach((name) => { init[name] = '' })
    setItemQtys(init)
    setSingleQty('')
  }, [selectedProductId])

  function applyToAll(val) {
    const next = {}
    components.forEach((name) => { next[name] = val })
    setItemQtys(next)
  }

  const allFilled = hasComponents
    ? components.every((name) => parseInt(itemQtys[name] || '0', 10) > 0)
    : parseInt(singleQty, 10) > 0

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedProductId) { toast.error('Lütfen bir ürün seçin.'); return }

    let items, quantity
    if (hasComponents) {
      const invalid = components.some((name) => parseInt(itemQtys[name] || '0', 10) <= 0)
      if (invalid) { toast.error('Tüm kalemler için geçerli adet giriniz.'); return }
      items = components.map((name) => ({ name, quantity: parseInt(itemQtys[name], 10) }))
      quantity = Math.max(...items.map((i) => i.quantity))
    } else {
      quantity = parseInt(singleQty, 10)
      if (!quantity || quantity <= 0) { toast.error('Geçerli bir adet giriniz.'); return }
      items = []
    }

    setSaving(true)
    try {
      const created = await api.createOrderRequest({
        projectId: selectedProductId,
        projectTitle: selectedProduct?.title ?? selectedProductId,
        items,
        quantity,
        notes: notes.trim(),
        requester: user ? { id: user.id, name: user.name, role: user.role } : null,
      })
      storeOrderAdet(selectedProductId, items, quantity)
      toast.success('Sipariş talebiniz gönderildi.')
      onSubmitted?.(created)
    } catch (err) {
      toast.error(err.message || 'Talep gönderilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Sipariş Oluştur
          </DialogTitle>
          <DialogDescription>
            Ürün seçin ve kalem adetlerini girin. Talebiniz onay sürecine alınacak.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Ürün *</Label>
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Ürün seçin…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title.replace(/ \/ /g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasComponents && (
            <div className="space-y-2">
              <Label>Kalem Adetleri *</Label>
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <Input
                  type="number"
                  min="1"
                  placeholder="Tümüne uygula…"
                  className="h-7 w-full border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                  onChange={(e) => applyToAll(e.target.value)}
                />
                <span className="shrink-0 text-xs text-muted-foreground">tümüne</span>
              </div>
              <div className="divide-y rounded-lg border">
                {components.map((name) => (
                  <div key={name} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 text-sm font-medium">{name}</span>
                    <Input
                      type="number"
                      min="1"
                      className="h-8 w-24 text-right"
                      placeholder="Adet"
                      value={itemQtys[name] ?? ''}
                      onChange={(e) => setItemQtys((prev) => ({ ...prev, [name]: e.target.value }))}
                    />
                    <span className="w-7 shrink-0 text-xs text-muted-foreground">adet</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasComponents && selectedProductId && (
            <div className="space-y-1.5">
              <Label htmlFor="qty">Adet *</Label>
              <Input
                id="qty"
                type="number"
                min="1"
                placeholder="Örn: 500"
                value={singleQty}
                onChange={(e) => setSingleQty(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Not</Label>
            <Input
              id="notes"
              placeholder="Teslim tarihi, aciliyet vb."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={saving || !selectedProductId || !allFilled}>
              {saving ? 'Gönderiliyor…' : 'Talebi Gönder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
