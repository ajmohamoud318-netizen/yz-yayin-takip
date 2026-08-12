import { useEffect, useMemo, useRef, useState } from 'react'
import { ShoppingCart, FileSpreadsheet, ArrowLeft, ListChecks, Search } from 'lucide-react'
import { toast } from 'sonner'

import api, { STAGE_LABELS } from '@/api'
import { getComponentsForProject } from '@/data/productCatalog'
import { storeOrderAdet } from '@/data/orderAdet'
import { Button } from '@/components/ui/button'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

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

export default function OrderRequestDialog({ products, user, open, initialProductId, onOpenChange, onSubmitted, onBatchSubmitted }) {
  const [step, setStep] = useState('select') // 'select' | 'confirm' | 'batch'
  // Two ways into an order from the 'select' step: tick products in the catalog
  // picker, or drop an Excel and let it match. Both land on the same quantity
  // screens below.
  const [mode, setMode] = useState('pick')   // 'pick' | 'upload'
  const [pickSearch, setPickSearch] = useState('')
  const [pickedIds, setPickedIds] = useState(() => new Set())
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
      setStep('select')
      setMode('pick')
      setPickSearch('')
      setPickedIds(new Set())
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

  // ── Direct picker ───────────────────────────────────────────────────────────

  const pickFiltered = useMemo(() => {
    const q = normTR(pickSearch)
    if (!q) return products
    return products.filter((p) => normTR(p.title).includes(q))
  }, [products, pickSearch])

  function togglePicked(id) {
    setPickedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Same split as the Excel path: one product gets the itemized form (so Sales
  // can set each component separately), several go to the batch screen.
  function continueWithPicked() {
    const chosen = products.filter((p) => pickedIds.has(p.id))
    if (chosen.length === 0) return
    if (chosen.length === 1) {
      setSelectedProductId(chosen[0].id)
      setStep('confirm')
      return
    }
    setBatchRows(chosen.map((product) => ({ product, qty: 0, modified: true })))
    setBatchUnmatched([])
    setBatchNotes('')
    setStep('batch')
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
      <DialogContent className="max-w-md sm:max-w-md max-sm:left-0 max-sm:top-0 max-sm:h-screen max-sm:max-h-screen max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-l-0">

        {/* ── STEP 1: Pick products / upload Excel ───────────────────────── */}
        {step === 'select' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Sipariş Oluştur
              </DialogTitle>
            </DialogHeader>

            {/* Mode switch */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
              {[
                { id: 'pick', label: 'Ürün seç', Icon: ListChecks },
                { id: 'upload', label: 'Excel yükle', Icon: FileSpreadsheet },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  aria-pressed={mode === id}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all',
                    mode === id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Catalog picker */}
            {mode === 'pick' && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={pickSearch}
                    onChange={(e) => setPickSearch(e.target.value)}
                    placeholder="Ürün ara…"
                    className="h-9 pl-8"
                  />
                </div>

                <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border">
                  {pickFiltered.length === 0 ? (
                    <li className="px-3 py-8 text-center text-xs text-muted-foreground">
                      {products.length === 0
                        ? 'Sipariş verilebilecek ürün bulunmuyor.'
                        : 'Aramaya uyan ürün yok.'}
                    </li>
                  ) : (
                    pickFiltered.map((p) => (
                      <li key={p.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40',
                            pickedIds.has(p.id) && 'bg-primary/[0.05]',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={pickedIds.has(p.id)}
                            onChange={() => togglePicked(p.id)}
                            className="h-4 w-4 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {p.title.replace(/ \/ /g, ' ')}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {STAGE_LABELS[p.stage] ?? p.stage}
                          </span>
                        </label>
                      </li>
                    ))
                  )}
                </ul>

                <p className="text-xs text-muted-foreground">
                  {pickedIds.size > 0
                    ? `${pickedIds.size} ürün seçildi — adetleri sonraki adımda gireceksiniz.`
                    : 'Sipariş vermek istediğiniz ürünleri işaretleyin.'}
                </p>
              </div>
            )}

            {/* Drop zone */}
            {mode === 'upload' && (
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
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>İptal</Button>
              {mode === 'pick' && (
                <Button type="button" disabled={pickedIds.size === 0} onClick={continueWithPicked}>
                  {pickedIds.size > 1 ? `Devam (${pickedIds.size})` : 'Devam'}
                </Button>
              )}
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
                  onClick={() => setStep('select')}
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
                  onClick={() => setStep('select')}
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
                    inputMode="numeric"
                    placeholder="0"
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
