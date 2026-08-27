import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Printer, CheckCircle2, Clock, Inbox, Eye, Search, ExternalLink } from 'lucide-react'
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
import { liveTeslimat, withTeslimat } from '@/lib/teslimat'
import {
  FormSheet,
  FormSheetBlock,
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
        {/* Titled again by each sheet below — see SpecFormDialog. */}
        <DialogHeader className="print:hidden">
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
                  order printDoc() puts on paper, and on one block so the sheet
                  reads as a single document rather than stacked sections. */}
              <FormSheetBlock className="bg-muted/10 border-b-0">
                <SheetRow label="İŞİN ADI" value={c.component || project.title} readOnly />
                {(c.rows ?? []).length === 0 ? (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">Satır yok.</p>
                ) : (
                  (c.rows ?? []).map((r, i) => (
                    <SheetRow key={r.id ?? i} label={r.label} value={r.value} readOnly />
                  ))
                )}
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
/*  Table helpers                                                       */
/* ------------------------------------------------------------------ */

// Short DD.MM.YY rendering of an ISO (YYYY-MM-DD…) or European (DD.MM.YYYY)
// date so the table column is one monospaced line. Anything we don't
// recognise is returned untouched — never silently mangled.
function shortDate(raw) {
  if (!raw) return ''
  let y, m, d
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    ;[y, m, d] = raw.slice(0, 10).split('-')
  } else if (/^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(raw)) {
    const parts = raw.split('.')
    d = parts[0]
    m = parts[1]
    y = parts[2]?.length === 2 ? `20${parts[2]}` : parts[2]
  } else {
    return raw
  }
  const yy = (y ?? '').slice(-2)
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${yy}`
}

// Compact segmented control — used twice above the table for the kind
// (Tümü/Demo/Ozalit) and status (Hepsi/İstenen/Onaylanan) filters. Each
// option can carry an optional mono count badge.
function SegmentedGroup({ value, onChange, options }) {
  return (
    <div role="tablist" className="inline-flex items-center gap-1 rounded-xl border bg-card p-1">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
            {typeof opt.count === 'number' && (
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                  active ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// One square icon button for the row's Eylemler column. Width stays
// predictable so the right edge of every row lines up.
function RowAction({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition active:scale-90 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
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
  const navigate = useNavigate()
  // 'all' | 'demo' | 'ozalit' — collapses the old Demolar/Ozalitler tabs into
  // one switch on the filter strip; 'all' shows both kinds in a single table.
  const [docType, setDocType] = useState('all')
  // 'all' | 'istenen' | 'onaylanan' — replaces the old İstenen/Onaylanan
  // sub-tabs. 'all' is the default so a first-time visitor sees everything.
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [viewEntry, setViewEntry] = useState(null)
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

  // One unified list of every document (demo OR ozalit) the page can show —
  // the filter strip only narrows it. Per-entry approved/attempt/kind/etc. are
  // computed once so the filter passes can be pure predicates.
  const allEntries = useMemo(() => {
    // Prefer the server snapshot; fall back to this browser's localStorage.
    // The teslimat stamps are then resolved from the project row on top of
    // whichever won — the snapshot is where they USED to live and it is not
    // reliably where they ended up. See lib/teslimat.js.
    const pickForm = (kind, project) => {
      const saved = serverForms[project.id]?.[kind]
        ?? (kind === 'demo' ? loadDemoForm(project.id) : loadOzalitForm(project.id))
      return saved ? withTeslimat(saved, liveTeslimat({ project, kind })) : saved
    }
    const out = []
    for (const p of projects) {
      if (DEMO_SENT_STAGES.has(p.stage)) {
        const form = pickForm('demo', p)
        const printerEntry = (p.history ?? []).find(
          (h) => h.from_stage === 'demo_teslim' && h.action === 'advance',
        )
        out.push({
          id: `${p.id}::demo`,
          project: p,
          kind: 'demo',
          attemptNo: (p.demo_attempt ?? 0) + 1,
          form,
          printerName: printerEntry?.done_by_name ?? '',
          approved: isDemoApproved(p),
        })
      }
      if (p.type === 'TR' && OZALIT_SENT_STAGES.has(p.stage)) {
        const form = pickForm('ozalit', p)
        const printerEntry = (p.history ?? []).find(
          (h) => h.from_stage === 'ozalit_teslim' && h.action === 'advance',
        )
        out.push({
          id: `${p.id}::ozalit`,
          project: p,
          kind: 'ozalit',
          attemptNo: (p.ozalit_attempt ?? 0) + 1,
          form,
          printerName: printerEntry?.done_by_name ?? '',
          approved: OZALIT_APPROVED_STAGES.has(p.stage),
        })
      }
    }
    return out
  }, [projects, serverForms])

  // Apply the kind filter first so the status chip counts reflect what the
  // user is actually narrowing by (e.g. “İstenen: 7” after picking Demo means
  // 7 waiting demos, not 7 of everything).
  const kindFiltered = useMemo(
    () => docType === 'all' ? allEntries : allEntries.filter((e) => e.kind === docType),
    [allEntries, docType],
  )

  const counts = useMemo(() => ({
    all: allEntries.length,
    demo: allEntries.filter((e) => e.kind === 'demo').length,
    ozalit: allEntries.filter((e) => e.kind === 'ozalit').length,
    istenen: kindFiltered.filter((e) => !e.approved).length,
    onaylanan: kindFiltered.filter((e) => e.approved).length,
  }), [allEntries, kindFiltered])

  // Final filter pass: status (waiting vs approved) + free-text search on the
  // project title. Sorted by attempt# desc (newest rounds first), then by
  // project title for stable ordering inside an attempt.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return kindFiltered
      .filter((e) => {
        if (status === 'istenen' && e.approved) return false
        if (status === 'onaylanan' && !e.approved) return false
        if (q && !e.project.title.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => {
        if (b.attemptNo !== a.attemptNo) return b.attemptNo - a.attemptNo
        return a.project.title.localeCompare(b.project.title, 'tr-TR')
      })
  }, [kindFiltered, status, search])

  function handlePrint(entry) {
    printDoc({
      project: entry.project,
      form: entry.form,
      attemptNo: entry.attemptNo,
      kind: entry.kind,
      printerName: entry.printerName,
    })
  }

  const totalBelge = counts.all

  return (
    <div className="mx-auto max-w-5xl 2xl:max-w-screen-xl space-y-6">
      {/* Header — same vocabulary as Baskı Reçeteleri: eyebrow tag, dashed
          divider, mono total in the corner so the page weight matches the
          rest of the app. */}
      <header className="flex flex-col gap-5 border-b border-dashed pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Matbaa Takip</span>
          </div>
          <h1 className="text-3xl tracking-tight md:text-4xl">Dökümanlar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tüm demo ve ozalit üretim formları, tek tabloda.</p>
        </div>
        {!loading && (
          <div className="shrink-0">
            <div className="font-mono text-3xl font-semibold tabular-nums leading-none text-primary">{totalBelge}</div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">belge</div>
          </div>
        )}
      </header>

      {/* Filter strip — one row on desktop, wraps on smaller widths. Two
          segmented controls share the same vocabulary; search sits at the
          end. Counts on the kind group are absolute; counts on the status
          group react to whichever kind is currently selected. */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedGroup
          value={docType}
          onChange={setDocType}
          options={[
            { value: 'all', label: 'Tümü', count: counts.all },
            { value: 'demo', label: 'Demo', count: counts.demo },
            { value: 'ozalit', label: 'Ozalit', count: counts.ozalit },
          ]}
        />
        <SegmentedGroup
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Hepsi' },
            { value: 'istenen', label: 'İstenen', count: counts.istenen },
            { value: 'onaylanan', label: 'Onaylanan', count: counts.onaylanan },
          ]}
        />
        <div className="relative min-w-[180px] flex-1 sm:ml-auto sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Proje arayın…"
            className="w-full rounded-xl border bg-card py-1.5 pl-9 pr-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </div>

      {/* Table — sticky header, horizontal scroll on narrow widths. Each row
          carries a 1.5px status edge (green = onaylı, amber = bekliyor), a
          clickable project title that opens the existing preview dialog, and
          three icon buttons for view / print / open project. */}
      {loading ? (
        <div className="space-y-2" role="status" aria-label="Dökümanlar yükleniyor">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState text="Bu filtreyle eşleşen döküman yok." />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th aria-hidden className="w-1.5 p-0" />
                  <th className="px-4 py-2.5">Proje</th>
                  <th className="px-3 py-2.5">Tür</th>
                  <th className="px-3 py-2.5">Tarih</th>
                  <th className="px-3 py-2.5">Matbaa</th>
                  <th className="px-3 py-2.5">Durum</th>
                  <th className="px-3 py-2.5 text-right">Eylemler</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const isDemo = entry.kind === 'demo'
                  const requestDate = isDemo ? entry.form?.demoIstemTarihi : entry.form?.ozalitIstemTarihi
                  return (
                    <tr
                      key={entry.id}
                      className="group border-b transition-colors last:border-b-0 hover:bg-muted/30"
                    >
                      {/* Status edge — green for approved, amber for waiting;
                          the hover state deepens it so the row feels alive. */}
                      <td
                        aria-hidden
                        className={cn(
                          'p-0',
                          entry.approved ? 'bg-emerald-500' : 'bg-amber-400/70 group-hover:bg-amber-500',
                        )}
                      />
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setViewEntry(entry)}
                          className="flex min-w-0 items-center gap-2 text-left transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-semibold text-foreground">{entry.project.title}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="outline" className="font-mono text-[10px]">{TYPE_LABELS[entry.project.type]}</Badge>
                      </td>
                      <td className="px-3 py-3 font-mono text-[12px] tabular-nums text-muted-foreground">
                        {shortDate(requestDate) || '—'}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        <span className="line-clamp-1">{entry.printerName || '—'}</span>
                      </td>
                      <td className="px-3 py-3">
                        {entry.approved ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
                            <CheckCircle2 className="h-3 w-3" />
                            Onaylı
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-600/20">
                            <Clock className="h-3 w-3" />
                            Bekliyor
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <RowAction label="Görüntüleyin" onClick={() => setViewEntry(entry)}>
                            <Eye className="h-4 w-4" />
                          </RowAction>
                          <RowAction label="Yazdırın" onClick={() => handlePrint(entry)}>
                            <Printer className="h-4 w-4" />
                          </RowAction>
                          <RowAction label="Projeye gidin" onClick={() => navigate(`/projects/${entry.project.id}`)}>
                            <ExternalLink className="h-4 w-4" />
                          </RowAction>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DocumentPreviewDialog
        open={!!viewEntry}
        onOpenChange={(v) => !v && setViewEntry(null)}
        project={viewEntry?.project}
        form={viewEntry?.form}
        attemptNo={viewEntry?.attemptNo}
        docType={viewEntry?.kind === 'demo' ? 'demo' : 'ozalit'}
        printerName={viewEntry?.printerName ?? ''}
      />
    </div>
  )
}
