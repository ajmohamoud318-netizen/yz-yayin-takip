import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowRight, CheckCircle2, ClipboardCheck, Factory, Hourglass,
  Send, ShoppingCart, Truck,
} from 'lucide-react'

import api from '@/api'
import { useAuth } from '@/hooks/useAuth'
import { useProjects } from '@/hooks/useProjects'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import DemoFormDialog from '@/components/DemoFormDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import TalepSignDialog from '@/components/TalepSignDialog'
import {
  canRespondDemoChange, canRespondOzalitChange,
  canMarkDemoStarted, canMarkOzalitStarted,
  canRequestHandover,
} from '@/domain'
import { cn, formatTargetDate } from '@/lib/utils'

/**
 * Matbaa İşleri — printer's one-page hub.
 *
 * The older printer used to bounce between /approvals/demo, /approvals/ozalit,
 * /approvals/siparis and individual project pages. This page puts every action
 * the printer can take on one screen, each card with one big primary button
 * that opens the right dialog inline (no navigating away).
 *
 * Three sections:
 *   • Bekleyen İşlerim — demos + ozalits + sipariş rows, mixed, with the same
 *     filter rules as the existing queues (Approvals.jsx:93-130) so the badge
 *     and the list can never disagree.
 *   • Devam Eden Baskılarım — single card linking to /baski-listesi, with the
 *     production count from the shared projects store.
 *   • Teslime Hazır — single card linking to /teslim-talepleri, with the
 *     handover-eligible count.
 *
 * Back-compat: /approvals/demo, /approvals/ozalit and /approvals/siparis stay
 * in place for non-printer roles and any printer deep links still in flight.
 */
export default function MatbaaIsleri() {
  const { user } = useAuth()
  const { projects, loading, updateOne } = useProjects()
  const navigate = useNavigate()

  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [signOrder, setSignOrder] = useState(null)

  // Demo / ozalit deliver dialogs. The dialog itself owns the spec sheet;
  // here we only hold the target project and which mode to open in.
  const [demoForm, setDemoForm] = useState(null)   // { project, mode, startWork? }
  const [ozalitForm, setOzalitForm] = useState(null)
  // Matbaa "İşlemi Başlatın" — the spec sheet itself is the confirmation.
  // The button opens the form the printer is about to produce from, and the
  // job starts from its footer, so nobody commits to a job they haven't
  // read. Same rule on Approvals.jsx and the project detail header.
  const [startingWork, setStartingWork] = useState(false)

  // Sipariş queue (printer's sign-off step: matbaa_ozalit_yapiyor → imza_bekleniyor).
  // Same filter Approvals.jsx:73 uses — one rule, one place.
  useEffect(() => {
    let cancelled = false
    setOrdersLoading(true)
    api.listOrderRequests()
      .then((reqs) => {
        if (cancelled) return
        setOrders(reqs.filter((r) => r.status === 'matbaa_ozalit_yapiyor'))
      })
      .catch(() => { /* transient — next tick retries */ })
      .finally(() => { if (!cancelled) setOrdersLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Same filter rules as Approvals.jsx:97-100 — keeping them in lockstep so
  // the sidebar badge and this list never disagree on what's pending.
  const demoQueue = useMemo(
    () => projects.filter((p) => p.type === 'TR' && p.stage === 'demo_teslim'),
    [projects],
  )
  const ozalitQueue = useMemo(
    () => projects.filter((p) => (
      p.type === 'TR'
      && p.stage === 'ozalit_teslim'
      && (!!p.ozalit_requested || p.reject_target === 'matbaa')
    )),
    [projects],
  )
  const productionCount = useMemo(
    () => projects.filter((p) => p.stage === 'baskida' || p.stage === 'gumruk').length,
    [projects],
  )
  const handoverEligibleCount = useMemo(
    () => projects.filter((p) => canRequestHandover(p)).length,
    [projects],
  )

  // ----- Mutation handlers -----------------------------------------------

  // Sipariş leaves the printer's queue once it's signed — drop it from the
  // local list so the card disappears immediately, no waiting for the next
  // refetch. Mirrors Approvals.jsx:138-141.
  function handleOrderSigned(updated) {
    setOrders((prev) => prev.filter((r) => r.id !== updated.id))
    setSignOrder(null)
  }

  // "İşlemi Başlatın" doesn't move the project out of *_teslim — it just
  // stamps `*_started = true` so the row's next state ("Teslim Edin") shows
  // up. Merge the response into the shared store so the card re-renders
  // with the new button label. Same pattern as Approvals.jsx:186-201.
  async function handleStartWork(project, sub) {
    if (!project) return
    setStartingWork(true)
    try {
      const updated = sub === 'demo'
        ? await api.markDemoStarted(project.id)
        : await api.markOzalitStarted(project.id)
      updateOne(updated)
      toast.success(sub === 'demo'
        ? 'Demo çalışmasına başladığınız işaretlendi.'
        : 'Ozalit çalışmasına başladığınız işaretlendi.')
      // Close the sheet they just started from — the row behind it flips to
      // "Teslim Edin", which reopens the same form to deliver.
      if (sub === 'demo') setDemoForm(null)
      else setOzalitForm(null)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setStartingWork(false)
    }
  }

  // ----- Card builder ----------------------------------------------------

  // Each pending row maps to one of four states, ordered by what the printer
  // physically does next:
  //   1. awaitingChange  → open project page (change needs project-level context)
  //   2. !started        → open the spec form, start work from its footer
  //   3. started         → open the spec form to deliver
  //   4. (no row)        → row is gone, no card
  function pendingAction(sub, p) {
    if (sub === 'demo' ? canRespondDemoChange(user, p) : canRespondOzalitChange(user, p)) {
      return { kind: 'navigate', label: 'Değişikliği Yanıtlayın', to: `/projects/${p.id}`, Icon: Send }
    }
    const started = sub === 'demo' ? p.demo_started : p.ozalit_started
    if (!started && (sub === 'demo' ? canMarkDemoStarted(user, p) : canMarkOzalitStarted(user, p))) {
      return { kind: 'start', label: 'İşlemi Başlatın', Icon: CheckCircle2 }
    }
    if (started) {
      return {
        kind: 'deliver',
        label: sub === 'demo' ? 'Demoyu Teslim Edin' : 'Ozaliti Teslim Edin',
        Icon: Send,
      }
    }
    return null
  }

  // Sipariş rows always have one action: open the sign dialog.
  function siparisAction() {
    return { kind: 'sign', label: 'İmzala ve Onayla', Icon: ClipboardCheck }
  }

  function handleAction(item, action) {
    if (!action) return
    switch (action.kind) {
      case 'navigate':
        navigate(action.to)
        return
      case 'start':
        // Review-then-start: the same form opens read-only for the printer,
        // with "İşlemi Başlatın" in its footer.
        if (item.__sub === 'demo') setDemoForm({ project: item, mode: 'view', startWork: true })
        else setOzalitForm({ project: item, mode: 'view', startWork: true })
        return
      case 'deliver':
        if (item.__sub === 'demo') setDemoForm({ project: item, mode: 'advance' })
        else setOzalitForm({ project: item, mode: 'advance' })
        return
      case 'sign':
        setSignOrder(item)
        return
      default:
        return
    }
  }

  // ----- Sections --------------------------------------------------------

  function renderPendingRow(item, sub) {
    const decorated = { ...item, __sub: sub }
    const action = sub === 'siparis' ? siparisAction() : pendingAction(sub, item)
    if (!action) return null

    const status = (() => {
      if (sub === 'siparis') {
        return { tone: 'bg-violet-50 text-violet-700 ring-violet-200', label: 'Baskı onayı bekliyor' }
      }
      if (sub === 'demo' ? canRespondDemoChange(user, item) : canRespondOzalitChange(user, item)) {
        return { tone: 'bg-rose-50 text-rose-700 ring-rose-200', label: 'Değişiklik talebi yanıtlanmadı' }
      }
      const started = sub === 'demo' ? item.demo_started : item.ozalit_started
      if (started) {
        return { tone: 'bg-primary/10 text-primary ring-primary/20', label: 'Matbaada · teslime hazır' }
      }
      return { tone: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'Matbaa çalışması başlamadı' }
    })()

    const typeLabel = sub === 'siparis'
      ? (item.quantity ? `${item.quantity} adet` : 'Sipariş')
      : (sub === 'demo' ? 'Numune baskı' : 'Prova baskı')
    const title = sub === 'siparis'
      ? (item.project_title?.replace(/ \/ /g, ' ') ?? 'Sipariş')
      : item.title
    const meta = sub === 'siparis'
      ? `${item.requested_by_name ?? '—'} · ${formatShortDate(item.created_at)}`
      : `${item.assigned_name ?? '—'} · ${formatTargetDate(item.target_month)}`

    return (
      <Card key={`${sub}-${item.id}`} className="overflow-hidden">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
          <span className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full text-[11px] font-semibold uppercase ring-1 ring-inset',
            status.tone,
          )}>
            {sub === 'siparis' ? 'S' : sub === 'demo' ? 'D' : 'O'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug sm:line-clamp-1">
              {title}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="truncate">{meta}</span>
              <span aria-hidden className="h-0.5 w-0.5 rounded-full bg-muted-foreground/40" />
              <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
            </p>
            <span className={cn(
              'mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
              status.tone,
            )}>
              {status.label}
            </span>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              size="sm"
              className="w-full gap-1.5 sm:w-auto"
              onClick={() => handleAction(decorated, action)}
            >
              <action.Icon className="h-4 w-4" />
              {action.label}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-1.5 text-muted-foreground sm:w-auto"
              onClick={() => navigate(sub === 'siparis' ? `/projects/${item.project_id}` : `/projects/${item.id}`)}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Detay
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const pendingCount = demoQueue.length + ozalitQueue.length + orders.length

  return (
    <>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          icon={Factory}
          title="Matbaa İşleri"
          subtitle="Numune baskı, prova baskı ve yeni siparişler — hepsi tek sayfada."
        />

        <Section
          title="Bekleyen İşlerim"
          icon={Hourglass}
          tone="amber"
          count={pendingCount}
        >
          {loading || ordersLoading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : pendingCount === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Şu an bekleyen iş yok."
              hint="Yeni bir numune veya prova baskı geldiğinde burada görünecek."
            />
          ) : (
            <div className="space-y-2.5">
              {demoQueue.map((p) => renderPendingRow(p, 'demo'))}
              {ozalitQueue.map((p) => renderPendingRow(p, 'ozalit'))}
              {orders.map((o) => renderPendingRow(o, 'siparis'))}
            </div>
          )}
        </Section>

        <Section
          title="Devam Eden Baskılarım"
          icon={Factory}
          tone="primary"
          count={productionCount || undefined}
        >
          <LinkCard
            to="/baski-listesi"
            title="Baskı Listesi"
            description="Baskıda olan ve gümrükteki projeleri görün."
            icon={Factory}
          />
        </Section>

        <Section
          title="Teslime Hazır"
          icon={Truck}
          tone="pink"
          count={handoverEligibleCount || undefined}
        >
          <LinkCard
            to="/teslim-talepleri"
            title="Teslim Talepleri"
            description="Bitmiş baskıları satışa teslim edin."
            icon={ShoppingCart}
          />
        </Section>
      </div>

      <DemoFormDialog
        open={!!demoForm}
        onOpenChange={(v) => setDemoForm(v ? demoForm : null)}
        project={demoForm?.project}
        mode={demoForm?.mode ?? 'advance'}
        onStartWork={demoForm?.startWork ? () => handleStartWork(demoForm.project, 'demo') : undefined}
        startingWork={startingWork}
        onDone={() => setDemoForm(null)}
      />
      <OzalitFormDialog
        open={!!ozalitForm}
        onOpenChange={(v) => setOzalitForm(v ? ozalitForm : null)}
        project={ozalitForm?.project}
        mode={ozalitForm?.mode ?? 'advance'}
        onStartWork={ozalitForm?.startWork ? () => handleStartWork(ozalitForm.project, 'ozalit') : undefined}
        startingWork={startingWork}
        onDone={() => setOzalitForm(null)}
      />
      <TalepSignDialog
        order={signOrder}
        open={!!signOrder}
        onOpenChange={(v) => !v && setSignOrder(null)}
        onSigned={handleOrderSigned}
        onUpdated={(updated) => setOrders((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))}
      />
    </>
  )
}

/* ───────────────────────── shared bits ───────────────────────── */

function Section({ title, icon: Icon, tone, count, children }) {
  const accent = {
    amber: 'before:bg-amber-400',
    primary: 'before:bg-primary',
    pink: 'before:bg-pink-400',
  }[tone] ?? 'before:bg-border'
  return (
    <section className={cn('relative pl-3 before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full', accent)}>
      <header className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {count ? (
          <Badge variant="secondary" className="ml-1">{count}</Badge>
        ) : null}
      </header>
      {children}
    </section>
  )
}

function PageHeader({ icon: Icon, title, subtitle }) {
  return (
    <header>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
    </header>
  )
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <Card>
      <CardContent className="grid place-items-center gap-1.5 p-12 text-center">
        <Icon className="h-8 w-8 text-muted-foreground/40" strokeWidth={1.75} />
        <p className="text-sm font-medium text-foreground">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function LinkCard({ to, title, description, icon: Icon }) {
  const navigate = useNavigate()
  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/30"
      onClick={() => navigate(to)}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </CardContent>
    </Card>
  )
}

function formatShortDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(d)
}
