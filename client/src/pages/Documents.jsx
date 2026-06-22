import { useMemo, useState } from 'react'
import { useProjectModal } from '@/hooks/useProjectModal'
import { FileText, Printer, CheckCircle2, Clock, Inbox, Eye, X } from 'lucide-react'
import { toast } from 'sonner'

import { useProjects } from '@/hooks/useProjects'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { TYPE_LABELS } from '@/api'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                                */
/* ------------------------------------------------------------------ */

function loadDemoForm(projectId) {
  try {
    const raw = localStorage.getItem(`yz_demo_form_${projectId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function loadOzalitForm(projectId) {
  try {
    const raw = localStorage.getItem(`yz_ozalit_form_${projectId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Stage classification                                                */
/* ------------------------------------------------------------------ */

const DEMO_SENT_STAGES = new Set([
  'demo_teslim', 'demo_onay',
  'ozalit_teslim', 'ozalit_onay',
  'uretimde', 'satista',
  'cin_demo_teslim', 'cin_demo_onay',
  'gumruk',
])

function isDemoApproved(p) {
  if (p.type === 'TR') return ['ozalit_teslim', 'ozalit_onay', 'uretimde', 'satista'].includes(p.stage)
  return ['uretimde', 'gumruk', 'satista'].includes(p.stage)
}

const OZALIT_SENT_STAGES = new Set(['ozalit_teslim', 'ozalit_onay', 'uretimde', 'satista'])
const OZALIT_APPROVED_STAGES = new Set(['uretimde', 'satista'])

/* ------------------------------------------------------------------ */
/*  Print helpers (mirrors DemoFormDialog / OzalitFormDialog logic)    */
/* ------------------------------------------------------------------ */

function buildPrintHtml({ title, attemptLabel, rows, designerNames, onaylayanKisi, printerName }) {
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

  const tableRows = rows
    .map(([lbl, val]) => `<tr><td class="label">${lbl}</td><td class="colon">:</td><td class="val">${val || ''}</td></tr>`)
    .join('')

  const sigBox = (role, name) => `
    <div class="sig-box">
      <p class="sig-role">${role}</p>
      <p class="sig-name">${name || ''}</p>
      <div class="sig-line"></div>
      <p class="sig-hint">İmza</p>
    </div>`

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>${attemptLabel} — ${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #000; padding: 18mm 20mm; }
    .doc-title { text-align: center; font-size: 15pt; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 4px; }
    .attempt-label { text-align: right; font-size: 12pt; font-weight: 700; padding: 4px 0 8px; border-bottom: 1px solid #ccc; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid #ddd; }
    td { padding: 5px 4px; vertical-align: middle; }
    td.label { width: 44%; font-weight: 700; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.03em; }
    td.colon { width: 4%; font-weight: 700; text-align: center; }
    td.val { width: 52%; font-size: 10.5pt; }
    .date-line { margin-top: 14px; font-size: 9.5pt; text-align: right; color: #444; }
    .sig-section { margin-top: 28px; display: flex; gap: 0; }
    .sig-box { flex: 1; border: 1px solid #000; padding: 12px 14px 10px; margin-right: -1px; }
    .sig-box:last-child { margin-right: 0; }
    .sig-role { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; margin-bottom: 4px; }
    .sig-name { font-size: 10.5pt; font-weight: 700; min-height: 16px; margin-bottom: 28px; }
    .sig-line { border-top: 1px solid #000; margin-bottom: 4px; }
    .sig-hint { font-size: 8pt; color: #888; text-align: center; }
    @media print { body { padding: 12mm 14mm; } @page { size: A4; margin: 0; } }
  </style>
</head>
<body>
  <div class="doc-title">${title}</div>
  <div class="attempt-label">${attemptLabel}</div>
  <table>${tableRows}</table>
  <div class="date-line">Tarih: ${today}</div>
  <div class="sig-section">
    ${sigBox('Tasarımcı', designerNames)}
    ${sigBox('Ekip Lideri / Onaylayan', onaylayanKisi)}
    ${sigBox('Matbaa Yetkilisi', printerName)}
  </div>
</body>
</html>`
}

function openPrint(html) {
  const win = window.open('', '_blank', 'width=800,height=900')
  if (!win) {
    toast.error('Yazdırma penceresi açılamadı. Pop-up engelleyiciyi kontrol edin.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

function printDemoDoc({ project, form, attemptNo, printerName }) {
  const designerNames = (project?.assignees ?? []).map((a) => a.name).join(', ') || project?.assigned_name || ''
  const rows = [
    ['İŞİN ADI', form?.isinAdi ?? project?.title ?? ''],
    ['SETTEKİ KİTAP SAYISI', form?.settekiKitapSayisi ?? ''],
    ['ADET', form?.adet ?? ''],
    ['EBAT', form?.ebat ?? ''],
    ['SAYFA SAYISI', form?.sayfaSayisi ?? ''],
    ['İÇ KAĞIT CİNSİ', form?.icKagitCinsi ?? ''],
    ['KAPAK KAĞIT CİNSİ', form?.kapakKagitCinsi ?? ''],
    ['CİLT', form?.cilt ?? ''],
    ['LAMİNASYON', form?.laminasyon ?? ''],
    ['KAĞIT DAHİL BİRİM FİYAT', form?.kagitDahilBirimFiyat ?? ''],
    ['BASIM YERİ', form?.basimYeri ?? ''],
    ['DEMO İSTEM TARİHİ', form?.demoIstemTarihi ?? ''],
    ['DEMO İSTEYEN KİŞİ', form?.demoIsteyenKisi ?? designerNames],
    ['ONAYLAYAN KİŞİ', form?.onaylayanKisi ?? ''],
  ]
  openPrint(buildPrintHtml({
    title: project?.title ?? '',
    attemptLabel: `${attemptNo}. DEMO`,
    rows,
    designerNames,
    onaylayanKisi: form?.onaylayanKisi ?? '',
    printerName,
  }))
}

function printOzalitDoc({ project, form, attemptNo, printerName }) {
  const designerNames = (project?.assignees ?? []).map((a) => a.name).join(', ') || project?.assigned_name || ''
  const rows = [
    ['İŞİN ADI', form?.isinAdi ?? project?.title ?? ''],
    ['SETTEKİ KİTAP SAYISI', form?.settekiKitapSayisi ?? ''],
    ['ADET', form?.adet ?? ''],
    ['EBAT', form?.ebat ?? ''],
    ['SAYFA SAYISI', form?.sayfaSayisi ?? ''],
    ['İÇ KAĞIT CİNSİ', form?.icKagitCinsi ?? ''],
    ['KAPAK KAĞIT CİNSİ', form?.kapakKagitCinsi ?? ''],
    ['CİLT', form?.cilt ?? ''],
    ['LAMİNASYON', form?.laminasyon ?? ''],
    ['KAĞIT DAHİL BİRİM FİYAT', form?.kagitDahilBirimFiyat ?? ''],
    ['BASIM YERİ', form?.basimYeri ?? ''],
    ['OZALİT İSTEM TARİHİ', form?.ozalitIstemTarihi ?? ''],
    ['OZALİT İSTEYEN KİŞİ', form?.ozalitIsteyenKisi ?? designerNames],
    ['ONAYLAYAN KİŞİ', form?.onaylayanKisi ?? ''],
  ]
  openPrint(buildPrintHtml({
    title: project?.title ?? '',
    attemptLabel: `${attemptNo}. OZALİT`,
    rows,
    designerNames,
    onaylayanKisi: form?.onaylayanKisi ?? '',
    printerName,
  }))
}

/* ------------------------------------------------------------------ */
/*  Document preview dialog                                             */
/* ------------------------------------------------------------------ */

function DocumentPreviewDialog({ open, onOpenChange, project, form, attemptNo, docType, printerName }) {
  if (!project) return null

  const isDemo = docType === 'demo'
  const designerNames =
    (project?.assignees ?? []).map((a) => a.name).join(', ') || project?.assigned_name || ''
  const attemptLabel = `${attemptNo}. ${isDemo ? 'DEMO' : 'OZALİT'}`

  const rows = isDemo
    ? [
        ['İŞİN ADI', form?.isinAdi ?? project.title],
        ['SETTEKİ KİTAP SAYISI', form?.settekiKitapSayisi],
        ['ADET', form?.adet],
        ['EBAT', form?.ebat],
        ['SAYFA SAYISI', form?.sayfaSayisi],
        ['İÇ KAĞIT CİNSİ', form?.icKagitCinsi],
        ['KAPAK KAĞIT CİNSİ', form?.kapakKagitCinsi],
        ['CİLT', form?.cilt],
        ['LAMİNASYON', form?.laminasyon],
        ['KAĞIT DAHİL BİRİM FİYAT', form?.kagitDahilBirimFiyat],
        ['BASIM YERİ', form?.basimYeri],
        ['DEMO İSTEM TARİHİ', form?.demoIstemTarihi],
        ['DEMO İSTEYEN KİŞİ', form?.demoIsteyenKisi ?? designerNames],
        ['ONAYLAYAN KİŞİ', form?.onaylayanKisi],
      ]
    : [
        ['İŞİN ADI', form?.isinAdi ?? project.title],
        ['SETTEKİ KİTAP SAYISI', form?.settekiKitapSayisi],
        ['ADET', form?.adet],
        ['EBAT', form?.ebat],
        ['SAYFA SAYISI', form?.sayfaSayisi],
        ['İÇ KAĞIT CİNSİ', form?.icKagitCinsi],
        ['KAPAK KAĞIT CİNSİ', form?.kapakKagitCinsi],
        ['CİLT', form?.cilt],
        ['LAMİNASYON', form?.laminasyon],
        ['KAĞIT DAHİL BİRİM FİYAT', form?.kagitDahilBirimFiyat],
        ['BASIM YERİ', form?.basimYeri],
        ['OZALİT İSTEM TARİHİ', form?.ozalitIstemTarihi],
        ['OZALİT İSTEYEN KİŞİ', form?.ozalitIsteyenKisi ?? designerNames],
        ['ONAYLAYAN KİŞİ', form?.onaylayanKisi],
      ]

  function handlePrint() {
    if (isDemo) {
      printDemoDoc({ project, form, attemptNo, printerName })
    } else {
      printOzalitDoc({ project, form, attemptNo, printerName })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {isDemo ? 'Demo Üretim Formu' : 'Özalit Üretim Formu'}
          </DialogTitle>
        </DialogHeader>

        {/* Spec sheet — read-only */}
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3 text-center">
            <h2 className="text-base font-bold uppercase tracking-widest text-foreground">
              {project.title}
            </h2>
          </div>
          <div className="border-b px-4 py-2 text-right">
            <span className="text-sm font-bold">{attemptLabel}</span>
          </div>
          <div className="px-4 py-1">
            {rows.map(([label, val]) => (
              <div
                key={label}
                className="grid grid-cols-[1fr_auto_2fr] items-center border-b last:border-b-0"
              >
                <span className="py-1.5 pr-3 text-[13px] font-semibold uppercase tracking-wide text-foreground">
                  {label}
                </span>
                <span className="px-2 py-1.5 text-sm font-bold">:</span>
                <span className="py-1.5 pl-2 text-sm text-foreground">{val || <span className="text-muted-foreground/50">—</span>}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Signature boxes — Parisienne cursive when a name is known */}
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border">
          {[
            ['Tasarımcı', designerNames],
            ['Ekip Lideri / Onaylayan', form?.onaylayanKisi ?? ''],
            ['Matbaa Yetkilisi', printerName],
          ].map(([role, name], i) => (
            <div key={role} className={cn('p-3', i < 2 && 'border-r')}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {role}
              </p>
              {name ? (
                <p
                  className="mt-1 text-foreground"
                  style={{ fontFamily: "'Parisienne', cursive", fontSize: '1.65rem', lineHeight: 1.25 }}
                >
                  {name}
                </p>
              ) : (
                <>
                  <div className="mb-1 mt-10 border-t" />
                  <p className="text-center text-[10px] text-muted-foreground">İmza</p>
                </>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/*  Document card                                                       */
/* ------------------------------------------------------------------ */

function DocumentCard({ project, form, attemptNo, docType, approved, printerName, onView }) {
  const { openProject } = useProjectModal()

  function handlePrint() {
    if (docType === 'demo') {
      printDemoDoc({ project, form, attemptNo, printerName })
    } else {
      printOzalitDoc({ project, form, attemptNo, printerName })
    }
  }

  const requestDate = docType === 'demo' ? form?.demoIstemTarihi : form?.ozalitIstemTarihi
  const requester = docType === 'demo' ? form?.demoIsteyenKisi : form?.ozalitIsteyenKisi
  const docLabel = docType === 'demo' ? 'Demo' : 'Özalit'

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-semibold">{project.title}</p>
            </div>
            <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
              {requester || project.assigned_name}
              {requestDate ? ` · ${requestDate}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[project.type]}</Badge>
              <Badge variant="secondary" className="text-[10px]">
                {attemptNo}. {docLabel}
              </Badge>
            </div>
            {approved && (
              <Badge className="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 text-[10px]">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Onaylı
              </Badge>
            )}
          </div>
        </div>

        {/* Summary rows */}
        {form && (
          <div className="space-y-0.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {form.adet && (
              <div><span className="font-medium text-foreground">Adet:</span> {form.adet}</div>
            )}
            {form.ebat && (
              <div><span className="font-medium text-foreground">Ebat:</span> {form.ebat}</div>
            )}
            {form.basimYeri && (
              <div><span className="font-medium text-foreground">Basım Yeri:</span> {form.basimYeri}</div>
            )}
            {form.onaylayanKisi && (
              <div><span className="font-medium text-foreground">Onaylayan:</span> {form.onaylayanKisi}</div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            className="flex-1"
            onClick={onView}
          >
            <Eye className="h-4 w-4" />
            Görüntüle
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openProject(project.id)}
            title="Projeye git"
          >
            Proje
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                         */
/* ------------------------------------------------------------------ */

function EmptyState({ text }) {
  return (
    <Card>
      <CardContent className="grid place-items-center gap-2 p-10 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function Documents() {
  const { projects, loading } = useProjects()
  const [docType, setDocType] = useState('demo')
  const [subTab, setSubTab] = useState('istenen')
  const [viewEntry, setViewEntry] = useState(null) // { project, form, attemptNo, docType, printerName }

  const { demoIstenen, demoOnaylanan, ozalitIstenen, ozalitOnaylanan } = useMemo(() => {
    const demoIst = []
    const demoOnay = []
    const ozalitIst = []
    const ozalitOnay = []

    for (const p of projects) {
      if (DEMO_SENT_STAGES.has(p.stage)) {
        const form = loadDemoForm(p.id)
        const attemptNo = (p.demo_attempt ?? 0) + 1
        const printerEntry = (p.history ?? []).find(
          (h) => h.from_stage === 'demo_teslim' && h.action === 'advance',
        )
        const printerName = printerEntry?.done_by_name ?? ''
        const entry = { project: p, form, attemptNo, printerName }
        demoIst.push(entry)
        if (isDemoApproved(p)) demoOnay.push(entry)
      }

      if (p.type === 'TR' && OZALIT_SENT_STAGES.has(p.stage)) {
        const form = loadOzalitForm(p.id)
        const attemptNo = (p.ozalit_attempt ?? 0) + 1
        const printerEntry = (p.history ?? []).find(
          (h) => h.from_stage === 'ozalit_teslim' && h.action === 'advance',
        )
        const printerName = printerEntry?.done_by_name ?? ''
        const entry = { project: p, form, attemptNo, printerName }
        ozalitIst.push(entry)
        if (OZALIT_APPROVED_STAGES.has(p.stage)) ozalitOnay.push(entry)
      }
    }

    return {
      demoIstenen: demoIst,
      demoOnaylanan: demoOnay,
      ozalitIstenen: ozalitIst,
      ozalitOnaylanan: ozalitOnay,
    }
  }, [projects])

  const isDemo = docType === 'demo'
  const items = isDemo
    ? subTab === 'istenen' ? demoIstenen : demoOnaylanan
    : subTab === 'istenen' ? ozalitIstenen : ozalitOnaylanan

  const emptyText = isDemo
    ? subTab === 'istenen' ? 'Henüz gönderilen demo yok.' : 'Henüz onaylanan demo yok.'
    : subTab === 'istenen' ? 'Henüz gönderilen özalit yok.' : 'Henüz onaylanan özalit yok.'

  const demoCounts = {
    istenen: demoIstenen.length,
    onaylanan: demoOnaylanan.length,
  }
  const ozalitCounts = {
    istenen: ozalitIstenen.length,
    onaylanan: ozalitOnaylanan.length,
  }
  const counts = isDemo ? demoCounts : ozalitCounts

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dökümanlar</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Gönderilen ve onaylanan demo / özalit üretim formları.
        </p>
      </header>

      {/* Primary tabs: Demolar | Özalitler */}
      <div className="flex gap-0 border-b">
        {[
          { key: 'demo', label: 'Demolar', count: demoCounts.istenen },
          { key: 'ozalit', label: 'Özalitler', count: ozalitCounts.istenen },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setDocType(key)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-5 py-2.5 text-sm font-medium transition-colors -mb-px',
              docType === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  docType === key ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Secondary tabs: İstenen | Onaylanan */}
      <div className="flex gap-2">
        {[
          { key: 'istenen', label: 'İstenen', icon: Clock },
          { key: 'onaylanan', label: 'Onaylanan', icon: CheckCircle2 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
              subTab === key
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {counts[key] > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] font-semibold',
                  subTab === key ? 'bg-primary/15 text-primary' : 'bg-background text-muted-foreground',
                )}
              >
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Document grid */}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((entry) => (
            <DocumentCard
              key={entry.project.id}
              project={entry.project}
              form={entry.form}
              attemptNo={entry.attemptNo}
              docType={docType}
              approved={subTab === 'onaylanan'}
              printerName={entry.printerName}
              onView={() => setViewEntry({ ...entry, docType })}
            />
          ))}
        </div>
      )}

      <DocumentPreviewDialog
        open={!!viewEntry}
        onOpenChange={(v) => !v && setViewEntry(null)}
        project={viewEntry?.project}
        form={viewEntry?.form}
        attemptNo={viewEntry?.attemptNo}
        docType={viewEntry?.docType}
        printerName={viewEntry?.printerName ?? ''}
      />
    </div>
  )
}
