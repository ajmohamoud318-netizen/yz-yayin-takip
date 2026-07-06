import { useEffect, useRef, useState } from 'react'
import { ShoppingCart, Package, CheckCircle2, Plus, Eye, ChevronDown, FileSpreadsheet, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

import api, { TYPE_LABELS, STAGE_LABELS, ORDER_STEP_LABELS, canRequestOrder } from '@/api'
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
  // When the dialog is opened by clicking a product row, this holds that
  // product's id so the dialog jumps straight to the quantity step for it.
  // null = opened via the top button (starts on the Excel-upload step).
  const [orderProductId, setOrderProductId] = useState(null)
  const [viewOrder, setViewOrder] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [productsOpen, setProductsOpen] = useState(true)

  function openOrderFor(productId) {
    refreshProducts()
    setOrderProductId(productId)
    setDialogOpen(true)
  }

  useEffect(() => {
    Promise.all([api.listProjects(), api.listOrderRequests()])
      .then(([projs, reqs]) => {
        // Sales can only order products that have reached the Satışta stage.
        setProducts(projs.filter((p) => canRequestOrder(p)))
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

  function handleBatchRequested(newReqs) {
    setRequests((prev) => [...[...newReqs].reverse(), ...prev])
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
          <Button onClick={() => openOrderFor(null)}>
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
                  <ProductRow key={p.id} project={p} index={i + 1} onOrder={() => openOrderFor(p.id)} />
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
        initialProductId={orderProductId}
        onOpenChange={setDialogOpen}
        onSubmitted={handleRequested}
        onBatchSubmitted={handleBatchRequested}
      />

      <TalepHistoryViewer
        order={viewOrder}
        open={!!viewOrder}
        onOpenChange={(v) => !v && setViewOrder(null)}
      />
    </>
  )
}

function ProductRow({ project, index, onOrder }) {
  const typeLabel = TYPE_LABELS[project.type] ?? project.type
  const stageLabel = STAGE_LABELS[project.stage] ?? project.stage
  const isSatista = project.stage === 'satista'

  return (
    <li>
      <button
        type="button"
        onClick={onOrder}
        title="Sipariş talebi oluştur"
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
          {index}.
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">
          {project.title.replace(/ \/ /g, ' ')}
        </span>
        <span className={`hidden items-center gap-1.5 text-xs sm:flex ${isSatista ? 'text-emerald-600' : 'text-muted-foreground'}`}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {stageLabel}
        </span>
        <Badge variant="outline" className="shrink-0 text-[10px]">{typeLabel}</Badge>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          <Plus className="h-3 w-3" />
          Sipariş
        </span>
      </button>
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

// ── Excel helpers ─────────────────────────────────────────────────────────────

function normTR(s) {
  return String(s ?? '')
    .replace(/İ/g, 'i').replace(/Ç/g, 'c').replace(/Ş/g, 's')
    .replace(/Ğ/g, 'g').replace(/Ö/g, 'o').replace(/Ü/g, 'u')
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .trim()
}

function matchScore(a, b) {
  const na = normTR(a), nb = normTR(b)
  if (!na || !nb) return 0
  if (na === nb) return 100
  if (na.includes(nb) || nb.includes(na)) return 60
  const words = na.split(/[\s\-_/,]+/).filter(Boolean)
  const setB = new Set(nb.split(/[\s\-_/,]+/).filter(Boolean))
  return words.filter((w) => setB.has(w)).length * 15
}

async function parseExcelFile(file) {
  const mod = await import('xlsx')
  const XLSX = mod.default ?? mod   // CJS interop: utils lives on .default
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  const rows = raw.filter((r) => r.some((c) => String(c).trim() !== ''))
  if (rows.length === 0) throw new Error('Dosya boş.')

  const toNum = (v) => parseInt(String(v).replace(/[.\s]/g, '').replace(',', '.'), 10)
  const isNum = (v) => !isNaN(toNum(v)) && toNum(v) > 0

  // Look for a product title in the first few cells
  let detectedProductName = null
  for (let i = 0; i < Math.min(3, rows.length) && !detectedProductName; i++) {
    for (const cell of rows[i]) {
      const s = String(cell).trim()
      if (s.length > 5 && !isNum(s)) { detectedProductName = s; break }
    }
  }

  const firstRow = rows[0]

  // Keywords that identify a tall-format header row (e.g. "Ürün Adı" / "Baskı Adedi")
  const kwQty = ['adet', 'adedi', 'miktar', 'baski', 'basim', 'quantity', 'amount', 'qty', 'sayi']
  const kwName = ['urun', 'ad', 'isim', 'kalem', 'bilesim', 'name', 'component', 'aciklama', 'tanim']

  // If the first row contains column-label keywords it IS a tall-format header —
  // skip wide-format detection entirely so we never treat "ÜRÜN ADI" as a component name.
  const hasTallHeader = firstRow.some((h) => {
    const s = normTR(String(h))
    return kwQty.some((k) => s.includes(k)) || kwName.some((k) => s.includes(k))
  })

  // ── Wide format: header row = component names, data row(s) = quantities ──
  const stringCols = firstRow.filter((c) => String(c).trim().length > 1 && !isNum(c))
  if (!hasTallHeader && stringCols.length >= 2 && rows.length >= 2) {
    for (let i = 1; i < rows.length; i++) {
      const numCols = rows[i].filter((c) => isNum(c))
      if (numCols.length >= 2) {
        const pairs = []
        firstRow.forEach((header, col) => {
          const name = String(header).trim()
          if (!name || isNum(name)) return
          const qty = toNum(rows[i][col])
          if (qty > 0) pairs.push({ name, quantity: qty })
        })
        if (pairs.length > 0) return { pairs, detectedProductName }
      }
    }
  }

  // ── Tall format: each row = (name, quantity) ──────────────────────────────
  let nameCol = -1, qtyCol = -1

  firstRow.forEach((h, i) => {
    const s = normTR(String(h))
    if (kwQty.some((k) => s.includes(k)) && qtyCol === -1) qtyCol = i
    if (kwName.some((k) => s.includes(k)) && nameCol === -1) nameCol = i
  })

  const startRow = nameCol !== -1 || qtyCol !== -1 ? 1 : 0

  if (nameCol === -1 || qtyCol === -1) {
    const sample = rows[startRow] ?? []
    sample.forEach((c, i) => {
      if (isNum(c) && qtyCol === -1) qtyCol = i
      else if (!isNum(c) && String(c).trim() && nameCol === -1) nameCol = i
    })
  }
  if (nameCol === -1) nameCol = 0
  if (qtyCol === -1) qtyCol = 1

  const pairs = []
  for (const row of rows.slice(startRow)) {
    const name = String(row[nameCol] ?? '').trim()
    const qty = toNum(row[qtyCol])
    if (name && qty > 0) pairs.push({ name, quantity: qty })
  }

  if (pairs.length === 0)
    throw new Error("Excel'den adet verisi okunamadı. A sütunu: kalem adı, B sütunu: adet.")
  return { pairs, detectedProductName }
}

// ─────────────────────────────────────────────────────────────────────────────

function OrderRequestDialog({ products, user, open, initialProductId, onOpenChange, onSubmitted, onBatchSubmitted }) {
  const [step, setStep] = useState('upload') // 'upload' | 'confirm' | 'batch'
  const [dragOver, setDragOver] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [itemQtys, setItemQtys] = useState({})
  const [singleQty, setSingleQty] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [excelLoading, setExcelLoading] = useState(false)
  const [excelFilled, setExcelFilled] = useState(new Set())
  const skipQtyResetRef = useRef(false)
  const fileInputRef = useRef(null)
  const dragCountRef = useRef(0)
  const [batchRows, setBatchRows] = useState([]) // [{ product, qty, modified }]
  const [batchUnmatched, setBatchUnmatched] = useState([])
  const [batchNotes, setBatchNotes] = useState('')
  const [batchSaving, setBatchSaving] = useState(false)

  const components = getComponentsForProject(selectedProductId).map((c) => c.component)
  const hasComponents = components.length > 0
  const selectedProduct = products.find((p) => p.id === selectedProductId)

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
      setStep('upload')
      setDragOver(false)
      dragCountRef.current = 0
      setSelectedProductId('')
      setItemQtys({})
      setSingleQty('')
      setNotes('')
      setExcelFilled(new Set())
      setBatchRows([])
      setBatchUnmatched([])
      setBatchNotes('')
    }
  }, [open])

  useEffect(() => {
    if (skipQtyResetRef.current) { skipQtyResetRef.current = false; return }
    const init = {}
    components.forEach((name) => { init[name] = '' })
    setItemQtys(init)
    setSingleQty('')
    setExcelFilled(new Set())
  }, [selectedProductId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opened by clicking a product row → preselect it and skip the Excel-upload
  // step, landing directly on the quantity form so Sales just types the amount.
  useEffect(() => {
    if (open && initialProductId) {
      setSelectedProductId(initialProductId)
      setStep('confirm')
    }
  }, [open, initialProductId])

  function applyToAll(val) {
    const next = {}
    components.forEach((name) => { next[name] = val })
    setItemQtys(next)
    setExcelFilled(new Set())
  }

  async function processFile(file) {
    setExcelLoading(true)
    try {
      const { pairs } = await parseExcelFile(file)

      // Match each pair to a product, deduplicating by product ID
      const matchedMap = new Map()
      const unmatchedPairs = []
      for (const pair of pairs) {
        let bestProduct = null, bestScore = 0
        for (const product of products) {
          const s = matchScore(product.title, pair.name)
          if (s > bestScore) { bestScore = s; bestProduct = product }
        }
        if (bestScore >= 15 && bestProduct) {
          if (!matchedMap.has(bestProduct.id)) {
            matchedMap.set(bestProduct.id, { product: bestProduct, primaryQty: pair.quantity })
          }
        } else {
          unmatchedPairs.push(pair)
        }
      }

      const matchedList = [...matchedMap.values()]

      if (matchedList.length === 0) {
        toast.error("Excel'deki ürünler katalogda bulunamadı.")
        return
      }

      if (matchedList.length > 1) {
        // Batch mode: multiple distinct products detected
        setBatchRows(matchedList.map(({ product, primaryQty }) => ({
          product, qty: primaryQty, modified: false,
        })))
        setBatchUnmatched(unmatchedPairs)
        setBatchNotes('')
        if (unmatchedPairs.length > 0) {
          toast.warning(`${unmatchedPairs.length} satır katalogda bulunamadı.`)
        }
        setStep('batch')
        return
      }

      // Single product flow
      const { product, primaryQty: fallbackQty } = matchedList[0]
      skipQtyResetRef.current = true
      setSelectedProductId(product.id)

      const comps = getComponentsForProject(product.id).map((c) => c.component)
      if (comps.length > 0) {
        const newQtys = {}
        const filled = new Set()
        comps.forEach((comp) => { newQtys[comp] = '' })
        for (const comp of comps) {
          let best = { pair: null, score: 0 }
          for (const pair of pairs) {
            const s = matchScore(comp, pair.name)
            if (s > best.score) best = { pair, score: s }
          }
          if (best.score >= 15 && best.pair) {
            newQtys[comp] = String(best.pair.quantity); filled.add(comp)
          } else {
            newQtys[comp] = String(fallbackQty); filled.add(comp)
          }
        }
        setItemQtys(newQtys)
        setExcelFilled(filled)
      } else {
        setSingleQty(String(fallbackQty))
      }
      setStep('confirm')
    } catch (err) {
      toast.error(err.message || 'Excel okunamadı.')
    } finally {
      setExcelLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleBatchSubmit(e) {
    e?.preventDefault()
    setBatchSaving(true)
    const created = []
    try {
      for (const row of batchRows) {
        if (!(row.qty > 0)) continue
        const comps = getComponentsForProject(row.product.id).map((c) => c.component)
        let items, quantity
        if (comps.length > 0) {
          items = comps.map((name) => ({ name, quantity: row.qty }))
          quantity = row.qty
        } else {
          items = []
          quantity = row.qty
        }
        try {
          const req = await api.createOrderRequest({
            projectId: row.product.id,
            projectTitle: row.product.title,
            items, quantity,
            notes: batchNotes.trim(),
            requester: user ? { id: user.id, name: user.name, role: user.role } : null,
          })
          storeOrderAdet(row.product.id, items, quantity)
          created.push(req)
        } catch {
          toast.error(`${row.product.title.replace(/ \/ /g, ' ')}: gönderilemedi.`)
        }
      }
      if (created.length > 0) {
        toast.success(`${created.length} sipariş talebi gönderildi.`)
        onBatchSubmitted?.(created)
      }
    } finally {
      setBatchSaving(false)
    }
  }

  function handleDragEnter(e) { e.preventDefault(); dragCountRef.current++; setDragOver(true) }
  function handleDragLeave() { dragCountRef.current--; if (dragCountRef.current === 0) setDragOver(false) }
  function handleDrop(e) {
    e.preventDefault(); dragCountRef.current = 0; setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  const allFilled = hasComponents
    ? components.every((name) => parseInt(itemQtys[name] || '0', 10) > 0)
    : parseInt(singleQty, 10) > 0

  // A book with a single component (or none) is ordered as ONE amount — no need
  // for the itemized "Kalem Adetleri" list or the "apply to all" helper. Only a
  // product with 2+ components gets the itemized editor.
  const isMulti = hasComponents && components.length > 1
  const singleComp = hasComponents ? components[0] : null
  const singleValue = hasComponents ? (itemQtys[singleComp] ?? '') : singleQty
  const setSingleValue = (v) =>
    hasComponents ? setItemQtys((prev) => ({ ...prev, [singleComp]: v })) : setSingleQty(v)
  const totalAdet = components.reduce((sum, name) => sum + (parseInt(itemQtys[name] || '0', 10) || 0), 0)

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!selectedProductId) { toast.error('Lütfen bir ürün seçin.'); return }
    let items, quantity
    if (hasComponents) {
      if (components.some((name) => parseInt(itemQtys[name] || '0', 10) <= 0)) {
        toast.error('Tüm kalemler için geçerli adet giriniz.'); return
      }
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
        items, quantity,
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
      <DialogContent className="max-w-md">

        {/* ── STEP 1: Upload / drag-drop ─────────────────────────────────── */}
        {step === 'upload' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Sipariş Oluştur
              </DialogTitle>
            </DialogHeader>

            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !excelLoading && fileInputRef.current?.click()}
              className={cn(
                'flex cursor-pointer select-none flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all duration-150',
                dragOver
                  ? 'border-primary bg-primary/5 scale-[0.985]'
                  : 'border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30',
                excelLoading && 'pointer-events-none',
              )}
            >
              {excelLoading ? (
                <>
                  <svg className="h-10 w-10 animate-spin text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <p className="text-sm font-medium text-muted-foreground">Excel okunuyor…</p>
                </>
              ) : (
                <>
                  <div className={cn(
                    'rounded-2xl p-4 transition-colors',
                    dragOver ? 'bg-primary/10' : 'bg-muted/60',
                  )}>
                    <FileSpreadsheet className={cn(
                      'h-9 w-9 transition-colors',
                      dragOver ? 'text-primary' : 'text-muted-foreground/40',
                    )} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      {dragOver ? 'Bırakın!' : 'Excel dosyasını buraya sürükleyin'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ya da tıklayarak dosya seçin · .xlsx .xls .csv
                    </p>
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>İptal</Button>
            </DialogFooter>
          </>
        )}

        {/* ── STEP 2: Confirm / review ───────────────────────────────────── */}
        {step === 'confirm' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <DialogHeader className="space-y-0">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  aria-label="Geri"
                  onClick={() => setStep('upload')}
                  className="-ml-1.5 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <DialogTitle className="text-base">Sipariş özeti</DialogTitle>
              </div>
            </DialogHeader>

            {/* Product identity — eyebrow + name over a hairline, no boxed card */}
            {selectedProduct ? (
              <div className="border-b pb-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Ürün</p>
                <p className="mt-1 text-[15px] font-semibold leading-tight text-foreground">
                  {selectedProduct.title.replace(/ \/ /g, ' ')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-[13px] font-medium text-foreground">Ürün</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger><SelectValue placeholder="Ürün seçin…" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.title.replace(/ \/ /g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Quantity — one amount for a single-item book, an itemized editor
                for products with multiple components. */}
            {selectedProductId && !isMulti && (
              <div className="space-y-2">
                <Label htmlFor="single-adet" className="text-[13px] font-medium text-foreground">
                  Sipariş adedi
                </Label>
                <div className="relative">
                  <Input
                    id="single-adet"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    autoFocus
                    placeholder="0"
                    className="h-14 pr-16 text-2xl font-semibold tracking-tight tabular-nums"
                    value={singleValue}
                    onChange={(e) => setSingleValue(e.target.value)}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                    adet
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Bu üründen kaç adet üretilecek?</p>
              </div>
            )}

            {selectedProductId && isMulti && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-[13px] font-medium text-foreground">Kalem adetleri</Label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    Tümüne
                    <Input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      aria-label="Tüm kalemlere uygula"
                      placeholder="0"
                      className="h-8 w-16 text-right tabular-nums"
                      onChange={(e) => applyToAll(e.target.value)}
                    />
                  </label>
                </div>
                <div className="divide-y border-y">
                  {components.map((name) => {
                    const fromExcel = excelFilled.has(name)
                    const qty = parseInt(itemQtys[name] || '0', 10)
                    return (
                      <div key={name} className="flex items-center gap-2.5 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                        {fromExcel && (
                          <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600">
                            xls
                          </span>
                        )}
                        <div className="relative shrink-0">
                          <Input
                            type="number"
                            min="1"
                            inputMode="numeric"
                            className={cn('h-10 w-24 pr-9 text-right tabular-nums', qty > 0 && 'font-semibold')}
                            placeholder="0"
                            value={itemQtys[name] ?? ''}
                            onChange={(e) => {
                              setItemQtys((prev) => ({ ...prev, [name]: e.target.value }))
                              setExcelFilled((prev) => { const s = new Set(prev); s.delete(name); return s })
                            }}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            adet
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between pt-1 text-sm">
                  <span className="text-muted-foreground">Toplam</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {totalAdet.toLocaleString('tr-TR')} adet
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes" className="text-[13px] font-medium text-foreground">
                Not <span className="font-normal text-muted-foreground/60">· opsiyonel</span>
              </Label>
              <Input
                id="notes"
                placeholder="Teslim tarihi, aciliyet vb."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>İptal</Button>
              <Button type="submit" loading={saving} disabled={saving || !selectedProductId || !allFilled}>
                {saving ? 'Gönderiliyor…' : 'Talep oluştur'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* ── STEP 3: Batch confirm ─────────────────────────────────────── */}
        {step === 'batch' && (
          <form onSubmit={handleBatchSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                Toplu Sipariş · {batchRows.length} ürün
              </DialogTitle>
            </DialogHeader>

            {batchUnmatched.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {batchUnmatched.length} satır eşleştirilemedi ve atlandı.
              </div>
            )}

            <div className="max-h-72 overflow-y-auto divide-y rounded-xl border">
              {batchRows.map((row) => (
                <div key={row.product.id} className="flex items-center gap-2 bg-white px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {row.product.title.replace(/ \/ /g, ' ')}
                  </span>
                  {!row.modified && (
                    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600">
                      xls
                    </span>
                  )}
                  <Input
                    type="number"
                    min="1"
                    className={cn('h-8 w-24 text-right tabular-nums', row.qty > 0 ? 'font-semibold' : '')}
                    value={row.qty || ''}
                    onChange={(e) =>
                      setBatchRows((prev) =>
                        prev.map((r) =>
                          r.product.id === row.product.id
                            ? { ...r, qty: parseInt(e.target.value) || 0, modified: true }
                            : r,
                        ),
                      )
                    }
                  />
                  <span className="w-7 shrink-0 text-xs text-muted-foreground">adet</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="batch-notes">Not</Label>
              <Input
                id="batch-notes"
                placeholder="Teslim tarihi, aciliyet vb."
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>İptal</Button>
              <Button
                type="submit"
                disabled={batchSaving || batchRows.some((r) => !(r.qty > 0))}
              >
                {batchSaving ? 'Gönderiliyor…' : `Talep Oluştur (${batchRows.length})`}
              </Button>
            </DialogFooter>
          </form>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }}
        />
      </DialogContent>
    </Dialog>
  )
}
