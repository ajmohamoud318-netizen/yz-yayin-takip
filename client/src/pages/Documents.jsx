import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
  DIALOG_MOBILE_SHEET,
} from '@/components/ui/dialog'
import api, { TYPE_LABELS } from '@/api'
import { cn } from '@/lib/utils'
import { getComponentsForProject, getComponentRows } from '@/data/productCatalog'
import { printSpecSheets, buildFormSheet, buildFormKunye } from '@/lib/specPrint'
import {
  FormSheet,
  FormSheetBlock,
  FormSheetBlockTitle,
  FormSheetHead,
  SheetRow,
} from '@/components/FormSheet'

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                                */
/* ------------------------------------------------------------------ */

function safeJson(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

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
  'baskida', 'satista',
  'cin_demo_teslim', 'cin_demo_onay',
  'gumruk',
])

function isDemoApproved(p) {
  if (p.type === 'TR') return ['ozalit_teslim', 'ozalit_onay', 'baskida', 'satista'].includes(p.stage)
  return ['baskida', 'gumruk', 'satista'].includes(p.stage)
}

const OZALIT_SENT_STAGES = new Set(['ozalit_teslim', 'ozalit_onay', 'baskida', 'satista'])
const OZALIT_APPROVED_STAGES = new Set(['baskida', 'satista'])

/* ------------------------------------------------------------------ */
/*  Parça + print helpers (shared with the Demo/Ozalit dialog)         */
/* ------------------------------------------------------------------ */

// The parçalar for a document: prefer the exact set saved with the form
// (_selectedComponents), otherwise fall back to the project's current spec
// from Ürün Bilgileri. Shape: [{ component, rows: [{label,value}] }].
function parcalarFor(project, form) {
  const saved = form?._selectedComponents
  if (Array.isArray(saved) && saved.length > 0) {
    return saved.map((c) => ({ component: c.component, rows: c.rows ?? [] }))
  }
  return getComponentsForProject(project?.id).map((c) => ({
    component: c.component,
    rows: getComponentRows(c),
  }))
}

// Print every parça of a document in ONE job (one classic sheet each).
function printDoc({ project, form, attemptNo, kind, printerName }) {
  const attemptLabel = `${attemptNo}. ${kind === 'ozalit' ? 'OZALİT' : 'DEMO'}`
  const comps = parcalarFor(project, form)
  const list = comps.length > 0 ? comps : [{ component: form?.isinAdi || project?.title || '', rows: [] }]
  // Each sheet is headed by the job and names its own parça as İŞİN ADI, so
  // the KUTU sheet isn't titled as the book.
  const sheetForm = { ...form, matbaaYetkilisi: printerName || form?.matbaaYetkilisi || '' }
  const sheets = list.map((c) => buildFormSheet({ component: c, form: sheetForm, kind, title: project?.title || '', attemptLabel }))
  const ok = printSpecSheets(sheets, { docTitle: `${attemptLabel} — ${project?.title ?? ''}` })
  if (!ok) toast.error('Yazdırma penceresi açılamadı. Pop-up engelleyiciyi kontrol edin.')
}

/* ------------------------------------------------------------------ */
/*  Document preview dialog                                             */
/* ------------------------------------------------------------------ */

function DocumentPreviewDialog({ open, onOpenChange, project, form, attemptNo, docType, printerName }) {
  if (!project) return null

  const isDemo = docType === 'demo'
  const kind = isDemo ? 'demo' : 'ozalit'
  const attemptLabel = `${attemptNo}. ${isDemo ? 'DEMO' : 'OZALİT'}`

  // One classic sheet per parça — same set the printout produces.
  const comps = parcalarFor(project, form)
  const list = comps.length > 0 ? comps : [{ component: form?.isinAdi || project.title, rows: [] }]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-w-2xl', DIALOG_MOBILE_SHEET)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {isDemo ? 'Demo Üretim Formu' : 'Ozalit Üretim Formu'}
            {list.length > 1 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">· {list.length} parça</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* One sheet per parça — the same document printDoc() puts on paper. */}
        <div className="space-y-4">
          {list.map((c, ci) => (
            <FormSheet key={ci}>
              <FormSheetHead
                title={isDemo ? 'Demo Üretim Formu' : 'Ozalit Üretim Formu'}
                subtitle={project.title}
                attemptLabel={attemptLabel}
                icon={FileText}
              />
              {/* Job name, spec, then the künye stamps as the foot — the same
                  order printDoc() puts on paper. */}
              <FormSheetBlock className="bg-muted/10">
                <SheetRow label="İŞİN ADI" value={c.component || project.title} readOnly />
              </FormSheetBlock>
              <FormSheetBlockTitle>Baskı Özellikleri</FormSheetBlockTitle>
              <FormSheetBlock>
                {(c.rows ?? []).length === 0 ? (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">Satır yok.</p>
                ) : (
                  (c.rows ?? []).map((r, i) => (
                    <SheetRow key={r.id ?? i} label={r.label} value={r.value} readOnly />
                  ))
                )}
              </FormSheetBlock>
              <FormSheetBlock className="bg-muted/10 border-b-0">
                {buildFormKunye({ form, kind }).map(([label, val], i) => (
                  <SheetRow key={i} label={label} value={val} readOnly />
                ))}
              </FormSheetBlock>
            </FormSheet>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Kapatın
          </Button>
          <Button variant="outline" onClick={() => printDoc({ project, form, attemptNo, kind, printerName })}>
            <Printer className="h-4 w-4" />
            {list.length > 1 ? `Yazdırın (${list.length})` : 'Yazdırın'}
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
  const navigate = useNavigate()

  function handlePrint() {
    printDoc({ project, form, attemptNo, kind: docType === 'demo' ? 'demo' : 'ozalit', printerName })
  }

  const requestDate = docType === 'demo' ? form?.demoIstemTarihi : form?.ozalitIstemTarihi
  const requester = docType === 'demo' ? form?.demoIsteyenKisi : form?.ozalitIsteyenKisi
  const docLabel = docType === 'demo' ? 'Demo' : 'Ozalit'

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="line-clamp-2 text-sm font-semibold sm:line-clamp-1">{project.title}</p>
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
            Görüntüleyin
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/projects/${project.id}`)}
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
  // Server-side form snapshots keyed { [projectId]: { demo, ozalit } }. These
  // are the source of truth (any user/browser sees them); localStorage is only
  // an offline fallback for the browser that filled the form.
  const [serverForms, setServerForms] = useState({})

  useEffect(() => {
    let cancelled = false
    api.listDemos()
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        // rows are newest-first — keep the first (latest attempt) per project+kind.
        const map = {}
        for (const r of rows) {
          const pid = r.project_id
          const kind = r.kind ?? 'demo'
          if (!pid) continue
          if (!map[pid]) map[pid] = {}
          if (map[pid][kind]) continue
          map[pid][kind] = typeof r.payload === 'string' ? safeJson(r.payload) : (r.payload ?? null)
        }
        setServerForms(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const { demoIstenen, demoOnaylanan, ozalitIstenen, ozalitOnaylanan } = useMemo(() => {
    const demoIst = []
    const demoOnay = []
    const ozalitIst = []
    const ozalitOnay = []
    // Prefer the server snapshot; fall back to this browser's localStorage.
    const pickForm = (kind, pid) =>
      serverForms[pid]?.[kind] ?? (kind === 'demo' ? loadDemoForm(pid) : loadOzalitForm(pid))

    for (const p of projects) {
      if (DEMO_SENT_STAGES.has(p.stage)) {
        const form = pickForm('demo', p.id)
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
        const form = pickForm('ozalit', p.id)
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
  }, [projects, serverForms])

  const isDemo = docType === 'demo'
  const items = isDemo
    ? subTab === 'istenen' ? demoIstenen : demoOnaylanan
    : subTab === 'istenen' ? ozalitIstenen : ozalitOnaylanan

  const emptyText = isDemo
    ? subTab === 'istenen' ? 'Henüz gönderilen demo yok.' : 'Henüz onaylanan demo yok.'
    : subTab === 'istenen' ? 'Henüz gönderilen ozalit yok.' : 'Henüz onaylanan ozalit yok.'

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
      </header>

      {/* Primary tabs: Demolar | Ozalitler */}
      <div className="flex gap-0 border-b">
        {[
          { key: 'demo', label: 'Demolar', count: demoCounts.istenen },
          { key: 'ozalit', label: 'Ozalitler', count: ozalitCounts.istenen },
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
